/**
 * Stage 2: Scene content and action generation.
 *
 * Generates full scenes (slide/quiz/interactive/pbl with actions)
 * from scene outlines.
 */

import { nanoid } from 'nanoid';
import katex from 'katex';
import { MAX_VISION_IMAGES } from '@/lib/constants/generation';
import type {
  SceneOutline,
  GeneratedSlideContent,
  GeneratedQuizContent,
  GeneratedInteractiveContent,
  GeneratedPBLContent,
  ScientificModel,
  PdfImage,
  ImageMapping,
} from '@/lib/types/generation';
import type { LanguageModel } from 'ai';
import { z } from 'zod';
import type { StageStore } from '@/lib/api/stage-api';
import { createStageAPI } from '@/lib/api/stage-api';
import { generatePBLContent } from '@/lib/pbl/generate-pbl';
import { buildPrompt, PROMPT_IDS } from './prompts';
import { postProcessInteractiveHtml } from './interactive-post-processor';
import { parseActionsFromStructuredOutput } from './action-parser';
import { parseJsonResponse } from './json-repair';
import {
  buildCourseContext,
  formatAgentsForPrompt,
  formatTeacherPersonaForPrompt,
  formatImageDescription,
  formatImagePlaceholder,
} from './prompt-formatters';
import type { PPTElement, Slide, SlideBackground, SlideTheme } from '@/lib/types/slides';
import type { QuizQuestion } from '@/lib/types/stage';
import type { Action } from '@/lib/types/action';
import type {
  AgentInfo,
  SceneGenerationContext,
  GeneratedSlideData,
  AICallFn,
  GenerationResult,
  GenerationCallbacks,
} from './pipeline-types';
import { createLogger } from '@/lib/logger';
const log = createLogger('Generation');

const SCENE_JSON_MAX_RETRIES = 3;

const MinimalSlideDataSchema = z.object({
  elements: z.array(z.record(z.string(), z.unknown())).min(1),
  background: z.record(z.string(), z.unknown()).optional(),
  remark: z.string().optional(),
});

const MinimalQuizQuestionSchema = z.object({
  type: z.string().optional(),
  question: z.string().optional(),
});

const MinimalQuizSchema = z.array(MinimalQuizQuestionSchema).min(1);

const MinimalActionSchema = z.object({
  type: z.string(),
});

const MinimalActionsSchema = z.array(MinimalActionSchema).min(1);

interface SceneGenerationOptions {
  compactJsonPrompt?: boolean;
  strictJsonRetry?: boolean;
}

/**
 * Returns a content complexity guide for a given slide index.
 * Used in the compact Ollama prompt path ONLY.
 * Slide 1 is deliberately minimal so the first slide appears fast.
 *
 * Each template includes EXACT non-overlapping (left, top, width, height) coordinates
 * so small models don't need to calculate layout.
 * Canvas: 1000 x 562.5 with 50px margins.
 */
function getSlideComplexityGuide(pageIndex: number, totalPages: number): string {
  const isFirst = pageIndex === 1;
  const isLast = pageIndex === totalPages;
  const isEarly = pageIndex <= 2;
  const isMiddle = pageIndex >= 3 && pageIndex <= 5;

  if (isFirst) {
    return `COMPLEXITY: MINIMAL (slide 1 of ${totalPages}). Fast render priority.
USE THESE EXACT POSITIONS (do NOT change left/top/width/height):
  title_1:  {"type":"text","id":"title_1","left":60,"top":40,"width":880,"height":76}
  text_1:   {"type":"text","id":"text_1","left":60,"top":140,"width":880,"height":50}
  text_2:   {"type":"text","id":"text_2","left":60,"top":200,"width":880,"height":50}
  text_3:   {"type":"text","id":"text_3","left":60,"top":260,"width":880,"height":50}
NO shapes, NO cards, NO charts, NO images. Only 2-4 text elements max.`;
  }

  if (isEarly) {
    return `COMPLEXITY: LIGHT (slide ${pageIndex} of ${totalPages}).
USE THESE EXACT POSITIONS (do NOT change left/top/width/height):
  title_1:    {"type":"text","id":"title_1","left":60,"top":40,"width":880,"height":76}
  card_bg_1:  {"type":"shape","id":"card_bg_1","left":60,"top":140,"width":400,"height":130,"fill":"#e8f4fd"}
  card_txt_1: {"type":"text","id":"card_txt_1","left":80,"top":155,"width":360,"height":100}
  card_bg_2:  {"type":"shape","id":"card_bg_2","left":520,"top":140,"width":400,"height":130,"fill":"#e8f4fd"}
  card_txt_2: {"type":"text","id":"card_txt_2","left":540,"top":155,"width":360,"height":100}
  text_1:     {"type":"text","id":"text_1","left":60,"top":300,"width":880,"height":200}
Max 7 elements. Cards use shape behind text at same position.`;
  }

  if (isMiddle) {
    return `COMPLEXITY: MODERATE (slide ${pageIndex} of ${totalPages}).
USE THESE EXACT POSITIONS (do NOT change left/top/width/height):
  title_1:    {"type":"text","id":"title_1","left":60,"top":40,"width":880,"height":76}
  card_bg_1:  {"type":"shape","id":"card_bg_1","left":60,"top":140,"width":420,"height":160,"fill":"#eef4ff"}
  card_txt_1: {"type":"text","id":"card_txt_1","left":80,"top":155,"width":380,"height":130}
  card_bg_2:  {"type":"shape","id":"card_bg_2","left":520,"top":140,"width":420,"height":160,"fill":"#fff3e0"}
  card_txt_2: {"type":"text","id":"card_txt_2","left":540,"top":155,"width":380,"height":130}
  text_1:     {"type":"text","id":"text_1","left":60,"top":330,"width":880,"height":180}
Max 8 elements.`;
  }

  if (isLast) {
    return `COMPLEXITY: SUMMARY (last slide, ${pageIndex} of ${totalPages}).
USE THESE EXACT POSITIONS (do NOT change left/top/width/height):
  title_1:    {"type":"text","id":"title_1","left":60,"top":40,"width":880,"height":76}
  card_bg_1:  {"type":"shape","id":"card_bg_1","left":60,"top":140,"width":880,"height":130,"fill":"#e8f5e9"}
  card_txt_1: {"type":"text","id":"card_txt_1","left":80,"top":155,"width":840,"height":100}
  text_1:     {"type":"text","id":"text_1","left":60,"top":300,"width":880,"height":200}
Max 6 elements. Clean summary layout.`;
  }

  return `COMPLEXITY: RICH (slide ${pageIndex} of ${totalPages}).
USE THESE EXACT POSITIONS (do NOT change left/top/width/height):
  title_1:    {"type":"text","id":"title_1","left":60,"top":40,"width":880,"height":76}
  card_bg_1:  {"type":"shape","id":"card_bg_1","left":60,"top":140,"width":420,"height":130,"fill":"#e8f4fd"}
  card_txt_1: {"type":"text","id":"card_txt_1","left":80,"top":155,"width":380,"height":100}
  card_bg_2:  {"type":"shape","id":"card_bg_2","left":520,"top":140,"width":420,"height":130,"fill":"#fff3e0"}
  card_txt_2: {"type":"text","id":"card_txt_2","left":540,"top":155,"width":380,"height":100}
  card_bg_3:  {"type":"shape","id":"card_bg_3","left":60,"top":300,"width":880,"height":130,"fill":"#fce4ec"}
  card_txt_3: {"type":"text","id":"card_txt_3","left":80,"top":315,"width":840,"height":100}
Max 10 elements.`;
}

function withJsonRetrySuffix(baseUserPrompt: string, attempt: number, strict = true): string {
  if (attempt === 1 || !strict) return baseUserPrompt;
  return `${baseUserPrompt}\n\nPrevious output was invalid JSON or schema-invalid. Regenerate ONLY valid JSON matching the required structure.`;
}

// ==================== Stage 2: Full Scenes (Two-Step) ====================

