/**
 * Web Search API
 *
 * POST /api/web-search
 * Supports multiple search providers:
 * - DuckDuckGo (free, no API key required) ⭐ Recommended
 * - Tavily (premium, requires API key)
 */

import { searchWithTavily, formatSearchResultsAsContext as formatTavilyResults } from '@/lib/web-search/tavily';
import { searchWithDuckDuckGo, formatSearchResultsAsContext as formatDuckDuckGoResults } from '@/lib/web-search/duckduckgo';
import { resolveWebSearchApiKey } from '@/lib/server/provider-config';
import { createLogger } from '@/lib/logger';
import { apiError, apiSuccess } from '@/lib/server/api-response';
import type { WebSearchProviderId } from '@/lib/web-search/types';

const log = createLogger('WebSearch');

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const {
      query,
      apiKey: clientApiKey,
      provider = 'duckduckgo', // Default to free DuckDuckGo
    } = body as {
      query?: string;
      apiKey?: string;
      provider?: WebSearchProviderId;
    };

    if (!query || !query.trim()) {
      return apiError('MISSING_REQUIRED_FIELD', 400, 'query is required');
    }

    let result;
    let context;

    // Route to appropriate provider
    switch (provider) {
      case 'duckduckgo': {
        log.info(`[DuckDuckGo] Searching: "${query.substring(0, 50)}..."`);
        try {
          result = await searchWithDuckDuckGo({ query: query.trim() });
          context = formatDuckDuckGoResults(result);
          log.info(`[DuckDuckGo] Found ${result.sources.length} sources in ${result.responseTime}ms`);
        } catch (error) {
          log.error('[DuckDuckGo] Search error:', error);
          throw error;
        }
        break;
      }

      case 'tavily': {
        const apiKey = resolveWebSearchApiKey(clientApiKey);
        if (!apiKey) {
          return apiError(
            'MISSING_API_KEY',
            401,
            'Tavily API key is not configured. Set it in Settings → Web Search or set TAVILY_API_KEY env var.',
          );
        }
        log.info(`[Tavily] Searching: "${query.substring(0, 50)}..."`);
        try {
          result = await searchWithTavily({ query: query.trim(), apiKey });
          context = formatTavilyResults(result);
          log.info(`[Tavily] Found ${result.sources.length} sources in ${result.responseTime}ms`);
        } catch (error) {
          log.error('[Tavily] Search error:', error);
          throw error;
        }
        break;
      }

      default:
        return apiError(
          'INVALID_REQUEST',
          400,
          `Unknown search provider: ${provider}. Supported: duckduckgo, tavily`,
        );
    }

    return apiSuccess({
      answer: result.answer,
      sources: result.sources,
      context,
      query: result.query,
      responseTime: result.responseTime,
      provider,
    });
  } catch (err) {
    log.error('[WebSearch] Error:', err);
    const message = err instanceof Error ? err.message : 'Web search failed';
    return apiError('INTERNAL_ERROR', 500, message);
  }
}
