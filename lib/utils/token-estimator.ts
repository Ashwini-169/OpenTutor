/**
 * Token Estimator Fallback
 * 
 * Used when LLM providers (like Ollama or some OpenAI-compatible providers)
 * do not return usage metrics in their responses.
 */

/**
 * Estimates the number of tokens in a string based on character counts.
 * 
 * Logic:
 * - English/Code: ~4 characters per token (gpt-4o standard)
 * - Indic/Hindi: ~1.5 - 2 characters per token (due to utf-8 encoding/multi-byte)
 * 
 * @param text The input string to measure.
 * @param language The language of the content (default: 'en-US').
 * @returns Estimated token count.
 */
export function estimateTokens(text: string, language: string = 'en-US'): number {
  if (!text) return 0;
  
  const charCount = text.length;
  
  // Basic heuristic based on language
  if (language === 'hi-IN') {
    // Hindi characters are more token-intensive
    return Math.max(1, Math.ceil(charCount / 2));
  }
  
  // Standard English/Code heuristic
  return Math.max(1, Math.ceil(charCount / 4));
}

/**
 * Ensures usage data is populated, using estimation if missing or 0.
 */
export function ensureUsage(
  usage?: { promptTokens?: number; completionTokens?: number },
  promptText?: string,
  completionText?: string,
  language?: string
): { promptTokens: number; completionTokens: number } {
  let promptTokens = usage?.promptTokens || 0;
  let completionTokens = usage?.completionTokens || 0;
  
  if (promptTokens === 0 && promptText) {
    promptTokens = estimateTokens(promptText, language);
  }
  
  if (completionTokens === 0 && completionText) {
    completionTokens = estimateTokens(completionText, language);
  }
  
  return { promptTokens, completionTokens };
}
