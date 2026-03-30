'use client';

import { useState, useEffect, useCallback } from 'react';

interface AgentConfig {
  forwardingAddress: string | null;
  provider: string | null;
  executionMode: 'suggestion' | 'auto_execute';
  confidenceThreshold: number;
  processAttachments: boolean;
  status: string;
}

export default function AgentConfigPage() {
  const [config, setConfig] = useState<AgentConfig | null>(null);
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchConfig = useCallback(async () => {
    try {
      const res = await fetch('/api/agent/config');
      if (!res.ok) throw new Error('Failed to load config');
      const data = await res.json();
      if (data.data) {
        setConfig(data.data);
      } else {
        // No config yet - create with defaults
        setConfig({
          forwardingAddress: null,
          provider: null,
          executionMode: 'suggestion',
          confidenceThreshold: 0.95,
          processAttachments: true,
          status: 'active',
        });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    }
  }, []);

  useEffect(() => { fetchConfig(); }, [fetchConfig]);

  const saveConfig = async (updates: Partial<AgentConfig>) => {
    setSaving(true);
    try {
      const res = await fetch('/api/agent/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });
      if (!res.ok) throw new Error('Failed to save');
      const data = await res.json();
      setConfig(prev => ({ ...prev!, ...data.data }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const copyAddress = () => {
    if (config?.forwardingAddress) {
      navigator.clipboard.writeText(config.forwardingAddress);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  if (!config) {
    return <div className="text-sm text-gray-500">Loading...</div>;
  }

  return (
    <div className="max-w-2xl space-y-8">
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-2 rounded-lg">
          {error}
          <button onClick={() => setError(null)} className="ml-2 text-red-400 hover:text-red-600">×</button>
        </div>
      )}

      {/* Forwarding Address */}
      <section>
        <h2 className="text-sm font-semibold text-gray-900 mb-1">Email Forwarding Address</h2>
        <p className="text-xs text-gray-500 mb-4">
          Forward insurer emails to this address. The agent will process them automatically.
        </p>

        {config.forwardingAddress ? (
          <div className="flex items-center gap-3">
            <code className="flex-1 bg-gray-50 border border-gray-200 rounded-md px-3 py-2 text-sm font-mono text-gray-800 truncate">
              {config.forwardingAddress}
            </code>
            <button
              onClick={copyAddress}
              className="px-3 py-2 text-xs font-medium bg-gray-900 text-white rounded-md hover:bg-gray-800 transition-colors shrink-0"
            >
              {copied ? 'Copied!' : 'Copy'}
            </button>
          </div>
        ) : (
          <button
            onClick={() => saveConfig({})}
            disabled={saving}
            className="px-4 py-2 text-sm font-medium bg-gray-900 text-white rounded-md hover:bg-gray-800 disabled:opacity-50 transition-colors"
          >
            Generate Forwarding Address
          </button>
        )}
      </section>

      {/* Execution Mode */}
      <section>
        <h2 className="text-sm font-semibold text-gray-900 mb-1">Execution Mode</h2>
        <p className="text-xs text-gray-500 mb-4">
          Choose how the agent handles extracted actions.
        </p>

        <div className="space-y-3">
          <label className="flex items-start gap-3 p-3 border border-gray-200 rounded-lg cursor-pointer hover:border-gray-300 transition-colors">
            <input
              type="radio"
              name="mode"
              checked={config.executionMode === 'suggestion'}
              onChange={() => saveConfig({ executionMode: 'suggestion' })}
              className="mt-0.5"
            />
            <div>
              <p className="text-sm font-medium text-gray-900">Suggestion Mode</p>
              <p className="text-xs text-gray-500">Agent suggests actions. You review and confirm each one.</p>
            </div>
          </label>

          <label className="flex items-start gap-3 p-3 border border-gray-200 rounded-lg cursor-pointer hover:border-gray-300 transition-colors">
            <input
              type="radio"
              name="mode"
              checked={config.executionMode === 'auto_execute'}
              onChange={() => saveConfig({ executionMode: 'auto_execute' })}
              className="mt-0.5"
            />
            <div>
              <p className="text-sm font-medium text-gray-900">Auto-Execute Mode</p>
              <p className="text-xs text-gray-500">
                High-confidence actions execute automatically. Lower confidence actions still require review.
              </p>
            </div>
          </label>
        </div>

        {config.executionMode === 'auto_execute' && (
          <div className="mt-4">
            <label className="text-xs text-gray-500 block mb-2">
              Confidence Threshold: {Math.round(config.confidenceThreshold * 100)}%
            </label>
            <input
              type="range"
              min="80"
              max="99"
              value={Math.round(config.confidenceThreshold * 100)}
              onChange={(e) => saveConfig({ confidenceThreshold: parseInt(e.target.value) / 100 })}
              className="w-full"
            />
            <div className="flex justify-between text-xs text-gray-400 mt-1">
              <span>80%</span>
              <span>99%</span>
            </div>
          </div>
        )}
      </section>

      {/* Status */}
      <section>
        <h2 className="text-sm font-semibold text-gray-900 mb-1">Connection Status</h2>
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${
            config.status === 'active' ? 'bg-emerald-500' :
            config.status === 'paused' ? 'bg-amber-500' : 'bg-red-500'
          }`} />
          <span className="text-sm text-gray-700 capitalize">{config.status}</span>
        </div>
      </section>
    </div>
  );
}