/**
 * Stage 3: Generate full scenes (parallel version)
 *
 * Two steps:
 * - Step 3.1: Outline -> Page content (slide/quiz)
 * - Step 3.2: Content + script -> Action list
 *
 * All scenes generated in parallel using Promise.all
 */
export async function generateFullScenes(
  sceneOutlines: SceneOutline[],
  store: StageStore,
  aiCall: AICallFn,
  callbacks?: GenerationCallbacks,
): Promise<GenerationResult<string[]>> {
  const api = createStageAPI(store);
  const totalScenes = sceneOutlines.length;
  let completedCount = 0;

  callbacks?.onProgress?.({
    currentStage: 3,
    overallProgress: 66,
    stageProgress: 0,
    statusMessage: `Generating ${totalScenes} scenes in parallel...`,
    scenesGenerated: 0,
    totalScenes,
  });

  // Generate all scenes in parallel
  const results = await Promise.all(
    sceneOutlines.map(async (outline, index) => {
      try {
        const sceneId = await generateSingleScene(outline, api, aiCall);

        completedCount++;
        callbacks?.onProgress?.({
          currentStage: 3,
          overallProgress: 66 + Math.floor((completedCount / totalScenes) * 34),
          stageProgress: Math.floor((completedCount / totalScenes) * 100),
          statusMessage: `Completed ${completedCount}/${totalScenes} scenes`,
          scenesGenerated: completedCount,
          totalScenes,
        });

        return { success: true, sceneId, index };
      } catch (error) {
        completedCount++;
        callbacks?.onError?.(`Failed to generate scene ${outline.title}: ${error}`);
        return { success: false, sceneId: null, index };
      }
    }),
  );

  const sceneIds = results
    .filter(
      (r): r is { success: true; sceneId: string; index: number } =>
        r.success && r.sceneId !== null,
    )
    .sort((a, b) => a.index - b.index)
    .map((r) => r.sceneId);

  return { success: true, data: sceneIds };
}

/**
 * Generate a single scene (two-step process)
 */
async function generateSingleScene(
  outline: SceneOutline,
  api: ReturnType<typeof createStageAPI>,
  aiCall: AICallFn,
): Promise<string | null> {
  // Step 3.1: Generate content
  log.info(`Step 3.1: Generating content for: ${outline.title}`);
  const content = await generateSceneContent(outline, aiCall);
  if (!content) {
    log.error(`Failed to generate content for: ${outline.title}`);
    return null;
  }

  // Step 3.2: Generate Actions
  log.info(`Step 3.2: Generating actions for: ${outline.title}`);
  const actions = await generateSceneActions(outline, content, aiCall);
  log.info(`Generated ${actions.length} actions for: ${outline.title}`);

  // Create complete Scene
  return createSceneWithActions(outline, content, actions, api);
}

/**
 * Step 3.1: Generate content based on outline
 */
export async function generateSceneContent(
  outline: SceneOutline,
  aiCall: AICallFn,
  assignedImages?: PdfImage[],
  imageMapping?: ImageMapping,
  languageModel?: LanguageModel,
  visionEnabled?: boolean,
  generatedMediaMapping?: ImageMapping,
  agents?: AgentInfo[],
  generationOptions?: SceneGenerationOptions,
  ctx?: SceneGenerationContext,
): Promise<
  | GeneratedSlideContent
  | GeneratedQuizContent
  | GeneratedInteractiveContent
  | GeneratedPBLContent
  | null
> {
  // If outline is interactive but missing interactiveConfig, fall back to slide
  if (outline.type === 'interactive' && !outline.interactiveConfig) {
    log.warn(
      `Interactive outline "${outline.title}" missing interactiveConfig, falling back to slide`,
    );
    outline.type = 'slide' as const;
  }
  
  // If outline is pbl but missing pblConfig or languageModel, fall back to slide
  if (outline.type === 'pbl' && (!outline.pblConfig || !languageModel)) {
    log.warn(
      `PBL outline "${outline.title}" missing pblConfig or languageModel, falling back to slide`,
    );
    outline.type = 'slide' as const;
  }

  switch (outline.type) {
    case 'slide':
      return generateSlideContent(
        outline,
        aiCall,
        assignedImages,
        imageMapping,
        visionEnabled,
        generatedMediaMapping,
        agents,
        generationOptions,
        ctx,
      );
    case 'quiz':
      return generateQuizContent(outline, aiCall, generationOptions);
    case 'interactive':
      return generateInteractiveContent(outline, aiCall, outline.language);
    case 'pbl':
      return generatePBLSceneContent(outline, languageModel);
    default:
      return null;
  }
}

/**
 * Check if a string looks like an image ID (e.g., "img_1", "img_2")
 * rather than a base64 data URL or actual URL
 *
 * This function distinguishes between:
 * - Image IDs: "img_1", "img_2", etc. → returns true
 * - Base64 data URLs: "data:image/..." → returns false
 * - HTTP URLs: "http://...", "https://..." → returns false
 * - Relative paths: "/images/..." → returns false
 */
function isImageIdReference(value: string): boolean {
  if (!value) return false;
  // Exclude real URLs and paths
  if (value.startsWith('data:')) return false;
  if (value.startsWith('http://') || value.startsWith('https://')) return false;
  if (value.startsWith('/')) return false; // Relative paths
  // Match image ID format: img_1, img_2, etc.
  return /^img_\d+$/i.test(value);
}

/**
 * Check if a string looks like a generated image/video ID (e.g., "gen_img_1", "gen_img_xK8f2mQ")
 * These are placeholders for AI-generated media, not PDF-extracted images.
 */
function isGeneratedImageId(value: string): boolean {
  if (!value) return false;
  return /^gen_(img|vid)_[\w-]+$/i.test(value);
}

/**
 * Resolve image ID references in src field to actual base64 URLs
 *
 * AI generates: { type: "image", src: "img_1", ... }
 * This function replaces: { type: "image", src: "data:image/png;base64,...", ... }
 *
 * Design rationale (Plan B):
 * - Simpler: AI only needs to know one field (src)
 * - Consistent: Generated JSON structure matches final PPTImageElement
 * - Intuitive: src is the image source, first as ID then as actual URL
 * - Less prompt complexity: No need to explain imageId vs src distinction
 */
function resolveImageIds(
  elements: GeneratedSlideData['elements'],
  imageMapping?: ImageMapping,
  generatedMediaMapping?: ImageMapping,
): GeneratedSlideData['elements'] {
  return elements
    .map((el) => {
      if (el.type === 'image') {
        if (!('src' in el)) {
          log.warn(`Image element missing src, removing element`);
          return null; // Remove invalid image elements
        }
        const src = el.src as string;

        // If src is an image ID reference, replace with actual URL
        if (isImageIdReference(src)) {
          if (!imageMapping || !imageMapping[src]) {
            log.warn(`No mapping for image ID: ${src}, removing element`);
            return null; // Remove invalid image elements
          }
          log.debug(`Resolved image ID "${src}" to base64 URL`);
          return { ...el, src: imageMapping[src] };
        }

        // Generated image reference — keep as placeholder for async backfill
        if (isGeneratedImageId(src)) {
          if (generatedMediaMapping && generatedMediaMapping[src]) {
            log.debug(`Resolved generated image ID "${src}" to URL`);
            return { ...el, src: generatedMediaMapping[src] };
          }
          // Keep element with placeholder ID — frontend renders skeleton
          log.debug(`Keeping generated image placeholder: ${src}`);
          return el;
        }
      }

      if (el.type === 'video') {
        if (!('src' in el)) {
          log.warn(`Video element missing src, removing element`);
          return null;
        }
        const src = el.src as string;
        if (isGeneratedImageId(src)) {
          if (generatedMediaMapping && generatedMediaMapping[src]) {
            log.debug(`Resolved generated video ID "${src}" to URL`);
            return { ...el, src: generatedMediaMapping[src] };
          }
          // Keep element with placeholder ID — frontend renders skeleton
          log.debug(`Keeping generated video placeholder: ${src}`);
          return el;
        }
      }

      return el;
    })
    .filter((el): el is NonNullable<typeof el> => el !== null);
}

