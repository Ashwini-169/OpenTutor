/**
 * Stage 1: Generate scene outlines from user requirements.
 * Also contains outline fallback logic.
 */

import { nanoid } from 'nanoid';
import { z } from 'zod';
import { MAX_PDF_CONTENT_CHARS, MAX_VISION_IMAGES } from '@/lib/constants/generation';
import type { UserRequirements, SceneOutline, PdfImage, ImageMapping } from '@/lib/types/generation';
import { buildPrompt, PROMPT_IDS } from './prompts';
import { formatImageDescription, formatImagePlaceholder } from './prompt-formatters';
import { parseJsonResponse } from './json-repair';
import { uniquifyMediaElementIds } from './scene-builder';
import type { AICallFn, GenerationResult, GenerationCallbacks } from './pipeline-types';
import { createLogger } from '@/lib/logger';

const log = createLogger('Generation');

const OutlineSchema = z.object({
  id: z.string().optional(),
  type: z.enum(['slide', 'quiz', 'interactive', 'pbl']),
  title: z.string().min(1),
  description: z.string().min(1),
  keyPoints: z.array(z.string()).min(1),
});

const OutlineArraySchema = z.array(OutlineSchema).min(1);
const OUTLINE_MAX_RETRIES = 3;

function classifyJsonFailureLocal(raw: string): 'empty' | 'invalid_json' | 'schema_mismatch' {
  const normalized = normalizeModelOutputLocal(raw);
  if (!normalized.trim()) return 'empty';
  const parsed = parseJsonResponse<unknown>(normalized);
  if (parsed === null) return 'invalid_json';
  return 'schema_mismatch';
}

function snippet(text: string, max = 500): string {
  if (!text) return '';
  return text.length <= max ? text : `${text.slice(0, max)}...`;
}

