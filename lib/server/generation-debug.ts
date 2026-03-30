import { parseJsonResponse } from '@/lib/generation/json-repair';

export type JsonFailureReason = 'empty' | 'invalid_json' | 'schema_mismatch';

export function isGenerationDebugEnabled(
  req?: { headers?: { get?: (key: string) => string | null } },
): boolean {
  const envEnabled = process.env.GENERATION_DEBUG === 'true';
  const headerValue = req?.headers?.get?.('x-debug-generation');
  if (headerValue === 'true') return true;
  if (headerValue === 'false') return false;
  return envEnabled;
}

export function classifyJsonFailure(raw: string): JsonFailureReason {
  const normalized = normalizeModelOutput(raw);
  if (!normalized.trim()) return 'empty';
  const parsed = parseJsonResponse<unknown>(normalized);
  if (parsed === null) return 'invalid_json';
  return 'schema_mismatch';
}

export function snippet(text: string, max = 500): string {
  if (!text) return '';
  return text.length <= max ? text : `${text.slice(0, max)}...`;
}

export function normalizeModelOutput(raw: string): string {
  if (!raw) return '';
  const trimmed = raw.trim();
  if (!trimmed) return '';

  // Handle accidental SSE payloads (data: ... / :heartbeat) if they leak into parser path.
  if (trimmed.includes('\ndata:') || trimmed.startsWith('data:') || trimmed.includes(':heartbeat')) {
    const pieces: string[] = [];
    for (const line of trimmed.split(/\r?\n/)) {
      const t = line.trim();
      if (!t || t.startsWith(':')) continue;
      if (t.startsWith('data:')) {
        const payload = t.slice(5).trim();
        if (payload) pieces.push(payload);
        continue;
      }
      pieces.push(t);
    }
    return pieces.join('\n').trim();
  }

  return trimmed;
}