/**
 * Fix elements with missing required fields
 * Adds default values for fields that AI might not have generated correctly
 */
function fixElementDefaults(
  elements: GeneratedSlideData['elements'],
  assignedImages?: PdfImage[],
): GeneratedSlideData['elements'] {
  return elements.map((el) => {
    // Fix line elements
    if (el.type === 'line') {
      const lineEl = el as Record<string, unknown>;

      // Ensure points field exists with default values
      if (!lineEl.points || !Array.isArray(lineEl.points) || lineEl.points.length !== 2) {
        log.warn(`Line element missing points, adding defaults`);
        lineEl.points = ['', ''] as [string, string]; // Default: no markers on either end
      }

      // Ensure start/end exist
      if (!lineEl.start || !Array.isArray(lineEl.start)) {
        lineEl.start = [el.left ?? 0, el.top ?? 0];
      }
      if (!lineEl.end || !Array.isArray(lineEl.end)) {
        lineEl.end = [(el.left ?? 0) + (el.width ?? 100), (el.top ?? 0) + (el.height ?? 0)];
      }

      // Ensure style exists
      if (!lineEl.style) {
        lineEl.style = 'solid';
      }

      // Ensure color exists
      if (!lineEl.color) {
        lineEl.color = '#333333';
      }

      return lineEl as typeof el;
    }

    // Fix text elements
    if (el.type === 'text') {
      const textEl = el as Record<string, unknown>;

      if (!textEl.defaultFontName) {
        textEl.defaultFontName = 'Microsoft YaHei';
      }
      if (!textEl.defaultColor) {
        textEl.defaultColor = '#333333';
      }
      if (!textEl.content) {
        textEl.content = '';
      }

      return textEl as typeof el;
    }

    // Fix image elements
    if (el.type === 'image') {
      const imageEl = el as Record<string, unknown>;

      if (imageEl.fixedRatio === undefined) {
        imageEl.fixedRatio = true;
      }

      // Correct dimensions using known aspect ratio (src is still img_id at this point)
      if (assignedImages && typeof imageEl.src === 'string') {
        const imgMeta = assignedImages.find((img) => img.id === imageEl.src);
        if (imgMeta?.width && imgMeta?.height) {
          const knownRatio = imgMeta.width / imgMeta.height;
          const curW = (el.width || 400) as number;
          const curH = (el.height || 300) as number;
          if (Math.abs(curW / curH - knownRatio) / knownRatio > 0.1) {
            // Keep width, correct height
            const newH = Math.round(curW / knownRatio);
            if (newH > 462) {
              // canvas 562.5 - margins 50×2
              const newW = Math.round(462 * knownRatio);
              imageEl.width = newW;
              imageEl.height = 462;
            } else {
              imageEl.height = newH;
            }
          }
        }
      }

      return imageEl as typeof el;
    }

    // Fix shape elements
    if (el.type === 'shape') {
      const shapeEl = el as Record<string, unknown>;

      if (!shapeEl.viewBox) {
        shapeEl.viewBox = `0 0 ${el.width ?? 100} ${el.height ?? 100}`;
      }
      if (!shapeEl.path) {
        // Default to rectangle
        const w = el.width ?? 100;
        const h = el.height ?? 100;
        shapeEl.path = `M0 0 L${w} 0 L${w} ${h} L0 ${h} Z`;
      }
      if (!shapeEl.fill) {
        shapeEl.fill = '#5b9bd5';
      }
      if (shapeEl.fixedRatio === undefined) {
        shapeEl.fixedRatio = false;
      }

      return shapeEl as typeof el;
    }

    return el;
  });
}

/**
 * Process LaTeX elements: render latex string to HTML using KaTeX.
 * Fills in html and fixedRatio fields.
 * Elements that fail conversion are removed.
 */
function processLatexElements(
  elements: GeneratedSlideData['elements'],
): GeneratedSlideData['elements'] {
  return elements
    .map((el) => {
      if (el.type !== 'latex') return el;

      const latexStr = el.latex as string | undefined;
      if (!latexStr) {
        log.warn('Latex element missing latex string, removing');
        return null;
      }

      try {
        const html = katex.renderToString(latexStr, {
          throwOnError: false,
          displayMode: true,
          output: 'html',
        });

        return {
          ...el,
          html,
          fixedRatio: true,
        };
      } catch (err) {
        log.warn(`Failed to render latex "${latexStr}":`, err);
        return null;
      }
    })
    .filter((el): el is NonNullable<typeof el> => el !== null);
}

/**
 * Generate slide content
 */
