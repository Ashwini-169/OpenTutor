import { NextRequest } from 'next/server';
import { apiError, apiSuccess } from '@/lib/server/api-response';
import { validateUrlForSSRF } from '@/lib/server/ssrf-guard';

interface OllamaTagModel {
  name?: string;
}

interface OllamaTagsResponse {
  models?: OllamaTagModel[];
}

const PREFERRED_OLLAMA_MODELS = [
  'qwen2.5:3b',
  'qwen2.5-coder:1.5b-base',
  'kavai/qwen3.5-Gemini-Design:2b',
  'qwen3.5:2b',
  'hf.co/Jackrong/Qwen3.5-4B-Claude-4.6-Opus-Reasoning-Distilled-v2-GGUF:Q4_K_M',
  'kavai/qwen3.5-GPT5:2b',
];

function normalizeOllamaBaseUrl(baseUrl?: string): string {
  const fallback = 'http://127.0.0.1:11434';
  const raw = (baseUrl || fallback).trim().replace(/\/+$/, '');
  return raw.endsWith('/v1') ? raw.slice(0, -3) : raw;
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as { baseUrl?: string };
    const ollamaBaseUrl = normalizeOllamaBaseUrl(body.baseUrl);

    if (process.env.NODE_ENV === 'production') {
      const ssrfError = validateUrlForSSRF(ollamaBaseUrl);
      if (ssrfError) {
        return apiError('INVALID_URL', 400, ssrfError);
      }
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);

    let response: Response;
    try {
      response = await fetch(`${ollamaBaseUrl}/api/tags`, {
        method: 'GET',
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) {
      return apiError(
        'UPSTREAM_ERROR',
        response.status,
        `Failed to fetch Ollama models: HTTP ${response.status}`,
      );
    }

    const data = (await response.json()) as OllamaTagsResponse;
    const detected = new Set(
      (data.models || [])
        .map((m) => (m.name || '').trim())
        .filter(Boolean),
    );

    const envPreferred = (process.env.OLLAMA_MODELS || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const combinedPreferred = [...new Set([...envPreferred, ...PREFERRED_OLLAMA_MODELS])];

    const detectedSet = new Set(detected);
    const orderedPreferred = combinedPreferred.filter((name) => detectedSet.has(name));
    const others = Array.from(detected).filter((name) => !combinedPreferred.includes(name));

    const orderedNames = [...orderedPreferred, ...others];

    const models = orderedNames.map((name) => ({
        id: name,
        name,
        capabilities: {
          streaming: true,
          tools: false,
          vision: false,
        },
      }));

    return apiSuccess({ models, count: models.length, baseUrl: ollamaBaseUrl });
  } catch (error) {
    return apiError(
      'INTERNAL_ERROR',
      500,
      error instanceof Error ? error.message : 'Failed to detect Ollama models',
    );
  }
}
