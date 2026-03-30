import { useSettingsStore } from '@/lib/store/settings';
import { parseModelString } from '@/lib/ai/providers';

interface ModelConfigResult {
  providerId: string;
  modelId: string;
  modelString: string;
  outlineModel?: string;
  contentModel?: string;
  actionsModel?: string;
  apiKey: string;
  baseUrl: string;
  providerType?: string;
  requiresApiKey?: boolean;
  isServerConfigured?: boolean;
}

function getLocalStageModelDefaults(modelString: string) {
  const { providerId } = parseModelString(modelString);
  if (providerId !== 'ollama') return null;
  return {
    // Keep stage models aligned with the user-selected Ollama model unless
    // the user explicitly configures per-stage overrides.
    outlineModel: modelString,
    contentModel: modelString,
    actionsModel: modelString,
  };
}

/**
 * Get current model configuration from settings store
 */
export function getCurrentModelConfig() {
  const { providerId, modelId, providersConfig } = useSettingsStore.getState();
  const modelString = `${providerId}:${modelId}`;

  // Get current provider's config
  const providerConfig = providersConfig[providerId];

  return {
    providerId,
    modelId,
    modelString,
    ...(getLocalStageModelDefaults(modelString) || {}),
    apiKey: providerConfig?.apiKey || '',
    baseUrl: providerConfig?.baseUrl || '',
    providerType: providerConfig?.type,
    requiresApiKey: providerConfig?.requiresApiKey,
    isServerConfigured: providerConfig?.isServerConfigured,
  } as ModelConfigResult;
}