async function generateSlideContent(
  outline: SceneOutline,
  aiCall: AICallFn,
  assignedImages?: PdfImage[],
  imageMapping?: ImageMapping,
  visionEnabled?: boolean,
  generatedMediaMapping?: ImageMapping,
  agents?: AgentInfo[],
  generationOptions?: SceneGenerationOptions,
  ctx?: SceneGenerationContext,
): Promise<GeneratedSlideContent | null> {
  const lang = outline.language || 'hi-IN';

  // Build assigned images description for the prompt
  let assignedImagesText = 'No images available. Do NOT insert any image elements.';
  let visionImages: Array<{ id: string; src: string }> | undefined;

  if (assignedImages && assignedImages.length > 0) {
    if (visionEnabled && imageMapping) {
      // Vision mode: split into vision images and text-only
      const withSrc = assignedImages.filter((img) => imageMapping[img.id]);
      const visionSlice = withSrc.slice(0, MAX_VISION_IMAGES);
      const textOnlySlice = withSrc.slice(MAX_VISION_IMAGES);
      const noSrcImages = assignedImages.filter((img) => !imageMapping[img.id]);

      const visionDescriptions = visionSlice.map((img) => formatImagePlaceholder(img, lang));
      const textDescriptions = [...textOnlySlice, ...noSrcImages].map((img) =>
        formatImageDescription(img, lang),
      );
      assignedImagesText = [...visionDescriptions, ...textDescriptions].join('\n');

      visionImages = visionSlice.map((img) => ({
        id: img.id,
        src: imageMapping[img.id],
        width: img.width,
        height: img.height,
      }));
    } else {
      assignedImagesText = assignedImages
        .map((img) => formatImageDescription(img, lang))
        .join('\n');
    }
  }

  // Add generated media placeholders info (images + videos)
  if (outline.mediaGenerations && outline.mediaGenerations.length > 0) {
    const genImgDescs = outline.mediaGenerations
      .filter((mg) => mg.type === 'image')
      .map((mg) => `- ${mg.elementId}: "${mg.prompt}" (aspect ratio: ${mg.aspectRatio || '16:9'})`)
      .join('\n');
    const genVidDescs = outline.mediaGenerations
      .filter((mg) => mg.type === 'video')
      .map((mg) => `- ${mg.elementId}: "${mg.prompt}" (aspect ratio: ${mg.aspectRatio || '16:9'})`)
      .join('\n');

    const mediaParts: string[] = [];
    if (genImgDescs) {
      mediaParts.push(`AI-Generated Images (use these IDs as image element src):\n${genImgDescs}`);
    }
    if (genVidDescs) {
      mediaParts.push(`AI-Generated Videos (use these IDs as video element src):\n${genVidDescs}`);
    }

    if (mediaParts.length > 0) {
      const mediaText = mediaParts.join('\n\n');
      if (assignedImagesText.includes('禁止插入') || assignedImagesText.includes('No images')) {
        assignedImagesText = mediaText;
      } else {
        assignedImagesText += `\n\n${mediaText}`;
      }
    }
  }

  // Canvas dimensions (matching viewportSize and viewportRatio)
  const canvasWidth = 1000;
  const canvasHeight = 562.5;

  const teacherContext = formatTeacherPersonaForPrompt(agents);
  // Progressive complexity: page 1 is minimal for fast render, later slides grow richer
  const pageIndex = ctx?.pageIndex ?? 1;
  const totalPages = ctx?.totalPages ?? 1;
  const complexityGuide = getSlideComplexityGuide(pageIndex, totalPages);

  // Determine language label for prompt
  const langLabel = lang === 'hi-IN' ? 'Hinglish (Hindi+English mix — keep technical terms in English, use Hindi for labels and connectors)' : 'English';

    const prompts = generationOptions?.compactJsonPrompt
    ? {
        system: `You are a JSON slide generator for small language models (qwen2.5, qwen3.5 series).

STRICT RULES:
1. Output ONLY valid JSON object. No markdown. No code fences. No explanation.
2. Return: { "background": {"type":"solid","color":"#ffffff"}, "elements": [...] }
3. "elements" must have at least 2 items.
4. No duplicate "id" values.
5. Element types allowed: text, shape, line, chart.

HEADING STYLE (MANDATORY):
- Title: {"type":"text","id":"title_1","left":60,"top":50,"width":880,"height":76,"content":"<p style=\\"font-size:32px;\\"><strong>TITLE HERE</strong></p>","defaultFontName":"","defaultColor":"#1a237e"}
- Subtitle: {"type":"text","content":"<p style=\\"font-size:22px;\\"><strong>Subtitle</strong></p>",...}
- Body bullet: {"type":"text","content":"<p style=\\"font-size:18px;\\">• Point here</p>",...}
NEVER use <h1>, <h2>, <h3> tags. ALWAYS use <p style=\"font-size:Npx;\"> tags.

BACKGROUND CARD PATTERN (use for key point cards):
  Shape first: {"type":"shape","id":"card_bg_1","left":60,"top":150,"width":400,"height":100,"path":"M 0 0 L 1 0 L 1 1 L 0 1 Z","viewBox":[1,1],"fill":"#e8f4fd","fixedRatio":false}
  Text on top:  {"type":"text","id":"card_txt_1","left":80,"top":165,"width":360,"height":70,"content":"<p style=\\"font-size:18px;\\">Point text</p>","defaultFontName":"","defaultColor":"#1a237e"}

POSITIONING RULE (CRITICAL — prevents element overlap):
- The user prompt contains a COMPLEXITY section with EXACT element positions.
- You MUST copy left/top/width/height values from those positions EXACTLY.
- Do NOT invent your own positions — use ONLY the coordinates provided.
- Elements must NEVER overlap: no two elements sharing the same vertical space.
- All shapes MUST include: "path":"M 0 0 L 1 0 L 1 1 L 0 1 Z","viewBox":[1,1],"fixedRatio":false

CANVAS: ${canvasWidth}x${canvasHeight}. Margins: 50px all sides.`,
        user: `${complexityGuide}

Language: ${langLabel}
Title: ${outline.title}
Description: ${outline.description}
Key points:
${(outline.keyPoints || []).map((p, i) => `${i + 1}. ${p}`).join('\n')}
Available images/media: ${assignedImagesText}
Teacher context: ${teacherContext || 'None'}

Output valid JSON only:`,
      }
    : buildPrompt(PROMPT_IDS.SLIDE_CONTENT, {
        title: outline.title,
        description: outline.description,
        keyPoints: (outline.keyPoints || []).map((p, i) => `${i + 1}. ${p}`).join('\n'),
        elements: 'auto-generate from key points',
        assignedImages: assignedImagesText,
        canvas_width: canvasWidth,
        canvas_height: canvasHeight,
        teacherContext,
      });

  if (!prompts) {
    return null;
  }

  log.debug(`Generating slide content for: ${outline.title}`);
  if (assignedImages && assignedImages.length > 0) {
    log.debug(`Assigned images: ${assignedImages.map((img) => img.id).join(', ')}`);
  }
  if (visionImages && visionImages.length > 0) {
    log.debug(`Vision images: ${visionImages.map((img) => img.id).join(', ')}`);
  }

  let generatedData: GeneratedSlideData | null = null;
  for (let attempt = 1; attempt <= SCENE_JSON_MAX_RETRIES; attempt++) {
    const response = await aiCall(
      prompts.system,
      withJsonRetrySuffix(prompts.user, attempt, generationOptions?.strictJsonRetry !== false),
      visionImages,
    );
    const parsed = parseJsonResponse<GeneratedSlideData>(response);
    if (!parsed) continue;
    const validation = MinimalSlideDataSchema.safeParse(parsed);
    if (!validation.success) continue;
    generatedData = parsed;
    break;
  }

  if (!generatedData || !generatedData.elements || !Array.isArray(generatedData.elements)) {
    log.error(`Failed to parse AI response for: ${outline.title}`);
    return null;
  }

  log.debug(`Got ${generatedData.elements.length} elements for: ${outline.title}`);

  // Debug: Log image elements before resolution
  const imageElements = generatedData.elements.filter((el) => el.type === 'image');
  if (imageElements.length > 0) {
    log.debug(
      `Image elements before resolution:`,
      imageElements.map((el) => ({
        type: el.type,
        src:
          (el as Record<string, unknown>).src &&
          String((el as Record<string, unknown>).src).substring(0, 50),
      })),
    );
    log.debug(`imageMapping keys:`, imageMapping ? Object.keys(imageMapping).length : '0 keys');
  }

  // Fix elements with missing required fields + aspect ratio correction (while src is still img_id)
  const fixedElements = fixElementDefaults(generatedData.elements, assignedImages);
  log.debug(`After element fixing: ${fixedElements.length} elements`);

  // Process LaTeX elements: render latex string → HTML via KaTeX
  const latexProcessedElements = processLatexElements(fixedElements);
  log.debug(`After LaTeX processing: ${latexProcessedElements.length} elements`);

  // Resolve image_id references to actual URLs
  const resolvedElements = resolveImageIds(
    latexProcessedElements,
    imageMapping,
    generatedMediaMapping,
  );
  log.debug(`After image resolution: ${resolvedElements.length} elements`);

  // Process elements, assign unique IDs
  const processedElements: PPTElement[] = resolvedElements.map((el) => ({
    ...el,
    id: `${el.type}_${nanoid(8)}`,
    rotate: 0,
  })) as PPTElement[];

  // Process background
  let background: SlideBackground | undefined;
  if (generatedData.background) {
    if (generatedData.background.type === 'solid' && generatedData.background.color) {
      background = { type: 'solid', color: generatedData.background.color };
    } else if (generatedData.background.type === 'gradient' && generatedData.background.gradient) {
      background = {
        type: 'gradient',
        gradient: generatedData.background.gradient,
      };
    }
  }

  return {
    elements: processedElements,
    background,
    remark: generatedData.remark || outline.description,
  };
}

/**
 * Generate quiz content
 */
