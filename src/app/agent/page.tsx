'use client';

import { useState, useEffect, useCallback } from 'react';

// Types
interface AgentAction {
  id: string;
  actionType: string;
  entityType: string | null;
  entityId: string | null;
  matchConfidence: number | null;
  changes: Record<string, { old: any; new: any }>;
  confidence: number;
  reasoning: string | null;
  status: string;
  createdAt: string;
  email: {
    id: string;
    subject: string;
    fromAddress: string;
    receivedAt: string;
  };
}

interface AgentEmail {
  id: string;
  subject: string;
  fromAddress: string;
  receivedAt: string;
  isInsurance: boolean | null;
  category: string | null;
  status: string;
  _count: { actions: number; attachments: number };
}

// Confidence bar component
function ConfidenceBar({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  const color = pct >= 95 ? 'bg-emerald-500' : pct >= 80 ? 'bg-amber-500' : 'bg-red-500';
  return (
    <div className="flex items-center gap-2">
      <div className="w-16 h-1.5 bg-gray-100 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color} transition-all duration-300`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs tabular-nums text-gray-500">{pct}%</span>
    </div>
  );
}

// Action type labels
function actionLabel(type: string): string {
  const labels: Record<string, string> = {
    update_policy: 'Update Policy',
    create_policy: 'Create Policy',
    create_client: 'Create Client',
    cancel_policy: 'Cancel Policy',
    update_claim: 'Update Claim',
    flag_for_review: 'Needs Review',
    no_action: 'No Change',
  };
  return labels[type] || type;
}

function actionColor(type: string): string {
  const colors: Record<string, string> = {
    update_policy: 'bg-blue-50 text-blue-700 border-blue-200',
    create_policy: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    create_client: 'bg-violet-50 text-violet-700 border-violet-200',
    cancel_policy: 'bg-red-50 text-red-700 border-red-200',
    flag_for_review: 'bg-amber-50 text-amber-700 border-amber-200',
    no_action: 'bg-gray-50 text-gray-500 border-gray-200',
  };
  return colors[type] || 'bg-gray-50 text-gray-700 border-gray-200';
}

// Change summary component
function ChangeSummary({ changes }: { changes: Record<string, { old: any; new: any }> }) {
  const entries = Object.entries(changes);
  if (entries.length === 0) return <span className="text-xs text-gray-400">No changes</span>;

  return (
    <div className="space-y-1">
      {entries.map(([field, { old: oldVal, new: newVal }]) => (
        <div key={field} className="flex items-center gap-2 text-xs">
          <span className="text-gray-500 w-20 shrink-0">{field.replace(/_/g, ' ')}</span>
          <span className="text-gray-400 line-through truncate max-w-[100px]">{String(oldVal ?? '—')}</span>
          <span className="text-gray-300">→</span>
          <span className="font-medium text-gray-900 truncate max-w-[100px]">{String(newVal)}</span>
        </div>
      ))}
    </div>
  );
}

// Action card component
function ActionCard({
  action,
  onConfirm,
  onReject,
  loading,
}: {
  action: AgentAction;
  onConfirm: (id: string) => void;
  onReject: (id: string) => void;
  loading: string | null;
}) {
  const isLoading = loading === action.id;

  return (
    <div className="border border-gray-200 rounded-lg p-4 hover:border-gray-300 transition-colors bg-white">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-1">
            <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${actionColor(action.actionType)}`}>
              {actionLabel(action.actionType)}
            </span>
            <ConfidenceBar value={action.confidence} />
          </div>
          <p className="text-sm font-medium text-gray-900 truncate">{action.email.subject}</p>
          <p className="text-xs text-gray-500">{action.email.fromAddress}</p>
        </div>
      </div>

      {/* Changes */}
      <div className="mb-3 pl-3 border-l-2 border-gray-100">
        <ChangeSummary changes={action.changes} />
      </div>

      {/* Reasoning */}
      {action.reasoning && (
        <p className="text-xs text-gray-400 mb-3 italic">{action.reasoning}</p>
      )}

      {/* Actions */}
      <div className="flex items-center gap-2">
        <button
          onClick={() => onConfirm(action.id)}
          disabled={isLoading}
          className="px-3 py-1.5 text-xs font-medium bg-gray-900 text-white rounded-md hover:bg-gray-800 disabled:opacity-50 transition-colors"
        >
          {isLoading ? 'Confirming...' : 'Confirm'}
        </button>
        <button
          onClick={() => onReject(action.id)}
          disabled={isLoading}
          className="px-3 py-1.5 text-xs font-medium text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-md disabled:opacity-50 transition-colors"
        >
          Reject
        </button>
        <span className="text-xs text-gray-400 ml-auto">
          {new Date(action.createdAt).toLocaleTimeString('en-IE', { hour: '2-digit', minute: '2-digit' })}
        </span>
      </div>
    </div>
  );
}

// Email activity feed item
function EmailFeedItem({ email }: { email: AgentEmail }) {
  const statusColors: Record<string, string> = {
    processed: 'bg-emerald-500',
    pending_processing: 'bg-amber-500',
    processing: 'bg-blue-500',
    not_insurance: 'bg-gray-300',
    error: 'bg-red-500',
  };

  return (
    <div className="flex items-start gap-3 py-2.5 border-b border-gray-50 last:border-0">
      <div className={`w-2 h-2 rounded-full mt-1.5 shrink-0 ${statusColors[email.status] || 'bg-gray-300'}`} />
      <div className="min-w-0 flex-1">
        <p className="text-sm text-gray-900 truncate">{email.subject}</p>
        <p className="text-xs text-gray-400">
          {email.fromAddress} · {new Date(email.receivedAt).toLocaleTimeString('en-IE', { hour: '2-digit', minute: '2-digit' })}
          {email._count.actions > 0 && <span className="ml-2 text-blue-600">{email._count.actions} action{email._count.actions > 1 ? 's' : ''}</span>}
        </p>
      </div>
    </div>
  );
}

// Main page
export default function AgentDashboardPage() {
  const [actions, setActions] = useState<AgentAction[]>([]);
  const [emails, setEmails] = useState<AgentEmail[]>([]);
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'pending' | 'activity'>('pending');

  // Fetch pending actions
  const fetchActions = useCallback(async () => {
    try {
      const res = await fetch('/api/agent/actions/pending');
      if (!res.ok) throw new Error('Failed to fetch actions');
      const data = await res.json();
      setActions(data.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    }
  }, []);

  // Fetch emails
  const fetchEmails = useCallback(async () => {
    try {
      const res = await fetch('/api/agent/emails?limit=20');
      if (!res.ok) throw new Error('Failed to fetch emails');
      const data = await res.json();
      setEmails(data.data);
    } catch (err) {
      // Non-critical, don't set error
    }
  }, []);

  useEffect(() => {
    fetchActions();
    fetchEmails();
  }, [fetchActions, fetchEmails]);

  // SSE for real-time updates
  useEffect(() => {
    const source = new EventSource('/api/agent/events');

    source.onmessage = (e) => {
      try {
        const event = JSON.parse(e.data);
        if (event.type === 'action_created' || event.type === 'email_processed') {
          fetchActions();
          fetchEmails();
        }
      } catch {}
    };

    return () => source.close();
  }, [fetchActions, fetchEmails]);

  // Confirm action
  const handleConfirm = async (actionId: string) => {
    setLoading(actionId);
    try {
      const res = await fetch(`/api/agent/actions/${actionId}/confirm`, { method: 'PUT' });
      if (!res.ok) throw new Error('Failed to confirm');
      // Optimistic: remove from list
      setActions(prev => prev.filter(a => a.id !== actionId));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to confirm');
    } finally {
      setLoading(null);
    }
  };

  // Reject action
  const handleReject = async (actionId: string) => {
    const reason = window.prompt('Reason for rejection (optional):');
    if (reason === null) return; // User cancelled

    setLoading(actionId);
    try {
      const res = await fetch(`/api/agent/actions/${actionId}/reject`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason }),
      });
      if (!res.ok) throw new Error('Failed to reject');
      setActions(prev => prev.filter(a => a.id !== actionId));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to reject');
    } finally {
      setLoading(null);
    }
  };

  const pendingCount = actions.length;
  const highConfidenceCount = actions.filter(a => a.confidence >= 0.95).length;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      {/* Main content: Pending actions */}
      <div className="lg:col-span-2 space-y-4">
        {/* Stats bar */}
        <div className="flex items-center gap-6 text-sm">
          <div>
            <span className="font-semibold text-gray-900">{pendingCount}</span>
            <span className="text-gray-500 ml-1">pending</span>
          </div>
          {highConfidenceCount > 0 && (
            <div>
              <span className="font-semibold text-emerald-600">{highConfidenceCount}</span>
              <span className="text-gray-500 ml-1">high confidence</span>
            </div>
          )}
          {highConfidenceCount > 0 && (
            <button
              onClick={async () => {
                setLoading('bulk');
                for (const action of actions.filter(a => a.confidence >= 0.95)) {
                  await fetch(`/api/agent/actions/${action.id}/confirm`, { method: 'PUT' });
                }
                setActions(prev => prev.filter(a => a.confidence < 0.95));
                setLoading(null);
              }}
              disabled={loading === 'bulk'}
              className="text-xs text-gray-500 hover:text-gray-900 underline underline-offset-2"
            >
              Confirm all high confidence
            </button>
          )}
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-2 rounded-lg">
            {error}
            <button onClick={() => setError(null)} className="ml-2 text-red-400 hover:text-red-600">×</button>
          </div>
        )}

        {/* Action list */}
        {actions.length === 0 ? (
          <div className="border border-dashed border-gray-200 rounded-lg p-12 text-center">
            <p className="text-gray-400 text-sm">No pending actions</p>
            <p className="text-gray-300 text-xs mt-1">
              Forward insurer emails to your agent address to get started
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {actions.map(action => (
              <ActionCard
                key={action.id}
                action={action}
                onConfirm={handleConfirm}
                onReject={handleReject}
                loading={loading}
              />
            ))}
          </div>
        )}
      </div>

      {/* Sidebar: Activity feed */}
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <button
            onClick={() => setActiveTab('pending')}
            className={`text-xs font-medium pb-1 border-b-2 ${
              activeTab === 'pending'
                ? 'border-gray-900 text-gray-900'
                : 'border-transparent text-gray-400 hover:text-gray-600'
            }`}
          >
            Pending ({pendingCount})
          </button>
          <button
            onClick={() => setActiveTab('activity')}
            className={`text-xs font-medium pb-1 border-b-2 ${
              activeTab === 'activity'
                ? 'border-gray-900 text-gray-900'
                : 'border-transparent text-gray-400 hover:text-gray-600'
            }`}
          >
            Activity
          </button>
        </div>

        {activeTab === 'activity' && (
          <div className="bg-white border border-gray-200 rounded-lg p-4">
            <h3 className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-3">Recent Emails</h3>
            {emails.length === 0 ? (
              <p className="text-xs text-gray-400">No emails processed yet</p>
            ) : (
              emails.map(email => <EmailFeedItem key={email.id} email={email} />)
            )}
          </div>
        )}
      </div>
    </div>
  );
}
