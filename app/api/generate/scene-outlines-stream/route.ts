/**
 * Scene Outlines Streaming API (SSE)
 *
 * Streams outline generation via Server-Sent Events.
 * Emits individual outline objects as they're parsed from the LLM response,
 * so the frontend can display them incrementally.
 *
 * SSE events:
 *   { type: 'outline', data: SceneOutline, index: number }
 *   { type: 'done', outlines: SceneOutline[], usage: any, model: string }
 *   { type: 'retry', attempt: number, maxAttempts: number }
 *   { type: 'error', error: string }
 */

import { NextRequest } from 'next/server';
import { streamLLM } from '@/lib/ai/llm';
import { callLLM } from '@/lib/ai/llm';
import { buildPrompt, PROMPT_IDS } from '@/lib/generation/prompts';
import {
  formatImageDescription,
  formatImagePlaceholder,
  buildVisionUserContent,
  uniquifyMediaElementIds,
  formatTeacherPersonaForPrompt,
} from '@/lib/generation/generation-pipeline';
import type { AgentInfo } from '@/lib/generation/pipeline-types';
import { MAX_PDF_CONTENT_CHARS, MAX_VISION_IMAGES } from '@/lib/constants/generation';
import { nanoid } from 'nanoid';
import type {
  UserRequirements,
  PdfImage,
  SceneOutline,
  ImageMapping,
} from '@/lib/types/generation';
import { apiError } from '@/lib/server/api-response';
import { createLogger } from '@/lib/logger';
import { resolveModelFromHeaders } from '@/lib/server/resolve-model';
import { z } from 'zod';
import { parseJsonResponse } from '@/lib/generation/json-repair';
import {
  classifyJsonFailure,
  isGenerationDebugEnabled,
  normalizeModelOutput,
  type JsonFailureReason,
  snippet,
} from '@/lib/server/generation-debug';
import { buildCompactOutlinePrompt } from '@/lib/generation/outline-generator';

const log = createLogger('Outlines Stream');

export const maxDuration = 300;

const StreamOutlineSchema = z.object({
  id: z.string().optional(),
  type: z.enum(['slide', 'quiz', 'interactive', 'pbl']),
  title: z.string().min(1),
  moduleTitle: z.string().optional(),
  description: z.string().min(1),
  keyPoints: z.array(z.string()).min(1),
});

/**
 * Incremental JSON array parser.
 * Extracts complete top-level objects from a partially-streamed JSON array.
 * Returns newly found objects (skipping `alreadyParsed` count).
 */