async function generateQuizContent(
  outline: SceneOutline,
  aiCall: AICallFn,
  generationOptions?: SceneGenerationOptions,
): Promise<GeneratedQuizContent | null> {
  const quizConfig = outline.quizConfig || {
    questionCount: 3,
    difficulty: 'medium',
    questionTypes: ['single'],
  };

  const prompts = generationOptions?.compactJsonPrompt
    ? {
        system: `You are a JSON quiz generator.
Rules:
- Output ONLY valid JSON array.
- No markdown, no explanations, no extra text.
- Return at least 1 question object.`,
        user: `Generate ${quizConfig.questionCount} quiz questions.
Title: ${outline.title}
Description: ${outline.description}
Key points:
${(outline.keyPoints || []).map((p, i) => `${i + 1}. ${p}`).join('\n')}
Difficulty: ${quizConfig.difficulty}
Question types: ${quizConfig.questionTypes.join(', ')}`,
      }
    : buildPrompt(PROMPT_IDS.QUIZ_CONTENT, {
        title: outline.title,
        description: outline.description,
        keyPoints: (outline.keyPoints || []).map((p, i) => `${i + 1}. ${p}`).join('\n'),
        questionCount: quizConfig.questionCount,
        difficulty: quizConfig.difficulty,
        questionTypes: quizConfig.questionTypes.join(', '),
      });

  if (!prompts) {
    return null;
  }

  log.debug(`Generating quiz content for: ${outline.title}`);
  let generatedQuestions: QuizQuestion[] | null = null;
  for (let attempt = 1; attempt <= SCENE_JSON_MAX_RETRIES; attempt++) {
    const response = await aiCall(
      prompts.system,
      withJsonRetrySuffix(prompts.user, attempt, generationOptions?.strictJsonRetry !== false),
    );
    const parsed = parseJsonResponse<QuizQuestion[]>(response);
    if (!parsed || !Array.isArray(parsed)) continue;
    const validation = MinimalQuizSchema.safeParse(parsed);
    if (!validation.success) continue;
    generatedQuestions = parsed;
    break;
  }

  if (!generatedQuestions || !Array.isArray(generatedQuestions)) {
    log.error(`Failed to parse AI response for: ${outline.title}`);
    return null;
  }

  log.debug(`Got ${generatedQuestions.length} questions for: ${outline.title}`);

  // Ensure each question has an ID and normalize options format
  const questions: QuizQuestion[] = generatedQuestions
    .map((q) => {
      const isText = q.type === 'short_answer';
      const normalizedOptions = isText ? undefined : normalizeQuizOptions(q.options);
      const normalizedAnswer = isText ? undefined : normalizeQuizAnswer(q as unknown as Record<string, unknown>, normalizedOptions);

      return {
        ...q,
        id: q.id || `q_${nanoid(8)}`,
        options: normalizedOptions,
        answer: normalizedAnswer,
        hasAnswer: isText ? false : normalizedAnswer !== undefined && normalizedAnswer.length > 0,
      };
    })
    .filter((q) => {
      // Filter out invalid questions
      if (q.type === 'short_answer') return true; // short answer questions are always valid
      
      // For choice questions, must have options and valid answer
      if (!q.options || q.options.length === 0) {
        log.warn(`Filtering out question without options: ${q.question}`);
        return false;
      }
      
      if (!q.answer || q.answer.length === 0) {
        log.warn(`Filtering out question without valid correct answer: ${q.question}`);
        return false;
      }
      
      // Verify answer values exist in options
      const optionValues = q.options.map((opt) => opt.value);
      const validAnswer = q.answer.every((ans) => optionValues.includes(ans));
      if (!validAnswer) {
        log.warn(
          `Filtering out question with invalid answer values: ${q.question}. Answer: ${q.answer.join(', ')}, Available: ${optionValues.join(', ')}`,
        );
        return false;
      }
      
      return true;
    });

  if (questions.length === 0) {
    log.error(`No valid questions generated for: ${outline.title}. All questions were filtered out.`);
    return null;
  }

  if (questions.length < (generatedQuestions.length * 0.5)) {
    log.warn(
      `Only ${questions.length}/${generatedQuestions.length} questions were valid for: ${outline.title}`,
    );
  }

  return { questions };
}

/**
 * Normalize quiz options from AI response.
 * AI may generate plain strings ["OptionA", "OptionB"] or QuizOption objects.
 * This normalizes to QuizOption[] format: { value: "A", label: "OptionA" }
 */
function normalizeQuizOptions(
  options: unknown[] | undefined,
): { value: string; label: string }[] | undefined {
  if (!options || !Array.isArray(options)) return undefined;

  return options.map((opt, index) => {
    const letter = String.fromCharCode(65 + index); // A, B, C, D...

    if (typeof opt === 'string') {
      return { value: letter, label: opt };
    }

    if (typeof opt === 'object' && opt !== null) {
      const obj = opt as Record<string, unknown>;
      return {
        value: typeof obj.value === 'string' ? obj.value : letter,
        label: typeof obj.label === 'string' ? obj.label : String(obj.value || obj.text || letter),
      };
    }

    return { value: letter, label: String(opt) };
  });
}

/**
 * Map answer text to option letter value.
 * If AI returns "Option A", map it to "A" based on the normalized options.
 */
function mapAnswerTextToValue(
  answerText: string | undefined,
  options: { value: string; label: string }[] | undefined,
): string | undefined {
  if (!answerText || !options) return undefined;

  const trimmed = answerText.trim();

  // Direct lookup: if answer text matches an option label exactly
  const matching = options.find((opt) => opt.label === trimmed);
  if (matching) return matching.value;

  // Try case-insensitive match
  const caseInsensitiveMatch = options.find(
    (opt) => opt.label.toLowerCase() === trimmed.toLowerCase(),
  );
  if (caseInsensitiveMatch) return caseInsensitiveMatch.value;

  // If answer is already a single letter (A, B, C, D), validate it exists in options
  if (/^[A-D]$/.test(trimmed)) {
    if (options.find((opt) => opt.value === trimmed)) {
      return trimmed;
    }
  }

  return undefined;
}

/**
 * Normalize quiz answer from AI response.
 * AI may generate correctAnswer as string or string[], under various field names.
 * This normalizes to string[] format matching option values.
 * Now validates against normalized options and maps text answers to letter values.
 */
function normalizeQuizAnswer(
  question: Record<string, unknown>,
  normalizedOptions: { value: string; label: string }[] | undefined,
): string[] | undefined {
  // AI might use "correctAnswer", "answer", or "correct_answer"
  const raw =
    question.answer ??
    question.correctAnswer ??
    (question as Record<string, unknown>).correct_answer;
  if (!raw) return undefined;

  const answers: string[] = Array.isArray(raw) ? raw.map(String) : [String(raw)];

  // Map text answers to option values
  const mappedAnswers: string[] = [];
  for (const ans of answers) {
    const mapped = mapAnswerTextToValue(ans, normalizedOptions);
    if (mapped) {
      mappedAnswers.push(mapped);
    }
  }

  return mappedAnswers.length > 0 ? mappedAnswers : undefined;
}

/**
 * Generate interactive page content
 * Two AI calls + post-processing:
 * 1. Scientific modeling -> ScientificModel (with fallback)
 * 2. HTML generation with constraints -> post-processed HTML
 */
async function generateInteractiveContent(
  outline: SceneOutline,
  aiCall: AICallFn,
  language: 'hi-IN' | 'en-US' = 'hi-IN',
): Promise<GeneratedInteractiveContent | null> {
  const config = outline.interactiveConfig!;

  // Step 1: Scientific modeling (with fallback on failure)
  let scientificModel: ScientificModel | undefined;
  try {
    const modelPrompts = buildPrompt(PROMPT_IDS.INTERACTIVE_SCIENTIFIC_MODEL, {
      subject: config.subject || '',
      conceptName: config.conceptName,
      conceptOverview: config.conceptOverview,
      keyPoints: (outline.keyPoints || []).map((p, i) => `${i + 1}. ${p}`).join('\n'),
      designIdea: config.designIdea,
    });

    if (modelPrompts) {
      log.info(`Step 1: Scientific modeling for: ${outline.title}`);
      const modelResponse = await aiCall(modelPrompts.system, modelPrompts.user);
      const parsed = parseJsonResponse<ScientificModel>(modelResponse);
      if (parsed && parsed.core_formulas) {
        scientificModel = parsed;
        log.info(
          `Scientific model: ${parsed.core_formulas.length} formulas, ${parsed.constraints?.length || 0} constraints`,
        );
      }
    }
  } catch (error) {
    log.warn(`Scientific modeling failed, continuing without: ${error}`);
  }

  // Format scientific constraints for HTML generation prompt
  let scientificConstraints = 'No specific scientific constraints available.';
  if (scientificModel) {
    const lines: string[] = [];
    if (scientificModel.core_formulas?.length) {
      lines.push(`Core Formulas: ${scientificModel.core_formulas.join('; ')}`);
    }
    if (scientificModel.mechanism?.length) {
      lines.push(`Mechanisms: ${scientificModel.mechanism.join('; ')}`);
    }
    if (scientificModel.constraints?.length) {
      lines.push(`Must Obey: ${scientificModel.constraints.join('; ')}`);
    }
    if (scientificModel.forbidden_errors?.length) {
      lines.push(`Forbidden Errors: ${scientificModel.forbidden_errors.join('; ')}`);
    }
    scientificConstraints = lines.join('\n');
  }

  // Step 2: HTML generation
  const htmlPrompts = buildPrompt(PROMPT_IDS.INTERACTIVE_HTML, {
    conceptName: config.conceptName,
    subject: config.subject || '',
    conceptOverview: config.conceptOverview,
    keyPoints: (outline.keyPoints || []).map((p, i) => `${i + 1}. ${p}`).join('\n'),
    scientificConstraints,
    designIdea: config.designIdea,
    language,
  });

  if (!htmlPrompts) {
    log.error(`Failed to build HTML prompt for: ${outline.title}`);
    return null;
  }

  log.info(`Step 2: Generating HTML for: ${outline.title}`);
  const htmlResponse = await aiCall(htmlPrompts.system, htmlPrompts.user);
  // Extract HTML from response
  const rawHtml = extractHtml(htmlResponse);
  if (!rawHtml) {
    log.error(`Failed to extract HTML from response for: ${outline.title}`);
    return null;
  }

  // Step 3: Post-process HTML (LaTeX delimiter conversion + KaTeX injection)
  const processedHtml = postProcessInteractiveHtml(rawHtml);
  log.info(`Post-processed HTML (${processedHtml.length} chars) for: ${outline.title}`);

  return {
    html: processedHtml,
    scientificModel,
  };
}

