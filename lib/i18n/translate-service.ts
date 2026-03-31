/**
 * Zero-API Translation Service
 * Uses Google Translate Web (unofficial) endpoint - no API key required
 *
 * Supported Use Cases:
 * - translate(text, 'hi') → translates to Hindi
 * - translate(text, 'en') → returns English (no-op if already English)
 * - Caching layer to avoid redundant translations
 * - Fallback to i18n strings if translation fails
 */

import { createLogger } from '@/lib/logger';

const log = createLogger('TranslateService');

// ==================== Types ====================

export type TargetLanguage = 'hi' | 'en' | 'es' | 'fr' | 'de' | 'zh' | 'ja' | 'ar';
export type LanguageCode = TargetLanguage | string;

interface TranslationCacheEntry {
  text: string;
  timestamp: number;
}

// ==================== Constants ====================

/** Max cache age: 1 hour */
const CACHE_MAX_AGE_MS = 60 * 60 * 1000;

/** Translation service endpoints to try (in order) */
const TRANSLATION_ENDPOINTS = [
  // Google Translate API (no auth needed)
  (text: string, target: string) =>
    `https://translate.googleapis.com/translate_a/element.js?cb=translationCallback&client=gtx&sl=auto&tl=${target}&text=${encodeURIComponent(text)}`,

  // Alternative: Universal Google Translate endpoint
  (text: string, target: string) =>
    `https://translate.google.com/translate_a/single?client=gtx&sl=auto&tl=${target}&dt=t&q=${encodeURIComponent(text)}`,
];

// ==================== Cache ====================

class TranslationCache {
  private cache: Map<string, Map<LanguageCode, TranslationCacheEntry>> = new Map();

  private getKey(text: string, lang: LanguageCode): string {
    return `${text}::${lang}`;
  }

  get(text: string, lang: LanguageCode): string | null {
    const langCache = this.cache.get(text);
    if (!langCache) return null;

    const entry = langCache.get(lang);
    if (!entry) return null;

    // Check if cache expired
    if (Date.now() - entry.timestamp > CACHE_MAX_AGE_MS) {
      langCache.delete(lang);
      return null;
    }

    return entry.text;
  }

  set(text: string, lang: LanguageCode, translated: string): void {
    if (!this.cache.has(text)) {
      this.cache.set(text, new Map());
    }
    this.cache.get(text)!.set(lang, {
      text: translated,
      timestamp: Date.now(),
    });
  }

  clear(): void {
    this.cache.clear();
  }
}

const cache = new TranslationCache();

// ==================== Google Translate (Unofficial) ====================

/**
 * Translate text using Google Translate Web endpoint (no API key needed)
 *
 * Usage:
 *   const hindi = await translateText('Hello world', 'hi');
 *   const english = await translateText('नमस्ते', 'en');
 */
export async function translateText(
  text: string,
  targetLang: LanguageCode = 'hi',
  options?: {
    useCache?: boolean;
    timeout?: number;
  },
): Promise<string> {
  if (!text || !text.trim()) return '';

  const { useCache = true, timeout = 5000 } = options || {};

  // Check cache first
  if (useCache) {
    const cached = cache.get(text, targetLang);
    if (cached) {
      log.debug(`[Cache HIT] ${text.substring(0, 30)}... → ${targetLang}`);
      return cached;
    }
  }

  try {
    // Try each endpoint until one succeeds
    for (const buildUrl of TRANSLATION_ENDPOINTS) {
      try {
        const url = buildUrl(text, targetLang);
        const result = await fetchTranslation(url, timeout);
        if (result) {
          if (useCache) {
            cache.set(text, targetLang, result);
          }
          log.debug(`[Translated] ${text.substring(0, 30)}... → ${targetLang}`);
          return result;
        }
      } catch (e) {
        // Try next endpoint
        log.debug(`Endpoint failed: ${e instanceof Error ? e.message : String(e)}`);
        continue;
      }
    }

    // All endpoints failed, return original
    log.warn(`Translation failed for: ${text.substring(0, 30)}...`);
    return text;
  } catch (error) {
    log.error('Translation error:', error);
    return text;
  }
}

/**
 * Batch translate multiple texts
 * Useful for translating entire UI sections or conversation histories
 */
