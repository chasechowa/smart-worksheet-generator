import React, { useState } from 'react';
import type { AIProvider } from '../types';
import { PROVIDER_DEFAULTS } from '../types';
import { getAllConfigs, getActiveProvider, setActiveProvider, saveProviderConfig, validateConfig } from '../services/configService';

interface ConfigPanelProps {
  embedded?: boolean;
}

export const ConfigPanel: React.FC<ConfigPanelProps> = ({ embedded }) => {
  const [provider, setProvider] = useState<AIProvider>(getActiveProvider());
  const [configs, setConfigs] = useState<Record<AIProvider, any>>(getAllConfigs());
  const [testStatus, setTestStatus] = useState<'idle' | 'testing' | 'success' | 'error'>('idle');
  const [testMessage, setTestMessage] = useState('');

  const currentConfig = configs[provider];

  const updateConfig = (patch: Partial<any>) => {
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
    setTimeout(() => setTestStatus('idle'), 2000);
  };

  const handleProviderChange = (p: AIProvider) => {
    setProvider(p);
    setActiveProvider(p);
    updateConfig({ model: PROVIDER_DEFAULTS[p].model });
    setTestStatus('idle');
  };

  const handleTestConnection = async () => {
    setTestStatus('testing');
    setTestMessage('Testing connection...');
    try {
      const config = currentConfig;
      if (!config.apiKey) throw new Error('API Key is required');

      if (config.provider === 'gemini') {
        const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${config.apiKey}&pageSize=1`);
        if (!res.ok) throw new Error(`API returned ${res.status}`);
      } else {
        const base = config.baseUrl || (config.provider === 'deepseek' ? 'https://api.deepseek.com/v1' : 'https://api.moonshot.cn/v1');
        // Use a minimal chat completion to verify the key (not all providers expose /models)
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
          <option value="gemini">Gemini</option>
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
