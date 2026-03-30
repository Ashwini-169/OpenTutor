import { defaultLocale, type Locale } from './types';
export { type Locale, defaultLocale } from './types';
import { commonHiIN, commonEnUS } from './common';
import { stageHiIN, stageEnUS } from './stage';
import { chatHiIN, chatEnUS } from './chat';
import { generationHiIN, generationEnUS } from './generation';
import { settingsHiIN, settingsEnUS } from './settings';

export const translations = {
  'hi-IN': {
    ...commonHiIN,
    ...stageHiIN,
    ...chatHiIN,
    ...generationHiIN,
    ...settingsHiIN,
  },
  'en-US': {
    ...commonEnUS,
    ...stageEnUS,
    ...chatEnUS,
    ...generationEnUS,
    ...settingsEnUS,
  },
} as const;

export type TranslationKey = keyof (typeof translations)[typeof defaultLocale];

export function translate(locale: Locale, key: string): string {
  const keys = key.split('.');
  let value: unknown = translations[locale];
  for (const k of keys) {
    value = (value as Record<string, unknown>)?.[k];
  }
  return (typeof value === 'string' ? value : undefined) ?? key;
}

export function getClientTranslation(key: string): string {
  let locale: Locale = defaultLocale;

  if (typeof window !== 'undefined') {
    try {
      const storedLocale = localStorage.getItem('locale');
      if (storedLocale === 'hi-IN' || storedLocale === 'en-US') {
        locale = storedLocale;
      }
    } catch {
      // localStorage unavailable, keep default locale
    }
  }

  return translate(locale, key);
}
