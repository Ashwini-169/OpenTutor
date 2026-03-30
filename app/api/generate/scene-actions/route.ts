/**
 * Scene Actions Generation API
 *
 * Generates actions for a scene given its outline and content,
 * then assembles the complete Scene object.
 * This is the second half of the two-step scene generation pipeline.
 */

import { NextRequest } from 'next/server';
import { callLLM } from '@/lib/ai/llm';
import {
  generateSceneActions,
  buildCompleteScene,
  buildVisionUserContent,
  type SceneGenerationContext,
  type AgentInfo,
} from '@/lib/generation/generation-pipeline';
import type { SceneOutline } from '@/lib/types/generation';
import type {
  GeneratedSlideContent,
  GeneratedQuizContent,
  GeneratedInteractiveContent,
  GeneratedPBLContent,
} from '@/lib/types/generation';
import type { SpeechAction } from '@/lib/types/action';
import { createLogger } from '@/lib/logger';
import { apiError, apiSuccess } from '@/lib/server/api-response';
import { resolveModelFromHeaders } from '@/lib/server/resolve-model';
import { classifyJsonFailure, isGenerationDebugEnabled, snippet } from '@/lib/server/generation-debug';

const log = createLogger('Scene Actions API');

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const debugEnabled = isGenerationDebugEnabled(req);
    const {
      outline,
      allOutlines,
      content,
      stageId,
      agents,
      previousSpeeches: incomingPreviousSpeeches,
      userProfile,
    } = body as {
      outline: SceneOutline;
      allOutlines: SceneOutline[];
      content:
        | GeneratedSlideContent
        | GeneratedQuizContent
        | GeneratedInteractiveContent
        | GeneratedPBLContent;
      stageId: string;
      agents?: AgentInfo[];
      previousSpeeches?: string[];
      userProfile?: string;
    };

    // Validate required fields
    if (!outline) {
      return apiError('MISSING_REQUIRED_FIELD', 400, 'outline is required');
    }
    if (!allOutlines || allOutlines.length === 0) {
      return apiError(
        'MISSING_REQUIRED_FIELD',
        400,
        'allOutlines is required and must not be empty',
      );
    }
    if (!content) {
      return apiError('MISSING_REQUIRED_FIELD', 400, 'content is required');
    }
    if (!stageId) {
      return apiError('MISSING_REQUIRED_FIELD', 400, 'stageId is required');
    }

    // ── Model resolution from request headers ──
    const { model: languageModel, modelInfo, modelString } = resolveModelFromHeaders(req, {
      stage: 'actions',
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
    // AI call function
    const aiCall = async (
      systemPrompt: string,
      userPrompt: string,
      images?: Array<{ id: string; src: string }>,
    ): Promise<string> => {
      const llmParams = {
        model: languageModel,
        system: systemPrompt,
        prompt: images?.length && hasVision ? undefined : userPrompt,
        temperature: isLocalOllama ? 0.2 : undefined,
        topP: isLocalOllama ? 0.9 : undefined,
        messages:
          images?.length && hasVision
            ? [
                {
                  role: 'user' as const,
                  content: buildVisionUserContent(userPrompt, images),
                },
              ]
            : undefined,
        maxOutputTokens: tunedMaxOutputTokens,
      } as unknown as Parameters<typeof callLLM>[0];
      const result = await callLLM(
        llmParams,
        'scene-actions',
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

    // ── Build cross-scene context ──
    const allTitles = allOutlines.map((o) => o.title);
    const pageIndex = allOutlines.findIndex((o) => o.id === outline.id);
    const ctx: SceneGenerationContext = {
      pageIndex: (pageIndex >= 0 ? pageIndex : 0) + 1,
      totalPages: allOutlines.length,
      allTitles,
      previousSpeeches: incomingPreviousSpeeches ?? [],
    };

    // ── Generate actions ──
    log.info(`Generating actions: "${outline.title}" (${outline.type}) [model=${modelString}]`);

    const actions = await generateSceneActions(outline, content, aiCall, ctx, agents, userProfile, {
      compactJsonPrompt,
      strictJsonRetry: true,
    });

    log.info(`Generated ${actions.length} actions for: "${outline.title}"`);

    // ── Build complete scene ──
    const scene = buildCompleteScene(outline, content, actions, stageId);

    if (!scene) {
      log.error(`Failed to build scene: "${outline.title}"`);
      const raw = textRecords.join('\n---\n');
      const reason = classifyJsonFailure(raw);
      const details = JSON.stringify({
        stage: 'actions',
        reason,
        attempts: textRecords.length,
      });
      if (debugEnabled) {
        log.debug(
          `[scene-actions] parse rejected [reason=${reason}] [attempts=${textRecords.length}]`,
          snippet(raw, 500),
        );
      }

      return apiError('GENERATION_FAILED', 500, `Failed to build scene: ${outline.title}`, details);
    }

    // ── Extract speeches for cross-scene coherence ──
    const outputPreviousSpeeches = (scene.actions || [])
      .filter((a): a is SpeechAction => a.type === 'speech')
      .map((a) => a.text);

    log.info(
      `Scene assembled successfully: "${outline.title}" — ${scene.actions?.length ?? 0} actions`,
    );

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
      scene,
      previousSpeeches: outputPreviousSpeeches,
      usage: totalUsage,
      model: modelString,
      rawText: textRecords.join('\n---\n'),
    });
  } catch (error) {
    log.error('Scene actions generation error:', error);
    return apiError('INTERNAL_ERROR', 500, error instanceof Error ? error.message : String(error));
  }
}
