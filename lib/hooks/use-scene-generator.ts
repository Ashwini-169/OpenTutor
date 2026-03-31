'use client';

import { useCallback, useRef } from 'react';
import { useStageStore } from '@/lib/store/stage';
import { getCurrentModelConfig } from '@/lib/utils/model-config';
import { useSettingsStore } from '@/lib/store/settings';
import { db } from '@/lib/utils/database';
import type { SceneOutline, PdfImage, ImageMapping, UserRequirements } from '@/lib/types/generation';
import type { AgentInfo } from '@/lib/generation/generation-pipeline';
import type { Scene } from '@/lib/types/stage';
import type { SpeechAction } from '@/lib/types/action';
import { splitLongSpeechActions } from '@/lib/audio/tts-utils';
import { generateMediaForOutlines } from '@/lib/media/media-orchestrator';
import { createLogger } from '@/lib/logger';

const log = createLogger('SceneGenerator');

interface SceneContentResult {
  success: boolean;
  content?: unknown;
  effectiveOutline?: SceneOutline;
  error?: string;
}

interface SceneActionsResult {
  success: boolean;
  scene?: Scene;
  previousSpeeches?: string[];
  error?: string;
}

function getApiHeaders(): HeadersInit {
  const config = getCurrentModelConfig();
  const settings = useSettingsStore.getState();
  const imageProviderConfig = settings.imageProvidersConfig?.[settings.imageProviderId];
  const videoProviderConfig = settings.videoProvidersConfig?.[settings.videoProviderId];

  return {
    'Content-Type': 'application/json',
    'x-model': config.modelString || '',
    'x-outline-model': config.outlineModel || '',
    'x-content-model': config.contentModel || '',
    'x-actions-model': config.actionsModel || '',
    'x-api-key': config.apiKey || '',
    'x-base-url': config.baseUrl || '',
    'x-provider-type': config.providerType || '',
    'x-requires-api-key': String(config.requiresApiKey ?? false),
    // Image generation provider
    'x-image-provider': settings.imageProviderId || '',
    'x-image-model': settings.imageModelId || '',
    'x-image-api-key': imageProviderConfig?.apiKey || '',
    'x-image-base-url': imageProviderConfig?.baseUrl || '',
    // Video generation provider
    'x-video-provider': settings.videoProviderId || '',
    'x-video-model': settings.videoModelId || '',
    'x-video-api-key': videoProviderConfig?.apiKey || '',
    'x-video-base-url': videoProviderConfig?.baseUrl || '',
    // Media generation toggles
    'x-image-generation-enabled': String(settings.imageGenerationEnabled ?? false),
    'x-video-generation-enabled': String(settings.videoGenerationEnabled ?? false),
  };
}

/** Call POST /api/generate/scene-content (step 1) */
async function fetchSceneContent(
  params: {
    outline: SceneOutline;
    allOutlines: SceneOutline[];
    stageId: string;
    pdfImages?: PdfImage[];
    imageMapping?: ImageMapping;
    stageInfo: {
      name: string;
      description?: string;
      language?: string;
      style?: string;
    };
    agents?: AgentInfo[];
  },
  signal?: AbortSignal,
): Promise<SceneContentResult> {
  const response = await fetch('/api/generate/scene-content', {
    method: 'POST',
    headers: getApiHeaders(),
    body: JSON.stringify(params),
    signal,
  });

  if (!response.ok) {
    const data = await response.json().catch(() => ({ error: 'Request failed' }));
    return { success: false, error: data.error || `HTTP ${response.status}` };
  }

  return response.json();
}