/**
 * Generate PBL project content
 * Uses the agentic loop from lib/pbl/generate-pbl.ts
 */
async function generatePBLSceneContent(
  outline: SceneOutline,
  languageModel?: LanguageModel,
): Promise<GeneratedPBLContent | null> {
  if (!languageModel) {
    log.error('LanguageModel required for PBL generation');
    return null;
  }

  const pblConfig = outline.pblConfig;
  if (!pblConfig) {
    log.error(`PBL outline "${outline.title}" missing pblConfig`);
    return null;
  }

  log.info(`Generating PBL content for: ${outline.title}`);

  try {
    const projectConfig = await generatePBLContent(
      {
        projectTopic: pblConfig.projectTopic,
        projectDescription: pblConfig.projectDescription,
        targetSkills: pblConfig.targetSkills,
        issueCount: pblConfig.issueCount,
        language: pblConfig.language,
      },
      languageModel,
      {
        onProgress: (msg) => log.info(`${msg}`),
      },
    );
    log.info(
      `PBL generated: ${projectConfig.agents.length} agents, ${projectConfig.issueboard.issues.length} issues`,
    );

    return { projectConfig };
  } catch (error) {
    log.error(`Failed:`, error);
    return null;
  }
}

/**
 * Extract HTML document from AI response.
 * Tries to find <!DOCTYPE html>...</html> first, then falls back to code block extraction.
 */