function extractNewOutlines(buffer: string, alreadyParsed: number): SceneOutline[] {
  const results: SceneOutline[] = [];

  // Find the start of the JSON array (skip any markdown fencing)
  const stripped = buffer.replace(/^[\s\S]*?(?=\[)/, '');
  const arrayStart = stripped.indexOf('[');
  if (arrayStart === -1) return results;

  let depth = 0;
  let objectStart = -1;
  let inString = false;
  let escaped = false;
  let objectCount = 0;

  for (let i = arrayStart + 1; i < stripped.length; i++) {
    const char = stripped[i];

    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === '\\' && inString) {
      escaped = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;

    if (char === '{') {
      if (depth === 0) objectStart = i;
      depth++;
    } else if (char === '}') {
      depth--;
      if (depth === 0 && objectStart >= 0) {
        objectCount++;
        if (objectCount > alreadyParsed) {
          try {
            const obj = JSON.parse(stripped.substring(objectStart, i + 1));
            results.push(obj);
          } catch {
            // Incomplete or invalid JSON — skip
          }
        }
        objectStart = -1;
      }
    }
  }

  return results;
}

function parseOutlinesFromFinalText(text: string): SceneOutline[] {
  const normalized = normalizeModelOutput(text);
  if (!normalized.trim()) return [];
  const parsed = parseJsonResponse<unknown>(normalized);
  let candidate: unknown = parsed;
  // Support wrapper contract in addition to bare array.
  if (!Array.isArray(candidate) && candidate && typeof candidate === 'object') {
    const record = candidate as Record<string, unknown>;
    if (Array.isArray(record.scenes)) candidate = record.scenes;
  }
  if (!Array.isArray(candidate)) return [];
  const valid: SceneOutline[] = [];
  for (const item of candidate) {
    const validation = StreamOutlineSchema.safeParse(item);
    if (validation.success) valid.push(validation.data as SceneOutline);
  }
  return valid;
}

function formatFailureError(params: {
  stage: 'outline';
  reason: JsonFailureReason;
  attempts: number;
  message?: string;
}) {
  return {
    stage: params.stage,
    reason: params.reason,
    attempts: params.attempts,
    error: params.message || 'LLM response could not be parsed',
  };
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const debugEnabled = isGenerationDebugEnabled(req);

    // Get API configuration from request headers
    const { model: languageModel, modelInfo, modelString } = resolveModelFromHeaders(req, {
      stage: 'outline',
    });

    if (!body.requirements) {
      return apiError('MISSING_REQUIRED_FIELD', 400, 'Requirements are required');
    }

    const {
      requirements,
      pdfText,
      pdfImages,
      imageMapping,
      researchContext,
      agents,
      existingOutlines,
      nextModuleTopic,
    } = body as {
      requirements: UserRequirements;
      pdfText?: string;
      pdfImages?: PdfImage[];
      imageMapping?: ImageMapping;
      researchContext?: string;
      agents?: AgentInfo[];
      existingOutlines?: SceneOutline[];
      nextModuleTopic?: string;
    };

    // Detect vision capability
    const hasVision = !!modelInfo?.capabilities?.vision;

    // Build prompt
    let availableImagesText = 'No images available';
    let visionImages: Array<{ id: string; src: string }> | undefined;

    if (pdfImages && pdfImages.length > 0) {
      if (hasVision && imageMapping) {
        const allWithSrc = pdfImages.filter((img) => imageMapping[img.id]);
        const visionSlice = allWithSrc.slice(0, MAX_VISION_IMAGES);
        const textOnlySlice = allWithSrc.slice(MAX_VISION_IMAGES);
        const noSrcImages = pdfImages.filter((img) => !imageMapping[img.id]);

        const visionDescriptions = visionSlice.map((img) =>
          formatImagePlaceholder(img, requirements.language),
        );
        const textDescriptions = [...textOnlySlice, ...noSrcImages].map((img) =>
          formatImageDescription(img, requirements.language),
        );
        availableImagesText = [...visionDescriptions, ...textDescriptions].join('\n');

        visionImages = visionSlice.map((img) => ({
          id: img.id,
          src: imageMapping[img.id],
        }));
      } else {
        availableImagesText = pdfImages
          .map((img) => formatImageDescription(img, requirements.language))
          .join('\n');
      }
    }

    const imageGenerationEnabled = req.headers.get('x-image-generation-enabled') === 'true';
    const videoGenerationEnabled = req.headers.get('x-video-generation-enabled') === 'true';
    let mediaGenerationPolicy = '';
    if (!imageGenerationEnabled && !videoGenerationEnabled) {
      mediaGenerationPolicy = '**IMPORTANT: Do NOT include any mediaGenerations in the outlines. Both image and video generation are disabled.**';
    } else if (!imageGenerationEnabled) {
      mediaGenerationPolicy = '**IMPORTANT: Do NOT include any image mediaGenerations (type: "image") in the outlines. Image generation is disabled. Video generation is allowed.**';
    } else if (!videoGenerationEnabled) {
      mediaGenerationPolicy = '**IMPORTANT: Do NOT include any video mediaGenerations (type: "video") in the outlines. Video generation is disabled. Image generation is allowed.**';
    }

    const teacherContext = formatTeacherPersonaForPrompt(agents);
    const moduleCounts = (existingOutlines || [])
      .map(o => {
        const m = o.moduleTitle?.match(/Module (\d+)/);
        return m ? parseInt(m[1]) : 1;
      })
      .filter(n => !isNaN(n));
      
    const lastModuleNum = moduleCounts.length > 0 ? Math.max(...moduleCounts) : 1;

    const previousContext = existingOutlines && existingOutlines.length > 0
      ? `\n\n## Existing Outlines (Modules 1-${lastModuleNum})
The following outlines have already been generated. Continue from where they left off.
${existingOutlines.map(o => `- [${o.moduleTitle || 'Module ' + lastModuleNum}] ${o.title}`).join('\n')}`
      : '';

    const nextModuleInstruction = nextModuleTopic
      ? `\n\n## Next Module Focus
The user wants the next module to focus specifically on: ${nextModuleTopic}`
      : '';

    const extendModuleInstruction = body.extendModuleTopic
      ? `\n\n## Extend Existing Module
Please generate 3-5 more slides for the existing module: "${body.extendModuleTopic}". 
Maintain the same module title and continue the logical flow from existing slides in that module.`
      : '';

    const isLocalOllama = modelString.startsWith('ollama:');
    const prompts = isLocalOllama
      ? buildCompactOutlinePrompt({
          requirements: {
            ...requirements,
            requirement: `${requirements.requirement}${previousContext}${nextModuleInstruction}${extendModuleInstruction}`
          },
          pdfContent: pdfText ? pdfText.substring(0, Math.min(MAX_PDF_CONTENT_CHARS, 3000)) : 'None',
          availableImages: availableImagesText,
          mediaGenerationPolicy: mediaGenerationPolicy || 'Image and video generation are allowed.',
          researchContext: researchContext || 'None',
          teacherContext: teacherContext || 'None',
          userProfileText: '',
        })
      : buildPrompt(PROMPT_IDS.REQUIREMENTS_TO_OUTLINES, {
          requirement: `${requirements.requirement}${previousContext}${nextModuleInstruction}${extendModuleInstruction}`,
          language: requirements.language,
          pdfContent: pdfText
            ? pdfText.substring(0, MAX_PDF_CONTENT_CHARS)
            : 'None',
          availableImages: availableImagesText,
          researchContext: researchContext || 'None',
          mediaGenerationPolicy,
          teacherContext,
        });

    if (prompts && existingOutlines && existingOutlines.length > 0) {
      const currentModuleNum = Math.max(...existingOutlines.map(o => parseInt(o.moduleTitle?.match(/Module (\d+)/)?.[1] || '1')));
      const nextModuleNum = currentModuleNum + 1;
      prompts.user += `\n\n**IMPORTANT**: You are now generating **Module ${nextModuleNum}**. 
Output 4-8 scene outlines for this module. 
Every scene "moduleTitle" MUST start with "Module ${nextModuleNum}:".
Ensure the "order" starts from ${existingOutlines.length + 1}.`;
    }

    if (!prompts) {
      return apiError('INTERNAL_ERROR', 500, 'Prompt template not found');
    }

    log.info(`Generating outlines: "${requirements.requirement.substring(0, 50)}" [model=${modelString}]`);

    const encoder = new TextEncoder();
    const HEARTBEAT_INTERVAL_MS = 15_000;
    const stream = new ReadableStream({
      async start(controller) {
        let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
        const startHeartbeat = () => {
          stopHeartbeat();
          heartbeatTimer = setInterval(() => {
            try {
              controller.enqueue(encoder.encode(`:heartbeat\n\n`));
            } catch {
              stopHeartbeat();
            }
          }, HEARTBEAT_INTERVAL_MS);
        };
        const stopHeartbeat = () => {
          if (heartbeatTimer) {
            clearInterval(heartbeatTimer);
            heartbeatTimer = null;
          }
        };

        const MAX_STREAM_RETRIES = 2;

        try {
          startHeartbeat();

          const streamParams = visionImages?.length
            ? {
                model: languageModel,
                system: prompts.system,
                messages: [
                  {
                    role: 'user' as const,
                    content: buildVisionUserContent(prompts.user, visionImages),
                  },
                ],
                maxOutputTokens: isLocalOllama
                  ? Math.min(modelInfo?.outputWindow || 800, 800)
                  : modelInfo?.outputWindow,
                temperature: isLocalOllama ? 0.2 : undefined,
                topP: isLocalOllama ? 0.9 : undefined,
              }
            : {
                model: languageModel,
                system: prompts.system,
                prompt: prompts.user,
                maxOutputTokens: isLocalOllama
                  ? Math.min(modelInfo?.outputWindow || 800, 800)
                  : modelInfo?.outputWindow,
                temperature: isLocalOllama ? 0.2 : undefined,
                topP: isLocalOllama ? 0.9 : undefined,
              };

          let parsedOutlines: SceneOutline[] = [];
          let lastError: string | undefined;
          let lastReason: JsonFailureReason = 'empty';

          for (let attempt = 1; attempt <= MAX_STREAM_RETRIES + 1; attempt++) {
            try {
              const result = streamLLM(streamParams, 'scene-outlines-stream');

              let fullText = '';
              parsedOutlines = [];

              for await (const chunk of result.textStream) {
                fullText += chunk;
                const newOutlines = extractNewOutlines(fullText, parsedOutlines.length);
                for (const outline of newOutlines) {
                  const validation = StreamOutlineSchema.safeParse(outline);
                  if (!validation.success) continue;
                  const enriched = {
                    ...validation.data,
                    id: validation.data.id || nanoid(),
                    order: parsedOutlines.length + 1,
                  };
                  parsedOutlines.push(enriched);

                  const event = JSON.stringify({
                    type: 'outline',
                    data: enriched,
                    index: parsedOutlines.length - 1,
                  });
                  controller.enqueue(encoder.encode(`data: ${event}\n\n`));
                }
              }

              if (!fullText.trim()) {
                try {
                  // Some OpenAI-compatible providers may buffer and emit only final text.
                  // Fallback to the aggregated text before marking response as empty.
                  fullText = (await result.text) || '';
                } catch {
                  // Keep original fullText (empty) and continue with normal error handling.
                }
              }

              if (parsedOutlines.length === 0 && fullText.trim()) {
                const finalOutlines = parseOutlinesFromFinalText(fullText);
                for (const outline of finalOutlines) {
                  const enriched = {
                    ...outline,
                    id: outline.id || nanoid(),
                    order: parsedOutlines.length + 1,
                  };
                  parsedOutlines.push(enriched);
                  const event = JSON.stringify({
                    type: 'outline',
                    data: enriched,
                    index: parsedOutlines.length - 1,
                  });
                  controller.enqueue(encoder.encode(`data: ${event}\n\n`));
                }
              }

              if (parsedOutlines.length > 0) {
                // Success - send usage metrics
                const usage = await result.usage;
                const uniquifiedOutlines = uniquifyMediaElementIds(parsedOutlines);
                const doneEvent = JSON.stringify({
                  type: 'done',
                  outlines: uniquifiedOutlines,
                  usage,
                  model: modelString,
                });
                controller.enqueue(encoder.encode(`data: ${doneEvent}\n\n`));
                return;
              }

              lastReason = classifyJsonFailure(fullText);
              if (debugEnabled) {
                log.debug(
                  `[scene-outlines-stream] parse rejected [attempt=${attempt}] [reason=${lastReason}]`,
                  snippet(fullText, 500),
                );
                const debugEvent = JSON.stringify({
                  type: 'debug',
                  stage: 'outline',
                  attempt,
                  reason: lastReason,
                  model: modelString,
                });
                controller.enqueue(encoder.encode(`data: ${debugEvent}\n\n`));
              }
              lastError = fullText.trim() ? 'LLM response could not be parsed' : 'LLM returned empty';
              if (attempt <= MAX_STREAM_RETRIES) {
                const retryEvent = JSON.stringify({
                  type: 'retry',
                  attempt,
                  maxAttempts: MAX_STREAM_RETRIES + 1,
                  reason: lastReason,
                });
                controller.enqueue(encoder.encode(`data: ${retryEvent}\n\n`));
              }
            } catch (error) {
              lastError = error instanceof Error ? error.message : String(error);
              lastReason = 'invalid_json';
              if (attempt <= MAX_STREAM_RETRIES) {
                const retryEvent = JSON.stringify({
                  type: 'retry',
                  attempt,
                  maxAttempts: MAX_STREAM_RETRIES + 1,
                  reason: lastReason,
                });
                controller.enqueue(encoder.encode(`data: ${retryEvent}\n\n`));
                continue;
              }
            }
          }

          // Final bounded repair pass using non-stream call.
          if (parsedOutlines.length === 0) {
            try {
              const repairSuffix =
                '\n\nYour previous output was invalid. Regenerate and output ONLY valid JSON array matching the schema.';
              const repairParams = visionImages?.length
                ? {
                    model: languageModel,
                    system: prompts.system,
                    messages: [
                      {
                        role: 'user' as const,
                        content: buildVisionUserContent(`${prompts.user}${repairSuffix}`, visionImages),
                      },
                    ],
                    maxOutputTokens: isLocalOllama
                      ? Math.min(modelInfo?.outputWindow || 800, 800)
                      : modelInfo?.outputWindow,
                    temperature: isLocalOllama ? 0.2 : undefined,
                    topP: isLocalOllama ? 0.9 : undefined,
                  }
                : {
                    model: languageModel,
                    system: prompts.system,
                    prompt: `${prompts.user}${repairSuffix}`,
                    maxOutputTokens: isLocalOllama
                      ? Math.min(modelInfo?.outputWindow || 800, 800)
                      : modelInfo?.outputWindow,
                    temperature: isLocalOllama ? 0.2 : undefined,
                    topP: isLocalOllama ? 0.9 : undefined,
                  };
              const repairResult = await callLLM(repairParams, 'scene-outlines-repair');
              const repairedOutlines = parseOutlinesFromFinalText(repairResult.text || '');
              if (repairedOutlines.length > 0) {
                const enriched = repairedOutlines.map((outline, index) => ({
                  ...outline,
                  id: outline.id || nanoid(),
                  order: index + 1,
                }));
                const uniquifiedOutlines = uniquifyMediaElementIds(enriched);
                const doneEvent = JSON.stringify({
                  type: 'done',
                  outlines: uniquifiedOutlines,
                  usage: repairResult.usage,
                  model: modelString,
                });
                controller.enqueue(encoder.encode(`data: ${doneEvent}\n\n`));
                return;
              }
              lastReason = classifyJsonFailure(repairResult.text || '');
              lastError = 'LLM response could not be parsed';
              if (debugEnabled) {
                log.debug(
                  `[scene-outlines-stream] final repair failed [reason=${lastReason}]`,
                  snippet(repairResult.text || '', 500),
                );
              }
            } catch (repairError) {
              lastError = repairError instanceof Error ? repairError.message : String(repairError);
              lastReason = 'invalid_json';
            }
          }

          // If we reach here, all retries failed
          const errorEvent = JSON.stringify({
            type: 'error',
            ...formatFailureError({
              stage: 'outline',
              reason: lastReason,
              attempts: MAX_STREAM_RETRIES + 1,
              message: lastError || 'Failed to generate outlines',
            }),
          });
          controller.enqueue(encoder.encode(`data: ${errorEvent}\n\n`));
        } catch (error) {
          const errorEvent = JSON.stringify({ type: 'error', error: String(error) });
          controller.enqueue(encoder.encode(`data: ${errorEvent}\n\n`));
        } finally {
          stopHeartbeat();
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
    });
  } catch (error) {
    log.error('Streaming error:', error);
    return apiError('INTERNAL_ERROR', 500, String(error));
  }
}