/** Call POST /api/generate/scene-actions (step 2) */
async function fetchSceneActions(
  params: {
    outline: SceneOutline;
    allOutlines: SceneOutline[];
    content: unknown;
    stageId: string;
    agents?: AgentInfo[];
    previousSpeeches?: string[];
    userProfile?: string;
  },
  signal?: AbortSignal,
): Promise<SceneActionsResult> {
  const response = await fetch('/api/generate/scene-actions', {
    method: 'POST',
    headers: getApiHeaders(),
    body: JSON.stringify(params),
    signal,
  });

  if (!response.ok) {
    const data = await response.json().catch(() => ({ error: 'Request failed' }));
    return { success: false, error: data.error || `HTTP ${response.status}` };
  }

  return response.json();
}

/** Generate TTS for one speech action and store in IndexedDB */
export async function generateAndStoreTTS(
  audioId: string,
  text: string,
  signal?: AbortSignal,
): Promise<void> {
  const settings = useSettingsStore.getState();
  if (settings.ttsProviderId === 'browser-native-tts') return;

  const ttsProviderConfig = settings.ttsProvidersConfig?.[settings.ttsProviderId];
  const response = await fetch('/api/generate/tts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text,
      audioId,
      ttsProviderId: settings.ttsProviderId,
      ttsVoice: settings.ttsVoice,
      ttsSpeed: settings.ttsSpeed,
      ttsApiKey: ttsProviderConfig?.apiKey || undefined,
      ttsBaseUrl: ttsProviderConfig?.baseUrl || undefined,
    }),
    signal,
  });

  const data = await response
    .json()
    .catch(() => ({ success: false, error: response.statusText || 'Invalid TTS response' }));
  if (!response.ok || !data.success || !data.base64 || !data.format) {
    const err = new Error(
      data.details || data.error || `TTS request failed: HTTP ${response.status}`,
    );
    log.warn('TTS failed for', audioId, ':', err);
    throw err;
  }

  const binary = atob(data.base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  const blob = new Blob([bytes], { type: `audio/${data.format}` });
  await db.audioFiles.put({
    id: audioId,
    blob,
    format: data.format,
    createdAt: Date.now(),
  });
}

/** Generate TTS for all speech actions in a scene. Returns result. */
async function generateTTSForScene(
  scene: Scene,
  signal?: AbortSignal,
): Promise<{ success: boolean; failedCount: number; error?: string }> {
  const providerId = useSettingsStore.getState().ttsProviderId;
  scene.actions = splitLongSpeechActions(scene.actions || [], providerId);
  const speechActions = scene.actions.filter(
    (a): a is SpeechAction => a.type === 'speech' && !!a.text,
  );
  if (speechActions.length === 0) return { success: true, failedCount: 0 };

  let failedCount = 0;
  let lastError: string | undefined;

  for (const action of speechActions) {
    const audioId = `tts_${action.id}`;
    action.audioId = audioId;
    try {
      await generateAndStoreTTS(audioId, action.text, signal);
    } catch (error) {
      failedCount++;
      lastError = error instanceof Error ? error.message : `TTS failed for action ${action.id}`;
      log.warn('TTS generation failed:', {
        providerId,
        actionId: action.id,
        textLength: action.text.length,
        error: lastError,
      });
    }
  }

  return {
    success: failedCount === 0,
    failedCount,
    error: lastError,
  };
}

export interface UseSceneGeneratorOptions {
  onSceneGenerated?: (scene: Scene, index: number) => void;
  onSceneFailed?: (outline: SceneOutline, error: string) => void;
  onPhaseChange?: (phase: 'content' | 'actions', outline: SceneOutline) => void;
  onComplete?: () => void;
}

export interface GenerationParams {
  pdfImages?: PdfImage[];
  imageMapping?: ImageMapping;
  stageInfo: {
    name: string;
    description?: string;
    language?: string;
    style?: string;
  };
  agents?: AgentInfo[];
  userProfile?: string;
}

