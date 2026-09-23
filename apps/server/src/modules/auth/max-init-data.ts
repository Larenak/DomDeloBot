import { createHmac, timingSafeEqual } from 'node:crypto';

export type MaxInitData = {
  authDate: number;
  user: {
    id: number;
    first_name: string;
    last_name?: string;
    username?: string | null;
  };
  chat?: { id: number; type: string };
};

export function validateMaxInitData(
  initData: string,
  botToken: string,
  nowSeconds = Math.floor(Date.now() / 1000),
  maxAgeSeconds = 900,
): MaxInitData | null {
  const pairs = initData.split('&').map((part) => {
    const separator = part.indexOf('=');
    if (separator < 1) return null;
    return [part.slice(0, separator), part.slice(separator + 1)] as const;
  });
  if (pairs.some((pair) => pair === null)) return null;

  const validPairs = pairs.filter((pair): pair is readonly [string, string] => pair !== null);
  const hashes = validPairs.filter(([key]) => key === 'hash');
  if (hashes.length !== 1 || !hashes[0]) return null;

  const originalHash = decodeURIComponent(hashes[0][1]);
  if (!/^[a-f0-9]{64}$/i.test(originalHash)) return null;
  const launchParams = validPairs
    .filter(([key]) => key !== 'hash')
    .map(([key, value]) => [key, decodeURIComponent(value)] as const)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');

  const secretKey = createHmac('sha256', 'WebAppData').update(botToken).digest();
  const calculatedHash = createHmac('sha256', secretKey).update(launchParams).digest('hex');
  const expected = Buffer.from(originalHash, 'hex');
  const actual = Buffer.from(calculatedHash, 'hex');
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;

  const params = new URLSearchParams(initData);
  const authDate = Number(params.get('auth_date'));
  if (!Number.isInteger(authDate) || authDate > nowSeconds + 30 || nowSeconds - authDate > maxAgeSeconds) {
    return null;
  }
  const userRaw = params.get('user');
  if (!userRaw) return null;
  try {
    const user = JSON.parse(userRaw) as MaxInitData['user'];
    if (!Number.isSafeInteger(user.id) || !user.first_name) return null;
    const chatRaw = params.get('chat');
    const result: MaxInitData = {
      authDate,
      user,
    };
    if (chatRaw) result.chat = JSON.parse(chatRaw) as NonNullable<MaxInitData['chat']>;
    return result;
  } catch {
    return null;
  }
}
