/**
 * Hindi Speech Translation Integration
 * Automatically translates speech content to Hindi when Hindi mode is enabled
 * Works with the ActionEngine to intercept and translate speech actions
 */

'use client';

import type { SpeechAction } from '@/lib/types/action';
import { useSettingsStore } from '@/lib/store/settings';
import { useTranslation } from '@/lib/hooks/use-translation';
import { useCallback, useRef } from 'react';
import { createLogger } from '@/lib/logger';

const log = createLogger('HindiSpeechTranslation');

// Cache for translated speech - maps original text to translated text
const speechTranslationCache = new Map<string, string>();

/**
 * Hook to integrate Hindi translation with speech actions
 * Intercepts speech text and translates to Hindi if enabled
 */
export function useHindiSpeechTranslation() {
  const hindiModeEnabled = useSettingsStore((s) => s.hindiModeEnabled);
  const { translate } = useTranslation({ targetLang: 'hi', enabled: hindiModeEnabled });
  const pendingRef = useRef<Map<string, Promise<string>>>(new Map());

  /**
   * Translate speech action text to Hindi
   * Returns a modified action with  translated text
   */
  const translateSpeechAction = useCallback(
    async (action: SpeechAction): Promise<SpeechAction> => {
      if (!hindiModeEnabled || !action.text) {
        return action;
      }

      // Check cache first
      if (speechTranslationCache.has(action.text)) {
        const cached = speechTranslationCache.get(action.text)!;
        return {
          ...action,
          text: cached,
          originalText: action.originalText || action.text,
        };
      }

      // Check if already pending
      const cacheKey = `speech::${action.text}`;
      if (pendingRef.current.has(cacheKey)) {
        const translated = await pendingRef.current.get(cacheKey)!;
        return {
          ...action,
          text: translated,
          originalText: action.originalText || action.text,
        };
      }

      try {
        // Translate
        const promise = translate(action.text, 'hi');
        pendingRef.current.set(cacheKey, promise);
        const translated = await promise;
        pendingRef.current.delete(cacheKey);

        // Cache result
        speechTranslationCache.set(action.text, translated);

        return {
          ...action,
          text: translated,
          originalText: action.originalText || action.text,
        };
      } catch (error) {
        log.error('Failed to translate speech action:', error);
        return action; // Return original on error
      }
    },
    [hindiModeEnabled, translate],
  );

  /**
   * Translate multiple speech texts
   * Useful for batch processing chat messages
   */
  const translateSpeechTexts = useCallback(
    async (texts: string[]): Promise<string[]> => {
      if (!hindiModeEnabled) {
        return texts;
      }

      const results: string[] = [];
      for (const text of texts) {
        const translated = await translate(text, 'hi');
        results.push(translated);
      }
      return results;
    },
    [hindiModeEnabled, translate],
  );

  const clearCache = useCallback(() => {
    speechTranslationCache.clear();
    pendingRef.current.clear();
    log.info('Speech translation cache cleared');
  }, []);

  return {
    translateSpeechAction,
    translateSpeechTexts,
    clearCache,
    isHindiModeEnabled: hindiModeEnabled,
  };
}

/**
 * Simple utility to translate chat message
 * For use in message rendering components
 */
export async function translateChatMessage(
  text: string,
  enabled: boolean = true,
): Promise<string> {
  if (!enabled) return text;

  // For client-side use, import and use the translation service directly
  const { translateText } = await import('@/lib/i18n/translate-service');
  return translateText(text, 'hi', { useCache: true, timeout: 3000 });
}

/**
 * Type extension for SpeechAction with translation support
 */
declare global {
  namespace React {
    interface SpeechActionWithTranslation extends SpeechAction {
      originalText?: string; // Original English text (for reference)
    }
  }
}
