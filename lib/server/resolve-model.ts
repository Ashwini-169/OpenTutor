/**
 * Shared model resolution utilities for API routes.
 *
 * Extracts the repeated parseModelString → resolveApiKey → resolveBaseUrl →
 * resolveProxy → getModel boilerplate into a single call.
 */

import type { NextRequest } from 'next/server';
import { getModel, parseModelString, type ModelWithInfo } from '@/lib/ai/providers';
import { resolveApiKey, resolveBaseUrl, resolveProxy } from '@/lib/server/provider-config';
import { validateUrlForSSRF } from '@/lib/server/ssrf-guard';

export interface ResolvedModel extends ModelWithInfo {
  /** Original model string (e.g. "openai/gpt-4o-mini") */
  modelString: string;
}

export type GenerationStage = 'outline' | 'content' | 'actions';

const STAGE_MODEL_HEADERS: Record<GenerationStage, string> = {
  outline: 'x-outline-model',
  content: 'x-content-model',
  actions: 'x-actions-model',
};

const OLLAMA_STAGE_DEFAULT_MODELS: Record<GenerationStage, string> = {
  outline: 'ollama:qwen3.5:4b',
  content: 'ollama:qwen3.5:4b',
  actions: 'ollama:qwen2.5-coder:7b',
};

export function resolveStageModelString(
  baseModelString: string | undefined,
  stage: GenerationStage,
): string | undefined {
  if (!baseModelString) return undefined;
  const { providerId } = parseModelString(baseModelString);
  if (providerId !== 'ollama') return baseModelString;
  // Preserve the user's explicitly selected Ollama model by default.
  // Stage-specific defaults are only a fallback mechanism when no explicit
  // model is available in the request flow.
  if (baseModelString.trim().length > 0) return baseModelString;
  return OLLAMA_STAGE_DEFAULT_MODELS[stage];
}

/**
 * Resolve a language model from explicit parameters.
 *
 * Use this when model config comes from the request body.
 */
export function resolveModel(params: {
  modelString?: string;
  apiKey?: string;
  baseUrl?: string;
  providerType?: string;
  requiresApiKey?: boolean;
}): ResolvedModel {
  const modelString = params.modelString || process.env.DEFAULT_MODEL || 'gpt-4o-mini';
  const { providerId, modelId } = parseModelString(modelString);

  const clientBaseUrl = params.baseUrl || undefined;
  if (clientBaseUrl && process.env.NODE_ENV === 'production') {
    const ssrfError = validateUrlForSSRF(clientBaseUrl);
    if (ssrfError) {
      throw new Error(ssrfError);
    }
  }

  const apiKey = clientBaseUrl
    ? params.apiKey || ''
    : resolveApiKey(providerId, params.apiKey || '');
  const baseUrl = clientBaseUrl ? clientBaseUrl : resolveBaseUrl(providerId, params.baseUrl);
  const proxy = resolveProxy(providerId);
  const { model, modelInfo } = getModel({
    providerId,
    modelId,
    apiKey,
    baseUrl,
    proxy,
    providerType: params.providerType as 'openai' | 'anthropic' | 'google' | undefined,
    requiresApiKey: params.requiresApiKey,
  });

  return { model, modelInfo, modelString };
}

/**
 * Resolve a language model from standard request headers.
 *
 * Reads: x-model, x-api-key, x-base-url, x-provider-type, x-requires-api-key
 */
export function resolveModelFromHeaders(
  req: NextRequest,
  options?: {
    stage?: GenerationStage;
    preferredModelHeader?: string;
    applyOllamaStageDefaults?: boolean;
  },
): ResolvedModel {
  const baseModel = req.headers.get('x-model') || undefined;
  const preferredHeader =
    options?.preferredModelHeader || (options?.stage ? STAGE_MODEL_HEADERS[options.stage] : undefined);
  const preferredModel = preferredHeader ? req.headers.get(preferredHeader) || undefined : undefined;
  const shouldApplyStageDefaults =
    !!options?.stage &&
    options.applyOllamaStageDefaults !== false &&
    !preferredModel &&
    !!baseModel;

  const stageFallbackModel = shouldApplyStageDefaults
    ? resolveStageModelString(baseModel, options!.stage!)
    : undefined;

  return resolveModel({
    modelString: preferredModel || stageFallbackModel || baseModel,
    apiKey: req.headers.get('x-api-key') || undefined,
    baseUrl: req.headers.get('x-base-url') || undefined,
    providerType: req.headers.get('x-provider-type') || undefined,
    requiresApiKey: req.headers.get('x-requires-api-key') === 'true' ? true : undefined,
  });
}