function extractHtml(response: string): string | null {
  // Strategy 1: Find complete HTML document
  const doctypeStart = response.indexOf('<!DOCTYPE html>');
  const htmlTagStart = response.indexOf('<html');
  const start = doctypeStart !== -1 ? doctypeStart : htmlTagStart;

  if (start !== -1) {
    const htmlEnd = response.lastIndexOf('</html>');
    if (htmlEnd !== -1) {
      return response.substring(start, htmlEnd + 7);
    }
  }

  // Strategy 2: Extract from code block
  const codeBlockMatch = response.match(/```(?:html)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) {
    const content = codeBlockMatch[1].trim();
    if (content.includes('<html') || content.includes('<!DOCTYPE')) {
      return content;
    }
  }

  // Strategy 3: If response itself looks like HTML
  const trimmed = response.trim();
  if (trimmed.startsWith('<!DOCTYPE') || trimmed.startsWith('<html')) {
    return trimmed;
  }

  log.error('Could not extract HTML from response');
  log.error('Response preview:', response.substring(0, 200));
  return null;
}

/**
 * Step 3.2: Generate Actions based on content and script
 */
export async function generateSceneActions(
  outline: SceneOutline,
  content:
    | GeneratedSlideContent
    | GeneratedQuizContent
    | GeneratedInteractiveContent
    | GeneratedPBLContent,
  aiCall: AICallFn,
  ctx?: SceneGenerationContext,
  agents?: AgentInfo[],
  userProfile?: string,
  generationOptions?: SceneGenerationOptions,
): Promise<Action[]> {
  const agentsText = formatAgentsForPrompt(agents);
  const tryGenerateActions = async (
    systemPrompt: string,
    userPrompt: string,
    sceneType: SceneOutline['type'],
  ): Promise<Action[]> => {
    for (let attempt = 1; attempt <= SCENE_JSON_MAX_RETRIES; attempt++) {
      const response = await aiCall(
        systemPrompt,
        withJsonRetrySuffix(userPrompt, attempt, generationOptions?.strictJsonRetry !== false),
      );
      const actions = parseActionsFromStructuredOutput(response, sceneType);
      if (actions.length === 0) continue;
      const validation = MinimalActionsSchema.safeParse(actions);
      if (!validation.success) continue;
      return actions;
    }
    return [];
  };

  if (outline.type === 'slide' || 'elements' in content) {
    outline.type = 'slide'; // ensure it's treated as a slide downstream if it fell back
    
    const slideContent = content as GeneratedSlideContent;
    // Format element list for AI to select from
    const elementsText = formatElementsForPrompt(slideContent.elements);

    const isHinglish = outline.language === 'hi-IN';
    const speechLangNote = isHinglish
      ? 'Speech language: Hinglish — mix Hindi conversation with English technical terms. Example: "Ab hum dekhenge ki variables kaise kaam karte hain. A variable is basically ek named storage location."'
      : 'Speech language: English.';
    const courseCtx = buildCourseContext(ctx);
    const complexityGuideActions = ctx ? getSlideComplexityGuide(ctx.pageIndex ?? 1, ctx.totalPages ?? 1) : '';
    const isFirstSlide = ctx?.pageIndex === 1;

    const prompts = generationOptions?.compactJsonPrompt
      ? {
          system: `You are a teaching action generator for small LLMs (qwen2.5, qwen3.5 series).

STRICT RULES:
1. Output ONLY a valid JSON array. No markdown, no code fences, no explanation.
2. Two item types allowed:
   - Speech: {"type":"text","content":"Your spoken teaching text here"}
   - Action: {"type":"action","name":"spotlight","params":{"elementId":"element_id_here"}}
3. MANDATORY: Include AT LEAST 2 speech items ({"type":"text",...}).
4. A slide with zero speech items is INVALID.
5. Pattern: spotlight action → speech text → next spotlight → speech text → closing speech.

SPEECH STRUCTURE:
- ${isFirstSlide ? 'First slide: greet students and introduce the course topic.' : 'NOT the first slide: do NOT greet. Continue naturally from previous topic.'}
- Explain each key point with detail and examples.
- End with a brief summary speech.
${speechLangNote}`,
          user: `Generate teaching actions for this slide.
Title: ${outline.title}
Description: ${outline.description}
Key points:
${(outline.keyPoints || []).map((p, i) => `${i + 1}. ${p}`).join('\n')}
Slide elements (use these IDs for spotlight actions):
${elementsText}
${courseCtx ? `Course context:
${courseCtx}` : ''}
${agentsText ? `Agents:
${agentsText}` : ''}
${userProfile ? `User profile: ${userProfile}` : ''}

Output JSON array only. Must have at least 2 speech items:`,
        }
      : buildPrompt(PROMPT_IDS.SLIDE_ACTIONS, {
          title: outline.title,
          keyPoints: (outline.keyPoints || []).map((p, i) => `${i + 1}. ${p}`).join('\n'),
          description: outline.description,
          elements: elementsText,
          courseContext: buildCourseContext(ctx),
          agents: agentsText,
          userProfile: userProfile || '',
        });

    if (!prompts) {
      return generateDefaultSlideActions(outline, (content as GeneratedSlideContent).elements);
    }

    const actions = await tryGenerateActions(prompts.system, prompts.user, outline.type);

    if (actions.length > 0) {
      // Validate and fill in Action IDs
      return processActions(actions, (content as GeneratedSlideContent).elements, agents);
    }

    return generateDefaultSlideActions(outline, (content as GeneratedSlideContent).elements);
  }

  if (outline.type === 'quiz' && 'questions' in content) {
    // Format question list for AI reference
    const questionsText = formatQuestionsForPrompt(content.questions);
    const isHinglishQuiz = outline.language === 'hi-IN';
    const quizSpeechLang = isHinglishQuiz
      ? 'Speech language: Hinglish (Hindi + English mix).'
      : 'Speech language: English.';

    const prompts = generationOptions?.compactJsonPrompt
      ? {
          system: `You are a teaching action generator for quiz slides.

STRICT RULES:
1. Output ONLY a valid JSON array. No markdown, no code fences.
2. Item types: {"type":"text","content":"speech"} or {"type":"action","name":"...","params":{...}}
3. MANDATORY: At least 2 speech items required.
${quizSpeechLang}`,
          user: `Generate quiz teaching actions.
Title: ${outline.title}
Description: ${outline.description}
Key points:
${(outline.keyPoints || []).map((p, i) => `${i + 1}. ${p}`).join('\n')}
Questions:
${questionsText}
${buildCourseContext(ctx) ? `Context:
${buildCourseContext(ctx)}` : ''}
${agentsText ? `Agents:
${agentsText}` : ''}

Output JSON array only:`,
        }
      : buildPrompt(PROMPT_IDS.QUIZ_ACTIONS, {
          title: outline.title,
          keyPoints: (outline.keyPoints || []).map((p, i) => `${i + 1}. ${p}`).join('\n'),
          description: outline.description,
          questions: questionsText,
          courseContext: buildCourseContext(ctx),
          agents: agentsText,
        });

    if (!prompts) {
      return generateDefaultQuizActions(outline);
    }

    const actions = await tryGenerateActions(prompts.system, prompts.user, outline.type);

    if (actions.length > 0) {
      return processActions(actions, [], agents);
    }

    return generateDefaultQuizActions(outline);
  }

  if (outline.type === 'interactive' && 'html' in content) {
    const config = outline.interactiveConfig;
    const agentsText = formatAgentsForPrompt(agents);
    const isHinglishInteractive = outline.language === 'hi-IN';
    const interactiveSpeechLang = isHinglishInteractive
      ? 'Speech language: Hinglish (Hindi + English mix).'
      : 'Speech language: English.';

    const prompts = generationOptions?.compactJsonPrompt
      ? {
          system: `You are a teaching action generator for interactive scenes.

STRICT RULES:
1. Output ONLY a valid JSON array. No markdown, no code fences.
2. At least 2 speech items ({"type":"text",...}) are mandatory.
${interactiveSpeechLang}`,
          user: `Generate interactive scene teaching actions.
Title: ${outline.title}
Description: ${outline.description}
Concept: ${config?.conceptName || outline.title}
Design idea: ${config?.designIdea || ''}
${buildCourseContext(ctx) ? `Context:
${buildCourseContext(ctx)}` : ''}
${agentsText ? `Agents:
${agentsText}` : ''}

Output JSON array only:`,
        }
      : buildPrompt(PROMPT_IDS.INTERACTIVE_ACTIONS, {
          title: outline.title,
          keyPoints: (outline.keyPoints || []).map((p, i) => `${i + 1}. ${p}`).join('\n'),
          description: outline.description,
          conceptName: config?.conceptName || outline.title,
          designIdea: config?.designIdea || '',
          courseContext: buildCourseContext(ctx),
          agents: agentsText,
        });

    if (!prompts) {
      return generateDefaultInteractiveActions(outline);
    }

    const actions = await tryGenerateActions(prompts.system, prompts.user, outline.type);

    if (actions.length > 0) {
      return processActions(actions, [], agents);
    }

    return generateDefaultInteractiveActions(outline);
  }

  if (outline.type === 'pbl' && 'projectConfig' in content) {
    const pblConfig = outline.pblConfig;
    const agentsText = formatAgentsForPrompt(agents);
    const isHinglishPbl = outline.language === 'hi-IN';
    const pblSpeechLang = isHinglishPbl
      ? 'Speech language: Hinglish (Hindi + English mix).'
      : 'Speech language: English.';

    const prompts = generationOptions?.compactJsonPrompt
      ? {
          system: `You are a teaching action generator for PBL project scenes.

STRICT RULES:
1. Output ONLY a valid JSON array. No markdown, no code fences.
2. At least 2 speech items ({"type":"text",...}) are mandatory.
${pblSpeechLang}`,
          user: `Generate PBL teaching actions.
Title: ${outline.title}
Description: ${outline.description}
Project topic: ${pblConfig?.projectTopic || outline.title}
Project description: ${pblConfig?.projectDescription || outline.description}
${buildCourseContext(ctx) ? `Context:
${buildCourseContext(ctx)}` : ''}
${agentsText ? `Agents:
${agentsText}` : ''}

Output JSON array only:`,
        }
      : buildPrompt(PROMPT_IDS.PBL_ACTIONS, {
          title: outline.title,
          keyPoints: (outline.keyPoints || []).map((p, i) => `${i + 1}. ${p}`).join('\n'),
          description: outline.description,
          projectTopic: pblConfig?.projectTopic || outline.title,
          projectDescription: pblConfig?.projectDescription || outline.description,
          courseContext: buildCourseContext(ctx),
          agents: agentsText,
        });
    if (!prompts) {
      return generateDefaultPBLActions(outline);
    }

    const actions = await tryGenerateActions(prompts.system, prompts.user, outline.type);

    if (actions.length > 0) {
      return processActions(actions, [], agents);
    }

    return generateDefaultPBLActions(outline);
  }

  return [];
}

/**
 * Generate default PBL Actions (fallback)
 */
function generateDefaultPBLActions(outline: SceneOutline): Action[] {
  const isHinglish = outline.language === 'hi-IN';
  return [
    {
      id: `action_${nanoid(8)}`,
      type: 'speech',
      title: 'PBL Project Introduction',
      text: isHinglish
        ? `Ab hum ek project-based learning activity shuru karte hain. Apna role choose karein aur task board check karein. Milke project complete karte hain!`
        : `Now let's begin a project-based learning activity. Please choose your role, review the task board, and start collaborating to complete the project.`,
    },
  ];
}

/**
 * Format element list for AI to select elementId
 */
function formatElementsForPrompt(elements: PPTElement[]): string {
  return elements
    .map((el) => {
      let summary = '';
      if (el.type === 'text' && 'content' in el) {
        // Extract text content summary (strip HTML tags)
        const textContent = ((el.content as string) || '').replace(/<[^>]*>/g, '').substring(0, 50);
        summary = `Content summary: "${textContent}${textContent.length >= 50 ? '...' : ''}"`;
      } else if (el.type === 'chart' && 'chartType' in el) {
        summary = `Chart type: ${el.chartType}`;
      } else if (el.type === 'image') {
        summary = 'Image element';
      } else if (el.type === 'shape' && 'shapeName' in el) {
        summary = `Shape: ${el.shapeName || 'unknown'}`;
      } else if (el.type === 'latex' && 'latex' in el) {
        summary = `Formula: ${((el.latex as string) || '').substring(0, 30)}`;
      } else {
        summary = `${el.type} element`;
      }
      return `- id: "${el.id}", type: "${el.type}", ${summary}`;
    })
    .join('\n');
}

/**
 * Format question list for AI reference
 */
function formatQuestionsForPrompt(questions: QuizQuestion[]): string {
  return questions
    .map((q, i) => {
      const optionsText = q.options ? `Options: ${q.options.join(', ')}` : '';
      return `Q${i + 1} (${q.type}): ${q.question}\n${optionsText}`;
    })
    .join('\n\n');
}

/**
 * Process and validate Actions
 */
