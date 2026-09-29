/** A small, deterministic filter that runs in the API process without an external model. */
const lookalikes: Record<string, string> = {
  a: 'а', b: 'в', c: 'с', e: 'е', h: 'н', i: 'и', k: 'к', m: 'м',
  o: 'о', p: 'р', t: 'т', x: 'х', y: 'у',
};

const prohibitedWords = [
  /^(?:(?:на|по|за|про|вы|о|у|при|от|до|пере|раз|рас|с))?ху[йеяию][а-я]*$/u,
  /^(?:(?:на|по|за|про|вы|о|у|при|от|до|пере|раз|рас|с))?пизд[а-я]*$/u,
  /^(?:(?:за|по|на|вы|при|про|до|пере|от|у|вз|под|раз|рас|с|об)ъ?)?еб[а-я]*$/u,
  /^бля[дт][а-я]*$/u,
  /^су(?:ка|ки|ку|кой|ке|чка|чку|чки)[а-я]*$/u,
  /^мудак[а-я]*$/u,
  /^пид[ао]р[а-я]*$/u,
  /^г[ао]ндон[а-я]*$/u,
];

function normalized(value: string): string {
  return value.normalize('NFKC').toLowerCase()
    .replace(/\p{Cf}|\p{M}/gu, '')
    .replace(/ё/gu, 'е')
    .replace(/[abcehikmoptxy]/gu, (letter) => lookalikes[letter] || letter);
}

export function containsProhibitedLanguage(value: string): boolean {
  const text = normalized(value);
  // Join punctuation inside words, then inspect both the original and joined forms.
  const variants = [text, text.replace(/(?<=\p{L})[\p{P}\p{S}]+(?=\p{L})/gu, '')];
  const spacedLetters = text.replace(
    /(?<!\p{L})(?:[а-я][\s._*·-]+){2,}[а-я](?!\p{L})/gu,
    (match) => match.replace(/[^а-я]/gu, ''),
  );
  variants.push(spacedLetters);
  return variants.some((variant) =>
    (variant.match(/\p{L}+/gu) || []).some((word) =>
      prohibitedWords.some((pattern) => pattern.test(word))));
}

export class InappropriateCaseTextError extends Error {
  constructor(field: string) {
    super(`Поле «${field}» содержит нецензурные выражения. Измените текст и отправьте снова.`);
  }
}

export function assertAcceptableCaseText(fields: Record<string, string | undefined>): void {
  for (const [field, value] of Object.entries(fields)) {
    if (value && containsProhibitedLanguage(value)) {
      throw new InappropriateCaseTextError(field);
    }
  }
}
