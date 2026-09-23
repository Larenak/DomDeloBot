import { createHmac, timingSafeEqual } from 'node:crypto';

import type { AuthenticatedActor } from '../../types.js';

type SessionPayload = AuthenticatedActor & { expiresAt: number };

function sign(value: string, secret: string): string {
  return createHmac('sha256', secret).update(value).digest('base64url');
}

export function createSessionToken(
  actor: AuthenticatedActor,
  secret: string,
  expiresInSeconds = 3600,
): string {
  const payload: SessionPayload = {
    ...actor,
    expiresAt: Math.floor(Date.now() / 1000) + expiresInSeconds,
  };
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${encoded}.${sign(encoded, secret)}`;
}

export function verifySessionToken(token: string, secret: string): AuthenticatedActor | null {
  const [encoded, signature] = token.split('.');
  if (!encoded || !signature) return null;
  const expected = Buffer.from(sign(encoded, secret));
  const actual = Buffer.from(signature);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
  try {
    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as SessionPayload;
    if (payload.expiresAt <= Math.floor(Date.now() / 1000)) return null;
    return {
      id: payload.id,
      role: payload.role,
      houseId: payload.houseId,
      displayName: payload.displayName,
    };
  } catch {
    return null;
  }
}