function normalizeModelOutputLocal(raw: string): string {
  if (!raw) return '';
  const trimmed = raw.trim();
  if (!trimmed) return '';
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

export function buildCompactOutlinePrompt(params: {
  requirements: UserRequirements;
  pdfContent: string;
  availableImages: string;
  mediaGenerationPolicy: string;
  researchContext: string;
  teacherContext: string;
  userProfileText: string;
}): { system: string; user: string } {
  return {
    system: `You are a JSON generator.
Rules:
- Output ONLY valid JSON.
- No markdown, no explanations, no extra text.
- Output must be a JSON array of scene outlines.
- Every item must include: type, title, description, keyPoints.
- type must be one of: slide, quiz, interactive, pbl.`,
    user: `Generate 4-8 scene outlines.
Requirement: ${params.requirements.requirement}
Language: ${params.requirements.language}
PDF Content:
${params.pdfContent}
Available Images:
${params.availableImages}
Research Context:
${params.researchContext}
Teacher Context:
${params.teacherContext || 'None'}
Student Profile:
${params.userProfileText || 'None'}
Media Policy:
${params.mediaGenerationPolicy || 'Image/video generation allowed when useful.'}`,
  };
}

/**
 * Generate scene outlines from user requirements
 * Now uses simplified UserRequirements with just requirement text and language
 */
export async function generateSceneOutlinesFromRequirements(
  requirements: UserRequirements,
  pdfText: string | undefined,
  pdfImages: PdfImage[] | undefined,
  aiCall: AICallFn,
  callbacks?: GenerationCallbacks,
  options?: {
    visionEnabled?: boolean;
    imageMapping?: ImageMapping;
    imageGenerationEnabled?: boolean;
    videoGenerationEnabled?: boolean;
    researchContext?: string;
    teacherContext?: string;
    compactJsonPrompt?: boolean;
    strictJsonRetry?: boolean;
  },
): Promise<GenerationResult<SceneOutline[]>> {
  // Build available images description for the prompt
  let availableImagesText = requirements.language === 'hi-IN' ? 'No images available' : 'No images available';
  let visionImages: Array<{ id: string; src: string }> | undefined;

  if (pdfImages && pdfImages.length > 0) {
    if (options?.visionEnabled && options?.imageMapping) {
      // Vision mode: split into vision images (first N) and text-only (rest)
      const allWithSrc = pdfImages.filter((img) => options.imageMapping![img.id]);
      const visionSlice = allWithSrc.slice(0, MAX_VISION_IMAGES);
      const textOnlySlice = allWithSrc.slice(MAX_VISION_IMAGES);
      const noSrcImages = pdfImages.filter((img) => !options.imageMapping![img.id]);

      const visionDescriptions = visionSlice.map((img) =>
        formatImagePlaceholder(img, requirements.language),
      );
      const textDescriptions = [...textOnlySlice, ...noSrcImages].map((img) =>
        formatImageDescription(img, requirements.language),
      );
      availableImagesText = [...visionDescriptions, ...textDescriptions].join('\n');

      visionImages = visionSlice.map((img) => ({
        id: img.id,
        src: options.imageMapping![img.id],
        width: img.width,
        height: img.height,
      }));
    } else {
      // Text-only mode: full descriptions
      availableImagesText = pdfImages
        .map((img) => formatImageDescription(img, requirements.language))
        .join('\n');
    }
  }

  // Build user profile string for prompt injection
  const userProfileText =
    requirements.userNickname || requirements.userBio
      ? `## Student Profile\n\nStudent: ${requirements.userNickname || 'Unknown'}${requirements.userBio ? ` - ${requirements.userBio}` : ''}\n\nConsider this student's background when designing the course. Adapt difficulty, examples, and teaching approach accordingly.\n\n---`
      : '';

  // Build media generation policy based on enabled flags
  const imageEnabled = options?.imageGenerationEnabled ?? false;
  const videoEnabled = options?.videoGenerationEnabled ?? false;
  let mediaGenerationPolicy = '';
  if (!imageEnabled && !videoEnabled) {
    mediaGenerationPolicy =
      '**IMPORTANT: Do NOT include any mediaGenerations in the outlines. Both image and video generation are disabled.**';
  } else if (!imageEnabled) {
    mediaGenerationPolicy =
      '**IMPORTANT: Do NOT include any image mediaGenerations (type: "image") in the outlines. Image generation is disabled. Video generation is allowed.**';
  } else if (!videoEnabled) {
    mediaGenerationPolicy =
      '**IMPORTANT: Do NOT include any video mediaGenerations (type: "video") in the outlines. Video generation is disabled. Image generation is allowed.**';
  }

  const truncatedPdfContent = pdfText
    ? pdfText.substring(0, MAX_PDF_CONTENT_CHARS)
    : requirements.language === 'hi-IN'
      ? 'None'
      : 'None';

  const researchContext = options?.researchContext || 'None';

  // Use simplified prompt variables
  const prompts = options?.compactJsonPrompt
    ? buildCompactOutlinePrompt({
        requirements,
        pdfContent: truncatedPdfContent,
        availableImages: availableImagesText,
        mediaGenerationPolicy,
        researchContext,
        teacherContext: options?.teacherContext || '',
        userProfileText,
      })
    : buildPrompt(PROMPT_IDS.REQUIREMENTS_TO_OUTLINES, {
        // New simplified variables
        requirement: requirements.requirement,
        language: requirements.language,
        pdfContent: truncatedPdfContent,
        availableImages: availableImagesText,
        userProfile: userProfileText,
        mediaGenerationPolicy,
        researchContext,
        // Server-side generation populates this via options; client-side populates via formatTeacherPersonaForPrompt
        teacherContext: options?.teacherContext || '',
      });

  if (!prompts) {
    return { success: false, error: 'Prompt template not found' };
  }

  try {
    const debugEnabled = process.env.GENERATION_DEBUG === 'true';
    callbacks?.onProgress?.({
      currentStage: 1,
      overallProgress: 20,
      stageProgress: 50,
      statusMessage: 'Analyzing requirements and generating outlines...',
      scenesGenerated: 0,
      totalScenes: 0,
    });

    let parsedOutlines: Array<z.infer<typeof OutlineSchema>> | null = null;
    let lastRawResponse = '';
    let lastReason: 'empty' | 'invalid_json' | 'schema_mismatch' = 'empty';

    for (let attempt = 1; attempt <= OUTLINE_MAX_RETRIES; attempt++) {
      const retrySuffix =
        attempt === 1 || !options?.strictJsonRetry
          ? ''
          : '\n\nYour previous response was invalid JSON or schema-invalid. Regenerate ONLY valid JSON array matching the required schema.';

      const response = await aiCall(prompts.system, `${prompts.user}${retrySuffix}`, visionImages);
      lastRawResponse = response;
      const outlines = parseJsonResponse<SceneOutline[]>(normalizeModelOutputLocal(response));
      if (!outlines || !Array.isArray(outlines)) {
        lastReason = classifyJsonFailureLocal(response);
        if (debugEnabled) {
          log.debug(
            `[outline-generator] parse rejected [attempt=${attempt}] [reason=${lastReason}]`,
            snippet(response, 400),
          );
        }
        continue;
      }
      const validation = OutlineArraySchema.safeParse(outlines);
      if (!validation.success) {
        lastReason = 'schema_mismatch';
        if (debugEnabled) {
          log.debug(
            `[outline-generator] schema rejected [attempt=${attempt}]`,
            validation.error.issues.slice(0, 3),
          );
        }
        continue;
      }
      parsedOutlines = validation.data;
      break;
    }

    if (!parsedOutlines) {
      log.error('Failed to parse/validate scene outlines response');
      log.error('Raw response (first 400 chars):', lastRawResponse.slice(0, 400));
      return {
        success: false,
        error: `Failed to parse scene outlines response [reason=${lastReason}]`,
      };
    }

    // Ensure IDs, order, and language
    const enriched = parsedOutlines.map((outline, index) => ({
      ...outline,
      id: outline.id || nanoid(),
      order: index + 1,
      language: requirements.language,
    }));

    // Replace sequential gen_img_N/gen_vid_N with globally unique IDs
    const result = uniquifyMediaElementIds(enriched);

    callbacks?.onProgress?.({
      currentStage: 1,
      overallProgress: 50,
      stageProgress: 100,
      statusMessage: `Generated ${result.length} scene outlines`,
      scenesGenerated: 0,
      totalScenes: result.length,
    });

    return { success: true, data: result };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

/**
 * Apply type fallbacks for outlines that can't be generated as their declared type.
 * - interactive without interactiveConfig -> slide
 * - pbl without pblConfig or languageModel -> slide
 */
export function applyOutlineFallbacks(
  outline: SceneOutline,
  hasLanguageModel: boolean,
): SceneOutline {
  if (outline.type === 'interactive' && !outline.interactiveConfig) {
    log.warn(
      `Interactive outline "${outline.title}" missing interactiveConfig, falling back to slide`,
    );
    return { ...outline, type: 'slide' };
  }
  if (outline.type === 'pbl' && (!outline.pblConfig || !hasLanguageModel)) {
    log.warn(
      `PBL outline "${outline.title}" missing pblConfig or languageModel, falling back to slide`,
    );
    return { ...outline, type: 'slide' };
  }
  return outline;
}