export async function translateBatch(
  texts: string[],
  targetLang: LanguageCode = 'hi',
  options?: {
    useCache?: boolean;
    timeout?: number;
    delay?: number; // ms delay between requests to avoid rate limiting
  },
): Promise<string[]> {
  const { delay: delayMs = 100 } = options || {};
  const results: string[] = [];

  for (let i = 0; i < texts.length; i++) {
    if (i > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
    const translated = await translateText(texts[i], targetLang, options);
    results.push(translated);
  }

  return results;
}

// ==================== Internal Helpers ====================

/**
 * Fetch translation from endpoint
 * Handles JSON response parsing
 */
async function fetchTranslation(url: string, timeout: number): Promise<string | null> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      return null;
    }

    const text = await response.text();

    // Try to parse the response
    // Google Translate API returns various formats, try to extract translation
    const translated = parseGoogleTranslateResponse(text);
    return translated;
  } catch (error) {
    if ((error as any)?.name === 'AbortError') {
      log.warn('Translation request timed out');
    }
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Parse Google Translate API response
 * API returns JSON with nested array structure
 */
function parseGoogleTranslateResponse(response: string): string | null {
  try {
    // Handle different response formats
    // Format 1: [[[translated_text, original_text, null, null, 0]], ...]
    // Format 2: Direct JSON with translations array

    // Try parsing as JSON array first
    if (response.startsWith('[')) {
      const parsed = JSON.parse(response);
      if (Array.isArray(parsed) && parsed[0]) {
        const firstElement = parsed[0];
        if (Array.isArray(firstElement) && firstElement[0]) {
          const translatedPart = firstElement[0];
          if (Array.isArray(translatedPart) && translatedPart[0]) {
            return String(translatedPart[0][0] || translatedPart[0] || '');
          }
          if (typeof translatedPart === 'string') {
            return translatedPart;
          }
        }
      }
    }

    // Fallback: try regex extraction
    // Look for translated text in various formats
    const match = response.match(/\[\["([^"]+)"/);
    if (match && match[1]) {
      return match[1];
    }

    return null;
  } catch (error) {
    log.debug('Failed to parse Google Translate response:', error);
    return null;
  }
}

// ==================== Language Detection ====================

/**
 * Simple language detection based on character ranges
 * Returns detected language code ('hi', 'en', etc.)
 */
export function detectLanguage(text: string): LanguageCode {
  if (!text) return 'en';

  // Devanagari script (Hindi, Sanskrit, etc.): U+0900 to U+097F
  const hindiCount = (text.match(/[\u0900-\u097f]/g) || []).length;
  if (hindiCount / text.length > 0.1) return 'hi';

  // Chinese: U+4E00 to U+9FFF
  const chineseCount = (text.match(/[\u4e00-\u9fff]/g) || []).length;
  if (chineseCount / text.length > 0.1) return 'zh';

  // Arabic: U+0600 to U+06FF
  const arabicCount = (text.match(/[\u0600-\u06ff]/g) || []).length;
  if (arabicCount / text.length > 0.1) return 'ar';

  return 'en';
}

// ==================== Smart Translation (with fallback) ====================

/**
 * Smart translate with fallback to i18n strings
 * If translation fails, returns original text
 *
 * Usage:
 *   // In components with i18n context
 *   const translated = await smartTranslate('Chat message', 'hi', { fallback: 'chat.message' })
 */
export async function smartTranslate(
  text: string,
  targetLang: LanguageCode = 'hi',
  options?: {
    fallback?: string; // i18n key to fall back to
    useCache?: boolean;
    timeout?: number;
  },
): Promise<string> {
  // If text is already in target language, return as-is
  const detected = detectLanguage(text);
  if (detected === targetLang) {
    return text;
  }

  // Try translation
  const translated = await translateText(text, targetLang, {
    useCache: options?.useCache ?? true,
    timeout: options?.timeout,
  });

  // If translation worked (different from original), return it
  if (translated !== text) {
    return translated;
  }

  // Fallback to fallback key if provided
  if (options?.fallback) {
    try {
      const { getClientTranslation } = await import('@/lib/i18n');
      const fallbackText = getClientTranslation(options.fallback);
      if (fallbackText && fallbackText !== options.fallback) {
        return fallbackText;
      }
    } catch (e) {
      // i18n not available, use original text
    }
  }

  // Last resort: return original
  return text;
}

// ==================== Cache Management ====================

/**
 * Clear translation cache
 * Useful for memory management or forcing fresh translations
 */
export function clearTranslationCache(): void {
  cache.clear();
  log.info('Translation cache cleared');
}

/**
 * Get cache statistics (for debugging)
 */
export function getTranslationCacheStats(): { size: number } {
  return {
    size: (cache as any).cache.size,
  };
}
