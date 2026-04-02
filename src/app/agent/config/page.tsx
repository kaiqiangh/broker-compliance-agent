'use client';

import { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'next/navigation';

interface AgentConfig {
  forwardingAddress: string | null;
  provider: string | null;
  executionMode: 'suggestion' | 'auto_execute';
  confidenceThreshold: number;
  processAttachments: boolean;
  status: string;
  notifyOnAction?: string;
  notifyChannel?: string;
  notifyDigestMode?: string;
  digestEnabled?: boolean;
  digestTime?: string;
  urgentNotifications?: boolean;
  insurerDomains?: string[];
  health?: {
    status: string;
    lastPolledAt: string | null;
    lastError: string | null;
    errorCount: number;
    isHealthy: boolean;
  };
}

export default function AgentConfigPage() {
  const searchParams = useSearchParams();
  const [config, setConfig] = useState<AgentConfig | null>(null);
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successToast, setSuccessToast] = useState<string | null>(null);
  const [disconnecting, setDisconnecting] = useState(false);

  // IMAP form state
  const [imapServer, setImapServer] = useState('gmail');
  const [imapCustomHost, setImapCustomHost] = useState('');
  const [imapCustomPort, setImapCustomPort] = useState('993');
  const [imapEmail, setImapEmail] = useState('');
  const [imapPassword, setImapPassword] = useState('');
  const [imapConnecting, setImapConnecting] = useState(false);

  // Handle ?connected=gmail or ?connected=outlook success param
  useEffect(() => {
    const connected = searchParams.get('connected');
    if (connected) {
      setSuccessToast(`${connected.charAt(0).toUpperCase() + connected.slice(1)} connected successfully`);
      // Clean up URL
      window.history.replaceState({}, '', '/agent/config');
      const timer = setTimeout(() => setSuccessToast(null), 5000);
      return () => clearTimeout(timer);
    }
  }, [searchParams]);

  const disconnectProvider = async () => {
    setDisconnecting(true);
    try {
      const res = await fetch('/api/agent/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: null }),
      });
      if (!res.ok) throw new Error('Failed to disconnect');
      const data = await res.json();
      setConfig(prev => ({ ...prev!, ...data.data }));
      setSuccessToast('Disconnected successfully');
      setTimeout(() => setSuccessToast(null), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to disconnect');
    } finally {
      setDisconnecting(false);
    }
  };

  const connectIMAP = async () => {
    setImapConnecting(true);
    setError(null);
    try {
      let host: string;
      let port: number;
      if (imapServer === 'custom') {
        host = imapCustomHost;
        port = parseInt(imapCustomPort) || 993;
      } else {
        host = imapServer; // 'gmail' or 'outlook' — server resolves preset
        port = 993;
      }

      const res = await fetch('/api/agent/oauth/imap/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ host, port, username: imapEmail, password: imapPassword }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error?.message || 'Failed to connect');
      }

      setSuccessToast('IMAP connected successfully');
      setImapPassword('');
      fetchConfig();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to connect IMAP');
    } finally {
      setImapConnecting(false);
    }
  };

  const disconnectIMAP = async () => {
    setDisconnecting(true);
    try {
      const res = await fetch('/api/agent/oauth/imap/disconnect', { method: 'POST' });
      if (!res.ok) throw new Error('Failed to disconnect');
      setSuccessToast('IMAP disconnected');
      fetchConfig();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to disconnect');
    } finally {
      setDisconnecting(false);
    }
  };

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
      // Include CSRF token
      const csrfMatch = document.cookie.match(/(?:^|;\s*)csrf_token=([^;]*)/);
      const csrfToken = csrfMatch?.[1] || '';
      
      const res = await fetch('/api/agent/config', {
        method: 'PUT',
        headers: { 
          'Content-Type': 'application/json',
          ...(csrfToken && { 'X-CSRF-Token': csrfToken }),
        },
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

      {successToast && (
        <div className="bg-emerald-50 border border-emerald-200 text-emerald-700 text-sm px-4 py-2 rounded-lg">
          {successToast}
          <button onClick={() => setSuccessToast(null)} className="ml-2 text-emerald-400 hover:text-emerald-600">×</button>
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
          <div className="mt-4 p-4 bg-yellow-50 border border-yellow-200 rounded-md text-amber-800 text-sm mb-4">
            ⚠️ Auto-execute 模式下，confidence ≥ {Math.round(config.confidenceThreshold * 100)}% 的 action 会自动执行。所有操作可 24h 内 undo。
          </div>
        )}

        {config.executionMode === 'auto_execute' && (
          <div>
            <label className="text-xs text-gray-500 block mb-2">
              Confidence Threshold
            </label>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={80}
                max={99}
                value={Math.round(config.confidenceThreshold * 100)}
                onChange={(e) => {
                  const val = Math.min(99, Math.max(80, parseInt(e.target.value) || 80));
                  saveConfig({ confidenceThreshold: val / 100 });
                }}
                className="w-20 border border-gray-200 rounded-md p-2 text-sm text-center"
              />
              <span className="text-sm text-gray-500">%</span>
            </div>
            <p className="text-xs text-gray-400 mt-1">Range: 80–99%</p>
          </div>
        )}
      </section>

      {/* Email Connection (OAuth) */}
      <section>
        <h2 className="text-sm font-semibold text-gray-900 mb-1">Email Connection</h2>
        <p className="text-xs text-gray-500 mb-4">
          Connect your email account so the agent can read and process emails directly.
        </p>

        {config.provider ? (
          <div className="flex items-center gap-3 p-3 border border-gray-200 rounded-lg">
            <div className="w-2 h-2 rounded-full bg-emerald-500" />
            <span className="text-sm text-gray-700">
              Connected via <span className="font-medium capitalize">{config.provider}</span>
            </span>
            <button
              onClick={disconnectProvider}
              disabled={disconnecting}
              className="ml-auto px-3 py-1.5 text-xs font-medium text-red-600 border border-red-200 rounded-md hover:bg-red-50 disabled:opacity-50 transition-colors"
            >
              {disconnecting ? 'Disconnecting...' : 'Disconnect'}
            </button>
          </div>
        ) : (
          <div className="flex flex-col sm:flex-row gap-3">
            <a
              href="/api/agent/oauth/gmail/authorize"
              className="inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium bg-white border border-gray-200 rounded-lg hover:border-gray-300 hover:bg-gray-50 transition-colors"
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none">
                <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/>
                <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18A10.96 10.96 0 001 12c0 1.77.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/>
                <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
              </svg>
              Connect Gmail
            </a>
            <a
              href="/api/agent/oauth/outlook/authorize"
              className="inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium bg-white border border-gray-200 rounded-lg hover:border-gray-300 hover:bg-gray-50 transition-colors"
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none">
                <path d="M24 7.387v10.478c0 .23-.08.424-.238.576a.807.807 0 01-.588.234h-8.44v-7.51h2.48l.37 2.49h2.91V17.67h-2.56l-.38-2.55h-3.03v-7.733h8.44c.23 0 .424.08.578.234.158.152.238.345.238.576l-.001-.001z" fill="#0078D4"/>
                <path d="M0 7.387v10.478c0 .23.08.424.238.576.154.156.348.234.588.234h8.44v-7.51H6.78l-.37 2.49H3.5V17.67h2.56l.38-2.55h3.03v-7.733H1.03c-.23 0-.424.08-.578.234C.3.57.22.764.22.995l-.22-.001V7.387z" fill="#0078D4"/>
                <path d="M12 1.5l-7 3.5v7l7 3.5 7-3.5V5l-7-3.5z" fill="#0078D4" opacity=".15"/>
              </svg>
              Connect Outlook
            </a>
          </div>
        )}
      </section>

      {/* IMAP Direct Connection */}
      <section>
        <h2 className="text-sm font-semibold text-gray-900 mb-1">IMAP Direct Connection</h2>
        <p className="text-xs text-gray-500 mb-4">
          Connect via IMAP for providers that don't support OAuth (e.g., custom mail servers). Credentials are encrypted and stored securely.
        </p>

        {config.provider === 'imap' ? (
          <div className="flex items-center gap-3 p-3 border border-gray-200 rounded-lg">
            <div className="w-2 h-2 rounded-full bg-emerald-500" />
            <span className="text-sm text-gray-700">
              Connected via <span className="font-medium">IMAP</span>
            </span>
            <button
              onClick={disconnectIMAP}
              disabled={disconnecting}
              className="ml-auto px-3 py-1.5 text-xs font-medium text-red-600 border border-red-200 rounded-md hover:bg-red-50 disabled:opacity-50 transition-colors"
            >
              {disconnecting ? 'Disconnecting...' : 'Disconnect'}
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            <div>
              <label className="text-xs font-medium text-gray-500 block mb-1">Mail Server</label>
              <select
                value={imapServer}
                onChange={(e) => setImapServer(e.target.value)}
                className="block w-full border border-gray-200 rounded-md p-2 text-sm"
              >
                <option value="gmail">Gmail (imap.gmail.com)</option>
                <option value="outlook">Outlook (outlook.office365.com)</option>
                <option value="custom">Custom Server</option>
              </select>
            </div>

            {imapServer === 'custom' && (
              <div className="grid grid-cols-3 gap-3">
                <div className="col-span-2">
                  <label className="text-xs font-medium text-gray-500 block mb-1">Host</label>
                  <input
                    type="text"
                    value={imapCustomHost}
                    onChange={(e) => setImapCustomHost(e.target.value)}
                    placeholder="imap.example.com"
                    className="block w-full border border-gray-200 rounded-md p-2 text-sm"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-500 block mb-1">Port</label>
                  <input
                    type="number"
                    value={imapCustomPort}
                    onChange={(e) => setImapCustomPort(e.target.value)}
                    className="block w-full border border-gray-200 rounded-md p-2 text-sm"
                  />
                </div>
              </div>
            )}

            <div>
              <label className="text-xs font-medium text-gray-500 block mb-1">Email / Username</label>
              <input
                type="email"
                value={imapEmail}
                onChange={(e) => setImapEmail(e.target.value)}
                placeholder="you@example.com"
                className="block w-full border border-gray-200 rounded-md p-2 text-sm"
              />
            </div>

            <div>
              <label className="text-xs font-medium text-gray-500 block mb-1">Password / App Password</label>
              <input
                type="password"
                value={imapPassword}
                onChange={(e) => setImapPassword(e.target.value)}
                placeholder="••••••••"
                className="block w-full border border-gray-200 rounded-md p-2 text-sm"
              />
              <p className="text-xs text-gray-400 mt-1">
                For Gmail, use an <a href="https://support.google.com/accounts/answer/185833" target="_blank" rel="noopener noreferrer" className="underline">App Password</a>.
              </p>
            </div>

            <button
              onClick={connectIMAP}
              disabled={imapConnecting || !imapEmail || !imapPassword}
              className="px-4 py-2 text-sm font-medium bg-gray-900 text-white rounded-md hover:bg-gray-800 disabled:opacity-50 transition-colors"
            >
              {imapConnecting ? 'Connecting...' : 'Test & Connect'}
            </button>
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
        {config.health?.lastError && (
          <p className="text-xs text-red-600 mt-1">Error: {config.health.lastError}</p>
        )}
      </section>

      {/* Notifications */}
      <section>
        <h2 className="text-sm font-semibold text-gray-900 mb-1">Notifications</h2>
        <p className="text-xs text-gray-500 mb-4">Control when and how you're notified about agent actions.</p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label className="text-xs font-medium text-gray-500">When to notify</label>
            <select
              value={config.notifyOnAction || 'pending'}
              onChange={(e) => saveConfig({ notifyOnAction: e.target.value })}
              className="mt-1 block w-full border border-gray-200 rounded-md p-2 text-sm"
            >
              <option value="all">All actions</option>
              <option value="pending">Only pending</option>
              <option value="errors">Only errors</option>
            </select>
          </div>
          <div>
            <label className="text-xs font-medium text-gray-500">Channel</label>
            <select
              value={config.notifyChannel || 'dashboard'}
              onChange={(e) => saveConfig({ notifyChannel: e.target.value })}
              className="mt-1 block w-full border border-gray-200 rounded-md p-2 text-sm"
            >
              <option value="dashboard">Dashboard only</option>
              <option value="email">Email</option>
              <option value="both">Both</option>
            </select>
          </div>
          <div>
            <label className="text-xs font-medium text-gray-500">Email digest</label>
            <select
              value={config.notifyDigestMode || 'realtime'}
              onChange={(e) => saveConfig({ notifyDigestMode: e.target.value })}
              className="mt-1 block w-full border border-gray-200 rounded-md p-2 text-sm"
            >
              <option value="realtime">Real-time</option>
              <option value="daily">Daily summary</option>
            </select>
          </div>
        </div>
      </section>

      {/* Notification Preferences */}
      <section>
        <h2 className="text-sm font-semibold text-gray-900 mb-1">Notification Preferences</h2>
        <p className="text-xs text-gray-500 mb-4">Control digest emails and urgent alerts.</p>
        <div className="space-y-4">
          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={config.digestEnabled !== false}
              onChange={(e) => saveConfig({ digestEnabled: e.target.checked })}
              className="rounded"
            />
            <div>
              <p className="text-sm font-medium text-gray-900">Daily Digest Email</p>
              <p className="text-xs text-gray-500">Receive a daily summary of agent activity.</p>
            </div>
          </label>

          {config.digestEnabled !== false && (
            <div className="ml-7">
              <label className="text-xs font-medium text-gray-500 block mb-1">Digest Delivery Time</label>
              <select
                value={config.digestTime || '08:00'}
                onChange={(e) => saveConfig({ digestTime: e.target.value })}
                className="border border-gray-200 rounded-md p-2 text-sm"
              >
                <option value="06:00">06:00</option>
                <option value="08:00">08:00</option>
                <option value="10:00">10:00</option>
                <option value="12:00">12:00</option>
              </select>
            </div>
          )}

          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={config.urgentNotifications !== false}
              onChange={(e) => saveConfig({ urgentNotifications: e.target.checked })}
              className="rounded"
            />
            <div>
              <p className="text-sm font-medium text-gray-900">Urgent Notifications</p>
              <p className="text-xs text-gray-500">Get alerted immediately for high-priority actions (claims, cancellations, low confidence).</p>
            </div>
          </label>
        </div>
      </section>

      {/* Insurer Domains */}
      <section>
        <h2 className="text-sm font-semibold text-gray-900 mb-1">Insurer Domains</h2>
        <p className="text-xs text-gray-500 mb-4">
          Emails from these domains are classified as insurance with high confidence.
        </p>
        <div className="flex flex-wrap gap-2 mb-4">
          {(config.insurerDomains || []).length === 0 && (
            <span className="text-xs text-gray-400">Using default insurer domains</span>
          )}
          {(config.insurerDomains || []).map((domain: string) => (
            <span key={domain} className="inline-flex items-center gap-1 px-2 py-1 bg-gray-100 rounded text-sm">
              {domain}
              <button
                onClick={() => {
                  const updated = (config.insurerDomains || []).filter((d: string) => d !== domain);
                  saveConfig({ insurerDomains: updated });
                }}
                className="text-gray-400 hover:text-red-500 ml-1"
              >
                ×
              </button>
            </span>
          ))}
        </div>
      </section>
    </div>
  );
}
