import React, { useState } from 'react';
import type { AIProvider, AIConfig } from '../types';
import { PROVIDER_DEFAULTS, PROVIDER_MODELS } from '../types';
import { getAllConfigs, getActiveProvider, setActiveProvider, saveProviderConfig, validateConfig } from '../services/configService';

interface ConfigPanelProps {
  embedded?: boolean;
  onSaved?: () => void;
}

export const ConfigPanel: React.FC<ConfigPanelProps> = ({ embedded, onSaved }) => {
  const [provider, setProvider] = useState<AIProvider>(getActiveProvider());
  const [configs, setConfigs] = useState<Record<AIProvider, AIConfig>>(getAllConfigs());
  const [testStatus, setTestStatus] = useState<'idle' | 'testing' | 'success' | 'error'>('idle');
  const [testMessage, setTestMessage] = useState('');

  const currentConfig = configs[provider];

  const updateConfig = (patch: Partial<AIConfig>) => {
    const next = { ...currentConfig, ...patch };
    setConfigs(prev => ({ ...prev, [provider]: next }));
  };

  const handleSave = () => {
    const validation = validateConfig(currentConfig);
    if (!validation.valid) {
      setTestStatus('error');
      setTestMessage(validation.error || 'Invalid config');
      return;
    }
    saveProviderConfig(provider, { ...currentConfig, enabled: true });
    setTestStatus('success');
    setTestMessage('Configuration saved');
    setTimeout(() => {
      setTestStatus('idle');
      onSaved?.();
    }, 800);
  };

  const handleProviderChange = (p: AIProvider) => {
    setProvider(p);
    setActiveProvider(p);
    setConfigs(prev => ({
      ...prev,
      [p]: {
        ...prev[p],
        model: prev[p]?.model || PROVIDER_DEFAULTS[p].model,
      },
    }));
    setTestStatus('idle');
  };

  const handleTestConnection = async () => {
    setTestStatus('testing');
    setTestMessage('Testing connection...');
    try {
      const config = currentConfig;
      if (!config.apiKey) throw new Error('API Key is required');

      const base = config.baseUrl || (config.provider === 'deepseek' ? 'https://api.deepseek.com' : 'https://api.moonshot.cn/v1');
      const res = await fetch(`${base}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify({
          model: config.model,
          messages: [{ role: 'user', content: 'Hi' }],
          max_tokens: 1,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as any).error?.message || `API returned ${res.status}`);
      }

      setTestStatus('success');
      setTestMessage('Connection successful');
    } catch (err: any) {
      setTestStatus('error');
      setTestMessage(err.message || 'Connection failed');
    }
  };

  return (
    <div className={`space-y-3 ${embedded ? '' : 'border rounded p-3 bg-gray-50'}`}>
      {!embedded && <label className="text-xs font-bold uppercase text-gray-500 block">AI Configuration</label>}

      <div>
        <label className="text-[10px] font-bold uppercase text-gray-400 block mb-1">Provider</label>
        <select
          value={provider}
          onChange={e => handleProviderChange(e.target.value as AIProvider)}
          className="w-full border rounded p-2 text-sm"
        >
          <option value="deepseek">DeepSeek</option>
          <option value="kimi">Kimi</option>
          <option value="custom">Custom (OpenAI-compatible)</option>
        </select>
      </div>

      <div>
        <label className="text-[10px] font-bold uppercase text-gray-400 block mb-1">API Key</label>
        <input
          type="password"
          value={currentConfig.apiKey}
          onChange={e => updateConfig({ apiKey: e.target.value })}
          placeholder="Enter your API key"
          className="w-full border rounded p-2 text-sm"
        />
      </div>

      <div>
        <label className="text-[10px] font-bold uppercase text-gray-400 block mb-1">Model</label>
        {provider === 'custom' ? (
          <input
            type="text"
            value={currentConfig.model}
            onChange={e => updateConfig({ model: e.target.value })}
            placeholder="Enter model id"
            className="w-full border rounded p-2 text-sm"
          />
        ) : (
          <select
            value={currentConfig.model}
            onChange={e => updateConfig({ model: e.target.value })}
            className="w-full border rounded p-2 text-sm bg-white"
          >
            {PROVIDER_MODELS[provider].map(model => (
              <option key={model.value} value={model.value}>{model.label}</option>
            ))}
          </select>
        )}
        {provider === 'deepseek' && (
          <div className="text-[9px] text-gray-400 mt-1">
            Use DeepSeek V4 Pro by selecting "DeepSeek V4 Pro" (model id: deepseek-v4-pro).
          </div>
        )}
      </div>

      <div>
        <label className="text-[10px] font-bold uppercase text-gray-400 block mb-1">
          API Proxy <span className="text-green-600">built in</span>
        </label>
        <div className="w-full border rounded p-2 text-sm bg-green-50 text-green-800 font-mono text-xs">
          api.comprequiz.chao.asia
        </div>
        <div className="text-[9px] text-gray-400 mt-1">
          Uses the built-in proxy by default. Add a custom proxy only if your network needs it.
        </div>
        <input
          type="text"
          value={localStorage.getItem('vocabforge_custom_proxy') || ''}
          onChange={e => {
            const val = e.target.value.trim();
            if (val) localStorage.setItem('vocabforge_custom_proxy', val);
            else localStorage.removeItem('vocabforge_custom_proxy');
          }}
          placeholder="Custom proxy URL (optional)"
          className="w-full border rounded p-2 text-sm mt-1"
        />
      </div>

      {provider === 'custom' && (
        <div>
          <label className="text-[10px] font-bold uppercase text-gray-400 block mb-1">Base URL</label>
          <input
            type="text"
            value={currentConfig.baseUrl || ''}
            onChange={e => updateConfig({ baseUrl: e.target.value })}
            placeholder="https://api.example.com/v1"
            className="w-full border rounded p-2 text-sm"
          />
        </div>
      )}

      <div className="flex gap-2">
        <button
          onClick={handleTestConnection}
          disabled={testStatus === 'testing'}
          className="flex-1 py-2 rounded font-bold text-xs bg-gray-200 hover:bg-gray-300 transition-colors"
        >
          {testStatus === 'testing' ? 'Testing...' : 'Test Connection'}
        </button>
        <button
          onClick={handleSave}
          className="flex-1 py-2 rounded font-bold text-xs bg-blue-600 text-white hover:bg-blue-700 transition-colors"
        >
          Save Config
        </button>
      </div>

      {testStatus !== 'idle' && (
        <div className={`text-xs p-2 rounded ${testStatus === 'success' ? 'bg-green-50 text-green-700' : testStatus === 'error' ? 'bg-red-50 text-red-700' : 'bg-gray-50 text-gray-600'}`}>
          {testMessage}
        </div>
      )}
    </div>
  );
};
