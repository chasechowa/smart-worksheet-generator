import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  getStoredConfigs,
  saveProviderConfig,
  setActiveProvider,
  getActiveConfig,
  getProviderConfig,
  initDefaultConfigs,
} from '../configService';
import type { AIProvider } from '../../types';

const storage: Record<string, string> = {};

Object.defineProperty(globalThis, 'localStorage', {
  value: {
    getItem: (key: string) => storage[key] || null,
    setItem: (key: string, value: string) => { storage[key] = value; },
    clear: () => { Object.keys(storage).forEach(k => delete storage[k]); },
    removeItem: (key: string) => { delete storage[key]; },
  },
  writable: true,
});

describe('configService', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('should return null when no config exists', () => {
    expect(getStoredConfigs()).toBeNull();
  });

  it('should init default configs', () => {
    initDefaultConfigs();
    const configs = getStoredConfigs();
    expect(configs).not.toBeNull();
    expect(configs!.activeProvider).toBe('deepseek');
    expect(configs!.providers.deepseek).toBeDefined();
    expect(configs!.providers.deepseek.enabled).toBe(false);
  });

  it('should save and retrieve provider config', () => {
    initDefaultConfigs();
    saveProviderConfig('deepseek', {
      provider: 'deepseek',
      apiKey: 'sk-test',
      model: 'deepseek-chat',
      enabled: true,
    });
    const config = getProviderConfig('deepseek');
    expect(config?.apiKey).toBe('sk-test');
    expect(config?.enabled).toBe(true);
  });

  it('should switch active provider', () => {
    initDefaultConfigs();
    setActiveProvider('kimi');
    expect(getStoredConfigs()?.activeProvider).toBe('kimi');
    expect(getActiveConfig()?.provider).toBe('kimi');
  });

  it('should heal a deprecated deepseek model id to a valid one', () => {
    initDefaultConfigs();
    saveProviderConfig('deepseek', {
      provider: 'deepseek',
      apiKey: 'sk-test',
      model: 'deepseek-chat',
      enabled: true,
    });
    const config = getProviderConfig('deepseek');
    expect(config?.model).toBe('deepseek-v4-pro');
    expect(config?.apiKey).toBe('sk-test');
  });
});
