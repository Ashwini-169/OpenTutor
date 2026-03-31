/**
 * useTranslation Hook
 * Provides reactive translation for React components
 *
 * Usage:
 *   const { translate, clearCache } = useTranslation('hi');
 *   const hindi = await translate('Hello world');
 *
 * Or with language detection:
 *   const { translate, isTranslating } = useTranslation();
 *   const translated = await translate('Chat message');
 */

'use client';

import { useCallback, useRef, useState, useEffect } from 'react';
import { useI18n } from '@/lib/hooks/use-i18n';
import { useSettingsStore } from '@/lib/store/settings';
import {
  translateText,
  detectLanguage,
  clearTranslationCache,
  type TargetLanguage,
} from './translate-service';
import { createLogger } from '@/lib/logger';

const log = createLogger('useTranslation');

interface UseTranslationOptions {
  /** Target language (auto-detects from locale if not provided) */
  targetLang?: TargetLanguage;
  /** Enable/disable translation */
  enabled?: boolean;
  /** Cache timeout in ms (default: 1 hour) */
  cacheTimeout?: number;
}

interface UseTranslationResult {
  /** Translate text to target language */
  translate: (text: string, lang?: TargetLanguage) => Promise<string>;
  /** Check if translation is in progress */
  isTranslating: boolean;
  /** Last translation error if any */
  error: Error | null;
  /** Get current target language */
  getCurrentLang: () => TargetLanguage;
  /** Clear translation cache */
  clearCache: () => void;
}

export function useTranslation(options: UseTranslationOptions = {}): UseTranslationResult {
  const { locale } = useI18n();
  const hindiModeEnabled = useSettingsStore((s) => s.hindiModeEnabled ?? false);

  // Determine if translation should be active
  const shouldTranslate =
    options.enabled !== false && (hindiModeEnabled || options.targetLang === 'hi');

  // Determine target language
  const getTargetLang = useCallback((): TargetLanguage => {
    if (options.targetLang) return options.targetLang;

    // Auto-detect from locale
    if (locale?.startsWith('hi')) return 'hi';
    if (locale?.startsWith('es')) return 'es';
    if (locale?.startsWith('fr')) return 'fr';
    if (locale?.startsWith('de')) return 'de';
    if (locale?.startsWith('zh')) return 'zh';
    if (locale?.startsWith('ja')) return 'ja';
    if (locale?.startsWith('ar')) return 'ar';

    return 'en'; // default
  }, [locale, options.targetLang]);

  const [isTranslating, setIsTranslating] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const pendingRef = useRef<Map<string, Promise<string>>>(new Map());

  // Translate function
  const translate = useCallback(
    async (text: string, lang?: TargetLanguage): Promise<string> => {
      if (!text) return '';

      const targetLang = lang || getTargetLang();

      // If translation is disabled or target language is English, return original
      if (!shouldTranslate || targetLang === 'en') {
        return text;
      }

      // If language is not Hindi, return original (for now, only support Hindi)
      if (targetLang !== 'hi') {
        log.debug(`Translation not yet supported for: ${targetLang}`);
        return text;
      }

      // Check if already in target language
      const detected = detectLanguage(text);
      if (detected === targetLang) {
        log.debug(`Text already in ${targetLang}, skipping translation`);
        return text;
      }

      // Check if already pending
      const cacheKey = `${text}::${targetLang}`;
      if (pendingRef.current.has(cacheKey)) {
        log.debug('Awaiting pending translation...');
        return pendingRef.current.get(cacheKey)!;
      }

      setIsTranslating(true);
      setError(null);

      try {
        const promise = translateText(text, targetLang, {
          useCache: true,
          timeout: 5000,
        });

        pendingRef.current.set(cacheKey, promise);
        const result = await promise;
        pendingRef.current.delete(cacheKey);

        return result;
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        setError(error);
        log.error('Translation error:', error);
        return text; // fallback to original
      } finally {
        setIsTranslating(false);
      }
    },
    [shouldTranslate, getTargetLang],
  );

  const getCurrentLang = useCallback(getTargetLang, [getTargetLang]);

  const clearCache = useCallback(() => {
    clearTranslationCache();
    pendingRef.current.clear();
    log.info('Translation cache cleared');
  }, []);

  // Cleanup pending translations on unmount
  useEffect(() => {
    return () => {
      pendingRef.current.clear();
    };
  }, []);

  return {
    translate,
    isTranslating,
    error,
    getCurrentLang,
    clearCache,
  };
}

/**
 * useTranslationBatch Hook
 * For translating multiple texts efficiently
 *
 * Usage:
 *   const { translateBatch } = useTranslationBatch('hi');
 *   const [hindi1, hindi2] = await translateBatch(['Hello', 'World']);
 */

import { translateBatch } from './translate-service';

interface UseTranslationBatchResult {
  translateBatch: (texts: string[], lang?: TargetLanguage) => Promise<string[]>;
  isTranslating: boolean;
  error: Error | null;
}

export function useTranslationBatch(
  options: UseTranslationOptions = {},
): UseTranslationBatchResult {
  const { locale } = useI18n();
  const hindiModeEnabled = useSettingsStore((s) => s.hindiModeEnabled ?? false);
  const shouldTranslate = options.enabled !== false && hindiModeEnabled;

  const getTargetLang = useCallback((): TargetLanguage => {
    if (options.targetLang) return options.targetLang;
    if (locale?.startsWith('hi')) return 'hi';
    return 'en';
  }, [locale, options.targetLang]);

  const [isTranslating, setIsTranslating] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const batchTranslate = useCallback(
    async (texts: string[], lang?: TargetLanguage): Promise<string[]> => {
      const targetLang = lang || getTargetLang();

      if (!shouldTranslate || targetLang !== 'hi') {
        return texts;
      }

      setIsTranslating(true);
      setError(null);

      try {
        const results = await translateBatch(texts, targetLang, {
          useCache: true,
          timeout: 5000,
          delay: 200, // Delay between requests to avoid rate limiting
        });
        return results;
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        setError(error);
        log.error('Batch translation error:', error);
        return texts; // fallback to original
      } finally {
        setIsTranslating(false);
      }
    },
    [shouldTranslate, getTargetLang],
  );

  return {
    translateBatch: batchTranslate,
    isTranslating,
    error,
  };
}