export function useSceneGenerator(options: UseSceneGeneratorOptions = {}) {
  const abortRef = useRef(false);
  const generatingRef = useRef(false);
  const mediaAbortRef = useRef<AbortController | null>(null);
  const fetchAbortRef = useRef<AbortController | null>(null);
  const lastParamsRef = useRef<GenerationParams | null>(null);
  const generateRemainingRef = useRef<((params: GenerationParams) => Promise<void>) | null>(null);

  const store = useStageStore;

  const generateRemaining = useCallback(
    async (params: GenerationParams) => {
      lastParamsRef.current = params;
      if (generatingRef.current) return;
      generatingRef.current = true;
      abortRef.current = false;
      const removeGeneratingOutline = (outlineId: string) => {
        const current = store.getState().generatingOutlines;
        if (!current.some((o) => o.id === outlineId)) return;
        store.getState().setGeneratingOutlines(current.filter((o) => o.id !== outlineId));
      };

      // Create a new AbortController for this generation run
      fetchAbortRef.current = new AbortController();
      const signal = fetchAbortRef.current.signal;

      const state = store.getState();
      const { outlines, scenes, stage } = state;
      const startEpoch = state.generationEpoch;
      if (!stage || outlines.length === 0) {
        generatingRef.current = false;
        return;
      }

      store.getState().setGenerationStatus('generating');

      // Determine pending outlines
      const getNextTask = () => {
        const state = store.getState();

        // Priority 1: Speech regeneration
        if (state.prioritySpeechQueue.length > 0) {
          const sceneId = state.prioritySpeechQueue[0];
          const scene = state.scenes.find(s => s.id === sceneId);
          if (scene) {
            const outline = state.outlines.find(o => o.order === scene.order);
            if (outline) return { type: 'speech_retry' as const, outline, sceneId };
          }
          // If scene not found, just remove it and call again
          store.getState().removePrioritySpeech(sceneId);
          return null; // Will trigger next loop tick naturally
        }

        // Priority 2: Full slide regeneration
        if (state.prioritySlideQueue.length > 0) {
          const outlineId = state.prioritySlideQueue[0];
          const outline = state.outlines.find(o => o.id === outlineId);
          if (outline) return { type: 'slide_retry' as const, outline, outlineId };
          // If outline not found, just remove it
          store.getState().removePrioritySlide(outlineId);
          return null;
        }

        // Priority 3: Normal pending scenes
        const completedOrders = new Set(state.scenes.map((s) => s.order));
        const pending = state.outlines
          .filter((o) => !completedOrders.has(o.order) && !state.failedOutlines.some(f => f.id === o.id))
          .sort((a, b) => a.order - b.order);

        if (pending.length > 0) {
          return { type: 'normal' as const, outline: pending[0], allPending: pending };
        }

        return { type: 'done' as const };
      };

      const initialPending = state.outlines
        .filter((o) => !new Set(state.scenes.map(s => s.order)).has(o.order))
        .sort((a, b) => a.order - b.order);

      if (initialPending.length === 0 && state.prioritySlideQueue.length === 0 && state.prioritySpeechQueue.length === 0) {
        store.getState().setGenerationStatus('completed');
        store.getState().setGeneratingOutlines([]);
        options.onComplete?.();
        generatingRef.current = false;
        return;
      }

      // Launch media generation in parallel — does not block content/action generation
      mediaAbortRef.current = new AbortController();
      generateMediaForOutlines(outlines, stage.id, mediaAbortRef.current.signal).catch((err) => {
        log.warn('Media generation error:', err);
      });

      // Serial generation loop
      try {
        let pausedByFailureOrAbort = false;

        while (true) {
          if (abortRef.current || store.getState().generationEpoch !== startEpoch) {
            store.getState().setGenerationStatus('paused');
            pausedByFailureOrAbort = true;
            break;
          }

          const task = getNextTask();
          if (!task) continue; // Queue cleaned, try next
          if (task.type === 'done') break; // Complete

          const outline = task.outline;
          store.getState().setCurrentGeneratingOrder(outline.order);

          if (task.type === 'normal') {
            store.getState().setGeneratingOutlines(task.allPending);
          } else {
            store.getState().setGeneratingOutlines([outline]);
          }

          // Generate previous speeches based on current order
          let previousSpeeches: string[] = [];
          const sortedScenes = [...store.getState().scenes].sort((a, b) => a.order - b.order);
          const prevSceneParams = sortedScenes.filter((s) => s.order < outline.order);
          if (prevSceneParams.length > 0) {
            const lastScene = prevSceneParams[prevSceneParams.length - 1];
            previousSpeeches = (lastScene.actions || [])
              .filter((a): a is SpeechAction => a.type === 'speech')
              .map((a) => a.text);
          }

          // === SPEECH RETRY LOOP ===
          if (task.type === 'speech_retry') {
            const scene = store.getState().scenes.find(s => s.id === task.sceneId);
            if (!scene) {
              store.getState().removePrioritySpeech(task.sceneId);
              continue;
            }
            options.onPhaseChange?.('actions', outline);

            let contentPayload: any;
            if (scene.content.type === 'slide') {
              contentPayload = {
                elements: scene.content.canvas.elements,
                background: scene.content.canvas.background,
              };
            } else if (scene.content.type === 'quiz') {
              contentPayload = { questions: scene.content.questions };
            } else if (scene.content.type === 'interactive') {
              contentPayload = { html: scene.content.html || '' };
            } else if (scene.content.type === 'pbl') {
              contentPayload = { projectConfig: scene.content.projectConfig };
            }

            const actionsResult = await fetchSceneActions(
              {
                outline,
                allOutlines: state.outlines,
                content: contentPayload,
                stageId: stage.id,
                agents: params.agents,
                previousSpeeches,
                userProfile: params.userProfile,
              },
              signal,
            );

            if (actionsResult.success && actionsResult.scene) {
              const newScene = actionsResult.scene;
              const settings = useSettingsStore.getState();

              let isSpeechFailed = false;

              // Check if LLM missed speech again
              const hasSpeech = newScene.actions?.some(a => a.type === 'speech' && !!(a as SpeechAction).text);
              if (!hasSpeech) {
                isSpeechFailed = true;
                log.warn('LLM missed speech generation for retry of scene:', scene.id, {
                  actionsPresent: !!newScene.actions,
                  actionCount: newScene.actions?.length || 0,
                  types: newScene.actions?.map(a => a.type)
                });
                options.onSceneFailed?.(outline, 'LLM missed speech generation');
              }

              if (!isSpeechFailed && settings.ttsEnabled && settings.ttsProviderId !== 'browser-native-tts') {
                const ttsResult = await generateTTSForScene(newScene, signal);
                if (!ttsResult.success) {
                  isSpeechFailed = true;
                  options.onSceneFailed?.(outline, ttsResult.error || 'TTS generation failed');
                }
              }

              if (isSpeechFailed) {
                store.getState().addSpeechFailedScene(scene.id);
              } else {
                store.getState().removeSpeechFailedScene(scene.id);
              }

              // Update scene with the new actions regardless (could be fallback actions)
              store.getState().updateScene(scene.id, { actions: newScene.actions });
            } else {
              options.onSceneFailed?.(outline, actionsResult.error || 'Speech generation failed');
            }

            store.getState().removePrioritySpeech(task.sceneId);
            continue;
          }

          // === FULL SLIDE GENERATION (Normal or Slide Retry) ===
          options.onPhaseChange?.('content', outline);
          const contentResult = await fetchSceneContent(
            {
              outline,
              allOutlines: state.outlines,
              stageId: stage.id,
              pdfImages: params.pdfImages,
              imageMapping: params.imageMapping,
              stageInfo: params.stageInfo,
              agents: params.agents,
            },
            signal,
          );

          if (!contentResult.success || !contentResult.content) {
            if (abortRef.current || store.getState().generationEpoch !== startEpoch) {
              pausedByFailureOrAbort = true;
              break;
            }
            store.getState().addFailedOutline(outline);
            if (task.type === 'slide_retry') store.getState().removePrioritySlide(task.outlineId);
            options.onSceneFailed?.(outline, contentResult.error || 'Content generation failed');
            removeGeneratingOutline(outline.id);
            continue; // Continue to next outline
          }

          if (abortRef.current || store.getState().generationEpoch !== startEpoch) {
            store.getState().setGenerationStatus('paused');
            pausedByFailureOrAbort = true;
            break;
          }

          // Step 2: Generate actions + assemble scene
          options.onPhaseChange?.('actions', outline);
          const actionsResult = await fetchSceneActions(
            {
              outline: contentResult.effectiveOutline || outline,
              allOutlines: state.outlines,
              content: contentResult.content,
              stageId: stage.id,
              agents: params.agents,
              previousSpeeches,
              userProfile: params.userProfile,
            },
            signal,
          );

          if (actionsResult.success && actionsResult.scene) {
            const scene = actionsResult.scene;
            const settings = useSettingsStore.getState();

            let isSpeechFailed = false;

            // Check if LLM missed speech
            const hasSpeech = scene.actions?.some(a => a.type === 'speech' && !!(a as SpeechAction).text);
            if (!hasSpeech) {
              isSpeechFailed = true;
              log.warn('LLM missed speech generation for scene:', scene.id, {
                title: scene.title,
                actionCount: scene.actions?.length || 0,
                types: scene.actions?.map(a => a.type)
              });
              options.onSceneFailed?.(outline, 'LLM missed speech generation');
            }

            // TTS generation
            if (!isSpeechFailed && settings.ttsEnabled && settings.ttsProviderId !== 'browser-native-tts') {
              const ttsResult = await generateTTSForScene(scene, signal);
              if (!ttsResult.success) {
                if (abortRef.current || store.getState().generationEpoch !== startEpoch) {
                  pausedByFailureOrAbort = true;
                  break;
                }
                isSpeechFailed = true;
                options.onSceneFailed?.(outline, ttsResult.error || 'TTS generation failed');
              }
            }

            if (isSpeechFailed) {
              store.getState().addSpeechFailedScene(scene.id);
            } else {
              store.getState().removeSpeechFailedScene(scene.id);
            }

            if (store.getState().generationEpoch !== startEpoch) {
              pausedByFailureOrAbort = true;
              break;
            }

            removeGeneratingOutline(outline.id);

            // If it's a slide retry and it already existed, updating is better, but since it failed it shouldn't exist
            store.getState().addScene(scene);
            options.onSceneGenerated?.(scene, outline.order);

            // Clear retry state
            if (task.type === 'slide_retry') {
              store.getState().retryFailedOutline(outline.id);
              store.getState().removePrioritySlide(task.outlineId);
            }

          } else {
            if (abortRef.current || store.getState().generationEpoch !== startEpoch) {
              pausedByFailureOrAbort = true;
              break;
            }
            store.getState().addFailedOutline(outline);
            if (task.type === 'slide_retry') store.getState().removePrioritySlide(task.outlineId);
            options.onSceneFailed?.(outline, actionsResult.error || 'Actions generation failed');
            removeGeneratingOutline(outline.id);
            continue; // Continue pipeline
          }
        }

        if (!abortRef.current && !pausedByFailureOrAbort) {
          store.getState().setGenerationStatus('completed');
          store.getState().setGeneratingOutlines([]);
          options.onComplete?.();
        }
      } catch (err: unknown) {
        // AbortError is expected when stop() is called — don't treat as failure
        if (err instanceof DOMException && err.name === 'AbortError') {
          log.info('Generation aborted');
          store.getState().setGenerationStatus('paused');
        } else {
          throw err;
        }
      } finally {
        generatingRef.current = false;
        fetchAbortRef.current = null;
      }
    },
    [options, store],
  );

  // Keep ref in sync so retrySingleOutline can call it
  generateRemainingRef.current = generateRemaining;

  const stop = useCallback(() => {
    abortRef.current = true;
    store.getState().bumpGenerationEpoch();
    fetchAbortRef.current?.abort();
    mediaAbortRef.current?.abort();
  }, [store]);

  const isGenerating = useCallback(() => generatingRef.current, []);

  /** Retry a single failed outline from scratch (content → actions → TTS). */
  const retrySingleOutline = useCallback(
    async (outlineId: string) => {
      const state = store.getState();
      const outline = state.failedOutlines.find((o) => o.id === outlineId);
      if (!outline) return;

      store.getState().addPrioritySlide(outlineId);

      const paramsStr = sessionStorage.getItem('generationParams');
      const params = lastParamsRef.current || (paramsStr ? JSON.parse(paramsStr) : null);
      if (!params) return;

      // Start generation if paused/completed
      if (!isGenerating()) {
        generateRemainingRef.current?.(params);
      }
    },
    [store, isGenerating],
  );

  const regenerateSpeech = useCallback(
    async (sceneId: string) => {
      store.getState().addPrioritySpeech(sceneId);

      const paramsStr = sessionStorage.getItem('generationParams');
      const params = lastParamsRef.current || (paramsStr ? JSON.parse(paramsStr) : null);
      if (!params) return;

      if (!isGenerating()) {
        generateRemainingRef.current?.(params);
      }
    },
    [store, isGenerating],
  );

  const continueLecture = useCallback(
    async (topic: string) => {
      const state = store.getState();
      const { outlines, stage, scenes } = state;
      if (!stage) return;

      const paramsStr = sessionStorage.getItem('generationParams');
      const params = lastParamsRef.current || (paramsStr ? JSON.parse(paramsStr) : null);
      if (!params) return;

      // Reset generation status to completed to avoid interference with the stream reader
      // if it's currently marked as completed.
      store.getState().setGenerationStatus('generating');

      try {
        const existingRequirements = params.requirements || (stage?.description || stage?.name ? { 
          requirement: stage.description || stage.name || 'Educational course', 
          language: stage.language || 'en-US' 
        } as UserRequirements : null);

        if (!existingRequirements) {
          throw new Error('No course requirements found. Cannot continue lecture without context.');
        }

        const response = await fetch('/api/generate/scene-outlines-stream', {
          method: 'POST',
          headers: getApiHeaders(),
          body: JSON.stringify({
            requirements: existingRequirements,
            pdfText: params.pdfText,
            pdfImages: params.pdfImages,
            imageMapping: params.imageMapping,
            researchContext: params.researchContext,
            agents: params.agents,
            existingOutlines: outlines,
            nextModuleTopic: topic,
          }),
        });

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          log.error('Failed to fetch more outlines:', {
            status: response.status,
            statusText: response.statusText,
            error: errorData.error,
            details: errorData.details,
          });
          throw new Error(errorData.error || `Failed to fetch more outlines (HTTP ${response.status})`);
        }

        const reader = response.body?.getReader();
        if (!reader) throw new Error('No reader available');

        const decoder = new TextDecoder();
        let buffer = '';
        const newOutlines: SceneOutline[] = [];

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const data = JSON.parse(line.slice(6));
              if (data.type === 'outline') {
                newOutlines.push(data.data);
                // Pre-append to outlines in store to show in sidebar immediately
                store.getState().setOutlines([...outlines, ...newOutlines]);
              } else if (data.type === 'done') {
                // Final full list from API
                const finalOutlines = data.outlines;
                // Merge with existing but keep order
                const merged = [...outlines];
                for (const o of finalOutlines) {
                  if (!merged.some(m => m.id === o.id)) merged.push(o);
                }
                store.getState().setOutlines(merged);
              }
            }
          }
        }

        // After stream is done, start generating the actual scenes for the new outlines
        generateRemaining(params);
      } catch (error) {
        log.error('Failed to continue lecture:', error);
        store.getState().setGenerationStatus('error');
      }
    },
    [store, generateRemaining],
  );

  const extendModule = useCallback(
    async (moduleTitle: string) => {
      const state = store.getState();
      const { outlines, stage } = state;
      if (!stage) return;

      const paramsStr = sessionStorage.getItem('generationParams');
      const params = lastParamsRef.current || (paramsStr ? JSON.parse(paramsStr) : null);
      if (!params) return;

      store.getState().setGenerationStatus('generating');

      try {
        const existingRequirements = params.requirements || (stage?.description || stage?.name ? { 
          requirement: stage.description || stage.name || 'Educational course', 
          language: stage.language || 'en-US' 
        } as UserRequirements : null);

        if (!existingRequirements) {
          throw new Error('No course requirements found. Cannot continue lecture without context.');
        }

        const moduleScenes = store.getState().scenes.filter(s => s.moduleTitle === moduleTitle);
        
        let lastSceneContext = '';
        if (moduleScenes.length > 0) {
          lastSceneContext += `Existing Slide Titles in this Module:\n`;
          lastSceneContext += moduleScenes.map((s, i) => `${i + 1}. ${s.title}`).join('\n') + '\n\n';
        }

        const lastScene = moduleScenes.length > 0 ? moduleScenes[moduleScenes.length - 1] : null;
        if (lastScene) {
          lastSceneContext += `Last Slide Details (Title: ${lastScene.title}):\n`;
          const actions = lastScene.actions || [];
          const speechActions = actions.filter(a => a.type === 'speech');
          if (speechActions.length > 0) {
             const allText = speechActions.map((a: any) => a.text).filter(Boolean);
             if (allText.length > 0) {
               const head = allText[0];
               const tail = allText.length > 1 ? allText[allText.length - 1] : '';
               lastSceneContext += `- Opening Content: "${head}"\n`;
               if (tail) {
                 lastSceneContext += `- Closing Content: "${tail}"\n`;
               }
             }
          }
        }

        const response = await fetch('/api/generate/scene-outlines-stream', {
          method: 'POST',
          headers: getApiHeaders(),
          body: JSON.stringify({
            requirements: existingRequirements,
            pdfText: params.pdfText,
            pdfImages: params.pdfImages,
            imageMapping: params.imageMapping,
            researchContext: params.researchContext,
            agents: params.agents,
            existingOutlines: outlines,
            extendModuleTopic: moduleTitle,
            lastSceneContext: lastSceneContext || undefined,
          }),
        });

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          log.error('Failed to extend module:', {
            status: response.status,
            statusText: response.statusText,
            error: errorData.error,
          });
          throw new Error(errorData.error || `Failed to extend module (HTTP ${response.status})`);
        }

        const reader = response.body?.getReader();
        if (!reader) throw new Error('No reader available');

        const decoder = new TextDecoder();
        let buffer = '';
        const newOutlines: SceneOutline[] = [];

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const data = JSON.parse(line.slice(6));
              if (data.type === 'outline') {
                newOutlines.push(data.data);
                store.getState().setOutlines([...outlines, ...newOutlines]);
              } else if (data.type === 'done') {
                const finalOutlines = data.outlines;
                const merged = [...outlines];
                for (const o of finalOutlines) {
                  if (!merged.some(m => m.id === o.id)) merged.push(o);
                }
                store.getState().setOutlines(merged);
              }
            }
          }
        }

        generateRemaining(params);
      } catch (error) {
        log.error('Failed to extend module:', error);
        store.getState().setGenerationStatus('error');
      }
    },
    [store, generateRemaining],
  );

  return {
    generateRemaining,
    retrySingleOutline,
    regenerateSpeech,
    stop,
    isGenerating,
    continueLecture,
    extendModule,
  };
}
