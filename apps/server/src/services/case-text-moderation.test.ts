import { describe, expect, it } from 'vitest';

import { containsProhibitedLanguage } from './case-text-moderation.js';

describe('case text moderation', () => {
  it('detects obscene words and simple masking', () => {
    for (const value of ['Это хуйня', 'Всё пиздец', 'Заебало', 'Блядь', 'х.у.й', 'х у й', 'xуй']) {
      expect(containsProhibitedLanguage(value), value).toBe(true);
    }
  });

  it('does not reject ordinary reports containing similar letters', () => {
    for (const value of ['Страхует проводку в подъезде', 'Ребёнок застрял в лифте', 'Не работает освещение', 'Сломан объект во дворе']) {
      expect(containsProhibitedLanguage(value), value).toBe(false);
    }
  });
});