function processActions(actions: Action[], elements: PPTElement[], agents?: AgentInfo[]): Action[] {
  const elementIds = new Set(elements.map((el) => el.id));
  const agentIds = new Set(agents?.map((a) => a.id) || []);
  const studentAgents = agents?.filter((a) => a.role === 'student') || [];
  const nonTeacherAgents = agents?.filter((a) => a.role !== 'teacher') || [];

  return actions.map((action) => {
    // Ensure each action has an ID
    const processedAction: Action = {
      ...action,
      id: action.id || `action_${nanoid(8)}`,
    };

    // Validate spotlight elementId
    if (processedAction.type === 'spotlight') {
      const spotlightAction = processedAction;
      if (!spotlightAction.elementId || !elementIds.has(spotlightAction.elementId)) {
        // If elementId is invalid, try selecting the first element
        if (elements.length > 0) {
          spotlightAction.elementId = elements[0].id;
          log.warn(
            `Invalid elementId, falling back to first element: ${spotlightAction.elementId}`,
          );
        }
      }
    }

    // Validate/fill discussion agentId
    if (processedAction.type === 'discussion' && agents && agents.length > 0) {
      if (processedAction.agentId && agentIds.has(processedAction.agentId)) {
        // agentId valid — keep it
      } else {
        // agentId missing or invalid — pick a random student, or non-teacher, or skip
        const pool = studentAgents.length > 0 ? studentAgents : nonTeacherAgents;
        if (pool.length > 0) {
          const picked = pool[Math.floor(Math.random() * pool.length)];
          log.warn(
            `Discussion agentId "${processedAction.agentId || '(none)'}" invalid, assigned: ${picked.id} (${picked.name})`,
          );
          processedAction.agentId = picked.id;
        }
      }
    }

    return processedAction;
  });
}

/**
 * Generate default slide Actions (fallback)
 */
function generateDefaultSlideActions(outline: SceneOutline, elements: PPTElement[]): Action[] {
  const actions: Action[] = [];
  const isHinglish = outline.language === 'hi-IN';

  // Add spotlight for first text element if available
  const textElements = elements.filter((el) => el.type === 'text');
  if (textElements.length > 0) {
    actions.push({
      id: `action_${nanoid(8)}`,
      type: 'spotlight',
      title: 'Focus on Key Content',
      elementId: textElements[0].id,
    });
  }

  // Opening speech
  const keyPointsSummary = outline.keyPoints?.length
    ? outline.keyPoints.join('. ')
    : outline.description || outline.title;

  const openingSpeech = isHinglish
    ? `Ab hum dekhenge — ${outline.title}. ${keyPointsSummary}.`
    : `Let's look at ${outline.title}. ${keyPointsSummary}.`;

  actions.push({
    id: `action_${nanoid(8)}`,
    type: 'speech',
    title: 'Opening Speech',
    text: openingSpeech,
  });

  // Add spotlight for second text element + follow-up speech if available
  if (textElements.length > 1) {
    actions.push({
      id: `action_${nanoid(8)}`,
      type: 'spotlight',
      title: 'Detail Focus',
      elementId: textElements[1].id,
    });
  }

  // Always add a closing/summary speech
  const closingSpeech = isHinglish
    ? `To is slide mein humne ${outline.title} ke baare mein seekha. Chalte hain aage.`
    : `That covers ${outline.title}. Let's continue to the next topic.`;

  actions.push({
    id: `action_${nanoid(8)}`,
    type: 'speech',
    title: 'Summary Speech',
    text: closingSpeech,
  });

  return actions;
}

/**
 * Generate default quiz Actions (fallback)
 */
function generateDefaultQuizActions(outline: SceneOutline): Action[] {
  const isHinglish = outline.language === 'hi-IN';
  return [
    {
      id: `action_${nanoid(8)}`,
      type: 'speech',
      title: 'Quiz Introduction',
      text: isHinglish
        ? `Ab thodi quiz karte hain! Yeh questions humne jo abhi padha uska recap hai. Dhyaan se socho.`
        : `Now let's have a quick quiz to check what we've learned! Think carefully about each question.`,
    },
    {
      id: `action_${nanoid(8)}`,
      type: 'speech',
      title: 'Quiz Encouragement',
      text: isHinglish
        ? `Bilkul sahi! In questions ko solve karo. Koi bhi question ho toh poochh lo.`
        : `You can do it! Work through each question at your own pace. Ask if you need any clarification.`,
    },
  ];
}

/**
 * Generate default interactive Actions (fallback)
 */
function generateDefaultInteractiveActions(outline: SceneOutline): Action[] {
  const isHinglish = outline.language === 'hi-IN';
  return [
    {
      id: `action_${nanoid(8)}`,
      type: 'speech',
      title: 'Interactive Introduction',
      text: isHinglish
        ? `Yeh ek interactive visualization hai. Page ke elements ko try karo aur dekho kya hota hai!`
        : `Now let's explore this concept through an interactive visualization. Try interacting with the elements on screen and observe what changes!`,
    },
    {
      id: `action_${nanoid(8)}`,
      type: 'speech',
      title: 'Interactive Guidance',
      text: isHinglish
        ? `Experiment karo — har cheez badlo aur results observe karo. Yahi sabse acha tarika hai samajhne ka.`
        : `Experiment freely — change values and observe the results. This hands-on exploration is the best way to understand the concept deeply.`,
    },
  ];
}

/**
 * Create a complete scene with Actions
 */
export function createSceneWithActions(
  outline: SceneOutline,
  content:
    | GeneratedSlideContent
    | GeneratedQuizContent
    | GeneratedInteractiveContent
    | GeneratedPBLContent,
  actions: Action[],
  api: ReturnType<typeof createStageAPI>,
): string | null {
  if (outline.type === 'slide' || 'elements' in content) {
    outline.type = 'slide';
    // Build complete Slide object
    const defaultTheme: SlideTheme = {
      backgroundColor: '#ffffff',
      themeColors: ['#5b9bd5', '#ed7d31', '#a5a5a5', '#ffc000', '#4472c4'],
      fontColor: '#333333',
      fontName: 'Microsoft YaHei',
      outline: { color: '#d14424', width: 2, style: 'solid' },
      shadow: { h: 0, v: 0, blur: 10, color: '#000000' },
    };

    const slideContent = content as GeneratedSlideContent;
    const slide: Slide = {
      id: nanoid(),
      viewportSize: 1000,
      viewportRatio: 0.5625,
      theme: defaultTheme,
      elements: slideContent.elements,
      background: slideContent.background,
    };

    const sceneResult = api.scene.create({
      type: 'slide',
      title: outline.title,
      order: outline.order,
      content: {
        type: 'slide',
        canvas: slide,
      },
      actions,
    });

    return sceneResult.success ? (sceneResult.data ?? null) : null;
  }

  if (outline.type === 'quiz' && 'questions' in content) {
    const quizContent = content as GeneratedQuizContent;
    const sceneResult = api.scene.create({
      type: 'quiz',
      title: outline.title,
      order: outline.order,
      content: {
        type: 'quiz',
        questions: quizContent.questions,
      },
      actions,
    });

    return sceneResult.success ? (sceneResult.data ?? null) : null;
  }

  if (outline.type === 'interactive' && 'html' in content) {
    const interactiveContent = content as GeneratedInteractiveContent;
    const sceneResult = api.scene.create({
      type: 'interactive',
      title: outline.title,
      order: outline.order,
      content: {
        type: 'interactive',
        url: '',
        html: interactiveContent.html,
      },
      actions,
    });

    return sceneResult.success ? (sceneResult.data ?? null) : null;
  }

  if (outline.type === 'pbl' && 'projectConfig' in content) {
    const pblContent = content as GeneratedPBLContent;
    const sceneResult = api.scene.create({
      type: 'pbl',
      title: outline.title,
      order: outline.order,
      content: {
        type: 'pbl',
        projectConfig: pblContent.projectConfig,
      },
      actions,
    });

    return sceneResult.success ? (sceneResult.data ?? null) : null;
  }

  return null;
}
