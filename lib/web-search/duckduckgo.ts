/**
 * DuckDuckGo Web Search Integration
 *
 * Uses DuckDuckGo Instant Answer API (free, no authentication required)
 * Alternative to commercial search APIs - completely zero-cost
 *
 * Endpoints:
 * - https://api.duckduckgo.com/?q=QUERY&format=json - Instant Answer API
 * - Supports quick facts, definitions, and search results
 */

import { proxyFetch } from '@/lib/server/proxy-fetch';
import type { WebSearchResult, WebSearchSource } from '@/lib/types/web-search';

const DUCKDUCKGO_API_URL = 'https://api.duckduckgo.com';

// DuckDuckGo API rate limit: ~100+ queries per day for free tier, no strict limits
const DUCKDUCKGO_MAX_QUERY_LENGTH = 500;

interface DuckDuckGoResponse {
  AbstractText?: string;
  AbstractSource?: string;
  AbstractURL?: string;
  Answer?: string;
  AnswerType?: string;
  Definition?: string;
  DefinitionSource?: string;
  DefinitionURL?: string;
  Entity?: string;
  Image?: string;
  Infobox?: string;
  Redirect?: string;
  RelatedTopics?: Array<{
    FirstURL?: string;
    Icon?: { Height?: string; URL?: string; Width?: string };
    Name?: string;
    Result?: string;
    Text?: string;
    Topics?: Array<{
      FirstURL?: string;
      Icon?: { Height?: string; URL?: string; Width?: string };
      Name?: string;
      Result?: string;
      Text?: string;
    }>;
  }>;
  Results?: Array<{
    FirstURL?: string;
    Icon?: { Height?: string; URL?: string; Width?: string };
    Result?: string;
    Text?: string;
    Topics?: Array<{
      FirstURL?: string;
      Icon?: { Height?: string; URL?: string; Width?: string };
      Name?: string;
      Result?: string;
      Text?: string;
    }>;
  }>;
  Type?: string;
}

/**
 * Search the web using DuckDuckGo Instant Answer API (free, no API key needed)
 *
 * @param query - Search query
 * @param maxResults - Maximum number of results to return (default: 5)
 * @returns Web search result with answer and sources
 */
export async function searchWithDuckDuckGo(params: {
  query: string;
  maxResults?: number;
}): Promise<WebSearchResult> {
  const { query, maxResults = 5 } = params;

  // Truncate query if it exceeds max length
  const truncatedQuery = query.slice(0, DUCKDUCKGO_MAX_QUERY_LENGTH);

  try {
    const startTime = Date.now();

    // Make request to DuckDuckGo API (no authentication needed!)
    const res = await proxyFetch(DUCKDUCKGO_API_URL, {
      method: 'GET',
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        Accept: 'application/json',
      },
      // Build query parameters
      body: undefined,
    });

    // Actually, we need to use URL params for GET request
    // Let's rebuild the request with URL params
    const url = new URL(DUCKDUCKGO_API_URL);
    url.searchParams.set('q', truncatedQuery);
    url.searchParams.set('format', 'json');
    url.searchParams.set('no_html', '1'); // No HTML in results
    url.searchParams.set('t', 'openmaic'); // User-agent token

    const actualRes = await proxyFetch(url.toString(), {
      method: 'GET',
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        Accept: 'application/json',
      },
    });

    if (!actualRes.ok) {
      throw new Error(`DuckDuckGo API error (${actualRes.status}): ${actualRes.statusText}`);
    }

    const data: DuckDuckGoResponse = await actualRes.json();
    const responseTime = Date.now() - startTime;

    // Extract answer and sources from various DuckDuckGo response fields
    let answer = '';
    const sources: WebSearchSource[] = [];

    // Priority 1: Direct answer
    if (data.Answer) {
      answer = data.Answer;
    } else if (data.AbstractText) {
      answer = data.AbstractText;
    } else if (data.Definition) {
      answer = data.Definition;
    }

    // Add abstract/definition as first source if available
    if (data.AbstractURL) {
      sources.push({
        title: data.AbstractSource || 'Abstract',
        url: data.AbstractURL,
        content: data.AbstractText || answer || 'Direct answer from DuckDuckGo',
        score: 1.0, // Highest score for direct answer
      });
    }

    // Add related topics as sources (if not already added as abstract)
    if (data.RelatedTopics && data.RelatedTopics.length > 0) {
      for (const topic of data.RelatedTopics.slice(0, maxResults - sources.length)) {
        if (topic.FirstURL && topic.Text) {
          sources.push({
            title: topic.Name || 'Related Topic',
            url: topic.FirstURL,
            content: topic.Text.slice(0, 300),
            score: 0.8,
          });
        }
      }
    }

    // Add regular Results if available
    if (data.Results && data.Results.length > 0 && sources.length < maxResults) {
      for (const result of data.Results.slice(0, maxResults - sources.length)) {
        if (result.FirstURL && result.Text) {
          sources.push({
            title: result.Result || 'Search Result',
            url: result.FirstURL,
            content: result.Text.slice(0, 300),
            score: 0.6,
          });
        }
      }
    }

    // If no results found, return empty response
    if (!answer && sources.length === 0) {
      return {
        answer: `No results found for "${truncatedQuery}"`,
        sources: [],
        query: truncatedQuery,
        responseTime,
      };
    }

    return {
      answer,
      sources: sources.slice(0, maxResults),
      query: truncatedQuery,
      responseTime,
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    throw new Error(`DuckDuckGo search failed: ${errorMsg}`);
  }
}

/**
 * Format search results into a markdown context block for LLM prompts
 * (Reuses same format as Tavily)
 */
export function formatSearchResultsAsContext(result: WebSearchResult): string {
  if (!result.answer && result.sources.length === 0) {
    return '';
  }

  const lines: string[] = [];

  if (result.answer) {
    lines.push(result.answer);
    lines.push('');
  }

  if (result.sources.length > 0) {
    lines.push('Sources:');
    for (const src of result.sources) {
      lines.push(`- [${src.title}](${src.url}): ${src.content.slice(0, 200)}`);
    }
  }

  return lines.join('\n');
}
