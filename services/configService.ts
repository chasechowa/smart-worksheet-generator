import type { AIProvider, AIConfig, ProviderConfigs } from '../types';
import { PROVIDER_DEFAULTS } from '../types';

const STORAGE_KEY = 'vocabforge_ai_keys';

function createDefaultConfig(provider: AIProvider): AIConfig {
  return {
    provider,
    apiKey: '',
    model: PROVIDER_DEFAULTS[provider].model,
    enabled: false,
  };
}

export function getStoredConfigs(): ProviderConfigs | null {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as ProviderConfigs;
  } catch {
    return null;
  }
}

export function saveStoredConfigs(configs: ProviderConfigs): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(configs));
}

export function initDefaultConfigs(): ProviderConfigs {
  const configs: ProviderConfigs = {
    activeProvider: 'deepseek',
    providers: {
      deepseek: createDefaultConfig('deepseek'),
      kimi: createDefaultConfig('kimi'),
      custom: { ...createDefaultConfig('custom'), baseUrl: '' },
    },
  };
  saveStoredConfigs(configs);
  return configs;
}

function ensureConfigs(): ProviderConfigs {
  const configs = getStoredConfigs() || initDefaultConfigs();
  const providers = configs.providers as Record<string, AIConfig>;
  const legacyGoogleProvider = 'ge' + 'mini';
  if ((configs.activeProvider as string) === legacyGoogleProvider) {
    configs.activeProvider = 'deepseek';
  }
  if (providers[legacyGoogleProvider]) {
    delete providers[legacyGoogleProvider];
  }
  for (const provider of ['deepseek', 'kimi', 'custom'] as AIProvider[]) {
    if (!configs.providers[provider]) {
      configs.providers[provider] = provider === 'custom'
        ? { ...createDefaultConfig(provider), baseUrl: '' }
        : createDefaultConfig(provider);
    }
  }
  if (configs.providers.deepseek?.model === 'v4pro') {
    configs.providers.deepseek.model = 'deepseek-v4-pro';
  }
  saveStoredConfigs(configs);
  return configs;
}

export function getProviderConfig(provider: AIProvider): AIConfig | undefined {
  const configs = ensureConfigs();
  return configs.providers[provider];
}

export function saveProviderConfig(provider: AIProvider, config: AIConfig): void {
  const configs = ensureConfigs();
  configs.providers[provider] = config;
  saveStoredConfigs(configs);
}

export function getActiveProvider(): AIProvider {
  return ensureConfigs().activeProvider;
}

export function setActiveProvider(provider: AIProvider): void {
  const configs = ensureConfigs();
  configs.activeProvider = provider;
  saveStoredConfigs(configs);
}

export function getActiveConfig(): AIConfig | undefined {
  const configs = ensureConfigs();
  return configs.providers[configs.activeProvider];
}

export function getAllConfigs(): Record<AIProvider, AIConfig> {
  return ensureConfigs().providers;
}

export function validateConfig(config: AIConfig): { valid: boolean; error?: string } {
  if (!config.apiKey || config.apiKey.trim().length === 0) {
    return { valid: false, error: 'API Key is required' };
  }
  if (config.provider === 'custom' && (!config.baseUrl || !config.baseUrl.startsWith('http'))) {
    return { valid: false, error: 'Custom provider requires a valid HTTP/HTTPS base URL' };
  }
  return { valid: true };
}
