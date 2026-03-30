/**
 * Scene Content Generation API
 *
 * Generates scene content (slides/quiz/interactive/pbl) from an outline.
 * This is the first half of the two-step scene generation pipeline.
 * Does NOT generate actions — use /api/generate/scene-actions for that.
 */

import { NextRequest } from 'next/server';
import { callLLM } from '@/lib/ai/llm';
import {
  applyOutlineFallbacks,
  generateSceneContent,
  buildVisionUserContent,
} from '@/lib/generation/generation-pipeline';
import type { AgentInfo, SceneGenerationContext } from '@/lib/generation/pipeline-types';
import type { SceneOutline, PdfImage, ImageMapping } from '@/lib/types/generation';
import { createLogger } from '@/lib/logger';
import { apiError, apiSuccess } from '@/lib/server/api-response';
import { resolveModel, resolveModelFromHeaders } from '@/lib/server/resolve-model';
import { classifyJsonFailure, isGenerationDebugEnabled, snippet } from '@/lib/server/generation-debug';

const log = createLogger('Scene Content API');

export const maxDuration = 300;

function isQuotaExceededError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /quota exceeded|rate limit|too many requests|429/i.test(message);
}

function getOllamaFallbackModel(sceneType: SceneOutline['type']): string {
  switch (sceneType) {
    case 'pbl':
      return 'deepseek-r1:8b';
    case 'quiz':
    case 'interactive':
    case 'slide':
    default:
      return 'qwen3.5:4b';
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const debugEnabled = isGenerationDebugEnabled(req);
    const {
      outline: rawOutline,
      allOutlines,
      pdfImages,
      imageMapping,
      stageInfo,
      stageId,
      agents,
    } = body as {
      outline: SceneOutline;
      allOutlines: SceneOutline[];
      pdfImages?: PdfImage[];
      imageMapping?: ImageMapping;
      stageInfo: {
        name: string;
        description?: string;
        language?: string;
        style?: string;
      };
      stageId: string;
      agents?: AgentInfo[];
    };

    // Validate required fields
    if (!rawOutline) {
      return apiError('MISSING_REQUIRED_FIELD', 400, 'outline is required');
    }
    if (!allOutlines || allOutlines.length === 0) {
      return apiError(
        'MISSING_REQUIRED_FIELD',
        400,
        'allOutlines is required and must not be empty',
      );
    }
    if (!stageId) {
      return apiError('MISSING_REQUIRED_FIELD', 400, 'stageId is required');
    }

    // Ensure outline has language from stageInfo (fallback for older outlines)
    const outline: SceneOutline = {
      ...rawOutline,
      language: rawOutline.language || (stageInfo?.language as 'hi-IN' | 'en-US') || 'hi-IN',
    };

    // ── Model resolution from request headers ──
    const { model: languageModel, modelInfo, modelString } = resolveModelFromHeaders(req, {
      stage: 'content',
    });

    // Detect vision capability
    const hasVision = !!modelInfo?.capabilities?.vision;
    const isLocalOllama = modelString.startsWith('ollama:');
    const compactJsonPrompt = isLocalOllama;
    const tunedMaxOutputTokens = isLocalOllama ? Math.min(modelInfo?.outputWindow || 800, 800) : modelInfo?.outputWindow;

    const usageRecords: Array<{
      promptTokens: number;
      completionTokens: number;
      totalTokens: number;
    }> = [];
    const textRecords: string[] = [];
    const createAICall = (
      model: unknown,
      outputWindow?: number,
      modelHasVision = false,
    ) => {
      return async (
        systemPrompt: string,
        userPrompt: string,
        images?: Array<{ id: string; src: string }>,
      ): Promise<string> => {
        const llmParams = {
          model,
          system: systemPrompt,
          prompt: images?.length && modelHasVision ? undefined : userPrompt,
          temperature: isLocalOllama ? 0.2 : undefined,
          topP: isLocalOllama ? 0.9 : undefined,
          messages:
            images?.length && modelHasVision
              ? [
                  {
                    role: 'user' as const,
                    content: buildVisionUserContent(userPrompt, images),
                  },
                ]
              : undefined,
          maxOutputTokens: isLocalOllama
            ? Math.min(outputWindow || 800, tunedMaxOutputTokens || 800)
            : outputWindow,
        } as unknown as Parameters<typeof callLLM>[0];
        const result = await callLLM(
          llmParams,
          'scene-content',
        );
        if (result.usage) {
          const usage = result.usage as unknown as Record<string, number | undefined>;
          const promptTokens = usage.promptTokens ?? usage.inputTokens ?? 0;
          const completionTokens = usage.completionTokens ?? usage.outputTokens ?? 0;
          usageRecords.push({
            promptTokens,
            completionTokens,
            totalTokens: usage.totalTokens ?? promptTokens + completionTokens,
          });
        }
        textRecords.push(result.text);
        return result.text;
      };
    };

    const aiCall = createAICall(languageModel, modelInfo?.outputWindow, hasVision);

    // ── Apply fallbacks ──
    const effectiveOutline = applyOutlineFallbacks(outline, !!languageModel);

    // ── Filter images assigned to this outline ──
    let assignedImages: PdfImage[] | undefined;
    if (
      pdfImages &&
      pdfImages.length > 0 &&
      effectiveOutline.suggestedImageIds &&
      effectiveOutline.suggestedImageIds.length > 0
    ) {
      const suggestedIds = new Set(effectiveOutline.suggestedImageIds);
      assignedImages = pdfImages.filter((img) => suggestedIds.has(img.id));
    }

    // ── Media generation is handled client-side in parallel ──
    let generatedMediaMapping: ImageMapping = {};

    // ── Generate content ──
    log.info(
      `Generating content: "${effectiveOutline.title}" (${effectiveOutline.type}) [model=${modelString}]`,
    );

    // ── Build course context for progressive complexity ──
    const allTitles = allOutlines.map((o) => o.title);
    const pageIndex = allOutlines.findIndex((o) => o.id === effectiveOutline.id);
    const ctx: SceneGenerationContext = {
      pageIndex: (pageIndex >= 0 ? pageIndex : 0) + 1,
      totalPages: allOutlines.length,
      allTitles,
      previousSpeeches: [],
    };

    let content;
    try {
      content = await generateSceneContent(
        effectiveOutline,
        aiCall,
        assignedImages,
        imageMapping,
        effectiveOutline.type === 'pbl' ? languageModel : undefined,
        hasVision,
        generatedMediaMapping,
        agents,
        {
          compactJsonPrompt,
          strictJsonRetry: true,
        },
        ctx,
      );
    } catch (error) {
      const shouldFallback =
        isQuotaExceededError(error) &&
        !modelString.startsWith('ollama:') &&
        process.env.OLLAMA_DISABLE_FALLBACK !== 'true';

      if (!shouldFallback) throw error;

      const fallbackModelId = getOllamaFallbackModel(effectiveOutline.type);
      const fallbackModelString = `ollama:${fallbackModelId}`;

      log.warn(
        `Primary model hit quota/rate-limit [model=${modelString}], retrying with local fallback [model=${fallbackModelString}]`,
      );

      const { model: fallbackModel, modelInfo: fallbackModelInfo } = resolveModel({
        modelString: fallbackModelString,
      });
      const fallbackHasVision = !!fallbackModelInfo?.capabilities?.vision;
      const fallbackAiCall = createAICall(
        fallbackModel,
        fallbackModelInfo?.outputWindow,
        fallbackHasVision,
      );

      generatedMediaMapping = {};
      content = await generateSceneContent(
        effectiveOutline,
        fallbackAiCall,
        assignedImages,
        imageMapping,
        effectiveOutline.type === 'pbl' ? fallbackModel : undefined,
        fallbackHasVision,
        generatedMediaMapping,
        agents,
        {
          compactJsonPrompt: fallbackModelString.startsWith('ollama:'),
          strictJsonRetry: true,
        },
        ctx,
      );
    }

    if (!content) {
      log.error(`Failed to generate content for: "${effectiveOutline.title}"`);
      const raw = textRecords.join('\n---\n');
      const reason = classifyJsonFailure(raw);
      const details = JSON.stringify({
        stage: 'content',
        reason,
        attempts: textRecords.length,
      });
      if (debugEnabled) {
        log.debug(
          `[scene-content] parse rejected [reason=${reason}] [attempts=${textRecords.length}]`,
          snippet(raw, 500),
        );
      }

      return apiError(
        'GENERATION_FAILED',
        500,
        `Failed to generate content: ${effectiveOutline.title}`,
        details,
      );
    }

    log.info(`Content generated successfully: "${effectiveOutline.title}"`);

    // Sum up usage
    const totalUsage = usageRecords.reduce(
      (acc, curr) => ({
        promptTokens: acc.promptTokens + (curr.promptTokens || 0),
        completionTokens: acc.completionTokens + (curr.completionTokens || 0),
        totalTokens: acc.totalTokens + (curr.totalTokens || 0),
      }),
      { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    );

    return apiSuccess({
      content,
      effectiveOutline,
      usage: totalUsage,
      model: modelString,
      rawText: textRecords.join('\n---\n'),
    });
  } catch (error) {
    log.error('Scene content generation error:', error);
    return apiError('INTERNAL_ERROR', 500, error instanceof Error ? error.message : String(error));
  }
}
