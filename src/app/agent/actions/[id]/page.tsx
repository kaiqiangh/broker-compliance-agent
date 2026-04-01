'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { canReverseAction } from '@/app/agent/actions/action-detail-utils';

// Types
interface Modification {
  modifiedAt: string;
  modifiedField: string;
  oldValue: string;
  newValue: string;
  reason: string | null;
}

interface ThreadEmail {
  id: string;
  subject: string;
  fromAddress: string;
  receivedAt: string;
  status: string;
  bodyText?: string;
}

interface ActionDetail {
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
  confirmedAt?: string | null;
  executedAt?: string | null;
  isReversed?: boolean;
  rejectedReason?: string | null;
  email: {
    id: string;
    messageId: string;
    subject: string;
    fromAddress: string;
    toAddresses: string[];
    receivedAt: string;
    bodyText?: string;
    threadId?: string;
  };
  modifications: Modification[];
  threadEmails: ThreadEmail[];
}

// Components (reused patterns from dashboard)

function ConfidenceBar({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  const color = pct >= 95 ? 'bg-emerald-500' : pct >= 80 ? 'bg-amber-500' : 'bg-red-500';
  return (
    <div className="flex items-center gap-2">
      <div className="w-24 h-2 bg-gray-100 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color} transition-all duration-300`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-sm tabular-nums text-gray-600">{pct}%</span>
    </div>
  );
}

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

const statusColors: Record<string, string> = {
  pending: 'bg-amber-100 text-amber-800',
  confirmed: 'bg-emerald-100 text-emerald-800',
  executed: 'bg-blue-100 text-blue-800',
  rejected: 'bg-red-100 text-red-800',
  modified: 'bg-blue-100 text-blue-800',
  reversed: 'bg-gray-100 text-gray-600',
};

function ChangeSummary({
  changes,
  editable,
  onEdit,
}: {
  changes: Record<string, { old: any; new: any }>;
  editable?: boolean;
  onEdit?: (field: string, value: any) => void;
}) {
  const entries = Object.entries(changes);
  if (entries.length === 0) return <span className="text-sm text-gray-400">No changes</span>;
  const [editingField, setEditingField] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');

  return (
    <div className="space-y-2">
      {entries.map(([field, { old: oldVal, new: newVal }]) => (
        <div key={field} className="flex items-center gap-3 text-sm py-1.5 border-b border-gray-50 last:border-0">
          <span className="text-gray-500 w-28 shrink-0 font-medium">{field.replace(/_/g, ' ')}</span>
          <span className="text-gray-400 line-through">{String(oldVal ?? '—')}</span>
          <span className="text-gray-300">→</span>
          {editable && editingField === field ? (
            <input
              className="flex-1 px-2 py-1 text-sm border border-blue-300 rounded"
              value={editValue}
              onChange={e => setEditValue(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') {
                  onEdit?.(field, editValue);
                  setEditingField(null);
                }
                if (e.key === 'Escape') setEditingField(null);
              }}
              onBlur={() => setEditingField(null)}
              autoFocus
            />
          ) : (
            <button
              className={`font-medium ${editable ? 'text-blue-600 hover:underline cursor-pointer' : 'text-gray-900'}`}
              onClick={() => {
                if (editable) {
                  setEditingField(field);
                  setEditValue(String(newVal));
                }
              }}
              title={editable ? 'Click to edit' : undefined}
            >
              {String(newVal)}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

function EmailPreview({ bodyText }: { bodyText: string }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div>
      <button
        onClick={() => setExpanded(!expanded)}
        className="text-sm text-blue-600 hover:text-blue-800 flex items-center gap-1"
      >
        <span>{expanded ? '▾' : '▸'}</span>
        {expanded ? 'Hide' : 'Show'} source email
      </button>
      {expanded && (
        <div className="mt-2 p-3 bg-gray-50 rounded-lg text-sm text-gray-600 whitespace-pre-wrap max-h-96 overflow-y-auto border">
          {bodyText.slice(0, 4000)}
          {bodyText.length > 4000 && '\n... (truncated)'}
        </div>
      )}
    </div>
  );
}

// Main page
export default function AgentActionDetailPage() {
  const params = useParams();
  const router = useRouter();
  const actionId = params.id as string;

  const [action, setAction] = useState<ActionDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [modifications, setModifications] = useState<Record<string, any>>({});
  const [rejectReason, setRejectReason] = useState('');
  const [showRejectInput, setShowRejectInput] = useState(false);
  const [expandedThreadEmails, setExpandedThreadEmails] = useState<Set<string>>(new Set());

  const fetchAction = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch(`/api/agent/actions/${actionId}`);
      if (!res.ok) throw new Error('Failed to fetch action');
      const data = await res.json();
      setAction(data.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [actionId]);

  useEffect(() => {
    fetchAction();
  }, [fetchAction]);

  const handleConfirm = async () => {
    try {
      setActionLoading(true);
      const hasModifications = Object.keys(modifications).length > 0;
      const url = hasModifications
        ? `/api/agent/actions/${actionId}/modify`
        : `/api/agent/actions/${actionId}/confirm`;
      const opts = hasModifications
        ? { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ modifications }) }
        : { method: 'PUT' };
      const res = await fetch(url, opts);
      if (!res.ok) throw new Error('Action failed');
      await fetchAction();
      setModifications({});
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Action failed');
    } finally {
      setActionLoading(false);
    }
  };

  const handleReject = async () => {
    try {
      setActionLoading(true);
      const res = await fetch(`/api/agent/actions/${actionId}/reject`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: rejectReason || undefined }),
      });
      if (!res.ok) throw new Error('Reject failed');
      await fetchAction();
      setShowRejectInput(false);
      setRejectReason('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Reject failed');
    } finally {
      setActionLoading(false);
    }
  };

  const handleReverse = async () => {
    try {
      setActionLoading(true);
      const res = await fetch(`/api/agent/actions/${actionId}/reverse`, { method: 'PUT' });
      if (!res.ok) throw new Error('Reverse failed');
      await fetchAction();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Reverse failed');
    } finally {
      setActionLoading(false);
    }
  };

  const handleEdit = (field: string, value: any) => {
    setModifications(prev => ({ ...prev, [field]: value }));
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="text-gray-400">Loading action...</div>
      </div>
    );
  }

  if (error || !action) {
    return (
      <div className="py-10">
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-700">
          {error || 'Action not found'}
        </div>
        <button
          onClick={() => router.push('/agent')}
          className="mt-4 text-sm text-blue-600 hover:text-blue-800"
        >
          ← Back to dashboard
        </button>
      </div>
    );
  }

  const isPending = action.status === 'pending';
  const showReverseAction = canReverseAction(
    action.status,
    Boolean(action.isReversed),
    action.executedAt,
    action.confirmedAt
  );

  return (
    <div>
      {/* Back link */}
      <button
        onClick={() => router.push('/agent')}
        className="text-sm text-gray-500 hover:text-gray-700 mb-4 flex items-center gap-1"
      >
        ← Back to dashboard
      </button>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left column (2/3) */}
        <div className="lg:col-span-2 space-y-6">
          {/* Email details */}
          <div className="bg-white border border-gray-200 rounded-lg p-5">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Email</h2>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-gray-500 uppercase tracking-wide">Subject</label>
                <p className="text-sm font-medium text-gray-900">{action.email.subject}</p>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs text-gray-500 uppercase tracking-wide">From</label>
                  <p className="text-sm text-gray-700">{action.email.fromAddress}</p>
                </div>
                <div>
                  <label className="text-xs text-gray-500 uppercase tracking-wide">Received</label>
                  <p className="text-sm text-gray-700">
                    {new Date(action.email.receivedAt).toLocaleString('en-IE')}
                  </p>
                </div>
              </div>
              {action.email.toAddresses && action.email.toAddresses.length > 0 && (
                <div>
                  <label className="text-xs text-gray-500 uppercase tracking-wide">To</label>
                  <p className="text-sm text-gray-700">{action.email.toAddresses.join(', ')}</p>
                </div>
              )}
              {action.email.bodyText && <EmailPreview bodyText={action.email.bodyText} />}
            </div>
          </div>

          {/* Extracted data / Changes */}
          <div className="bg-white border border-gray-200 rounded-lg p-5">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Extracted Data Changes</h2>
            <ChangeSummary
              changes={action.changes}
              editable={isPending}
              onEdit={handleEdit}
            />
            {Object.keys(modifications).length > 0 && (
              <p className="text-sm text-blue-600 mt-3">
                {Object.keys(modifications).length} field(s) modified — Confirm will save changes
              </p>
            )}
          </div>

          {/* Action controls */}
          {isPending && (
            <div className="bg-white border border-gray-200 rounded-lg p-5">
              <h2 className="text-lg font-semibold text-gray-900 mb-4">Actions</h2>
              <div className="flex items-center gap-3">
                <button
                  onClick={handleConfirm}
                  disabled={actionLoading}
                  className="px-4 py-2 text-sm font-medium bg-gray-900 text-white rounded-md hover:bg-gray-800 disabled:opacity-50 transition-colors"
                >
                  {actionLoading ? 'Processing...' : Object.keys(modifications).length > 0 ? 'Confirm with modifications' : 'Confirm'}
                </button>
                <button
                  onClick={() => setShowRejectInput(!showRejectInput)}
                  disabled={actionLoading}
                  className="px-4 py-2 text-sm font-medium text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-md disabled:opacity-50 transition-colors border border-gray-200"
                >
                  Reject
                </button>
              </div>
              {showRejectInput && (
                <div className="mt-3 flex gap-2">
                  <input
                    type="text"
                    placeholder="Reason for rejection (optional)"
                    value={rejectReason}
                    onChange={e => setRejectReason(e.target.value)}
                    className="flex-1 px-3 py-2 text-sm border border-gray-200 rounded-md focus:outline-none focus:ring-1 focus:ring-gray-300"
                  />
                  <button
                    onClick={handleReject}
                    disabled={actionLoading}
                    className="px-4 py-2 text-sm font-medium bg-red-600 text-white rounded-md hover:bg-red-700 disabled:opacity-50"
                  >
                    Confirm reject
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Reverse action */}
          {showReverseAction && (
            <div className="bg-white border border-gray-200 rounded-lg p-5">
              <h2 className="text-lg font-semibold text-gray-900 mb-2">Reverse Action</h2>
              <p className="text-sm text-gray-500 mb-3">This will undo the executed changes if you are still within the 24-hour window.</p>
              <button
                onClick={handleReverse}
                disabled={actionLoading}
                className="px-4 py-2 text-sm font-medium text-red-600 hover:text-red-800 hover:bg-red-50 rounded-md disabled:opacity-50 transition-colors border border-red-200"
              >
                {actionLoading ? 'Processing...' : 'Reverse'}
              </button>
            </div>
          )}

          {/* Rejected reason */}
          {action.status === 'rejected' && action.rejectedReason && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-5">
              <h2 className="text-sm font-semibold text-red-800 mb-1">Rejection Reason</h2>
              <p className="text-sm text-red-700">{action.rejectedReason}</p>
            </div>
          )}
        </div>

        {/* Right column (1/3) */}
        <div className="space-y-6">
          {/* Action metadata */}
          <div className="bg-white border border-gray-200 rounded-lg p-5 space-y-4">
            <h2 className="text-lg font-semibold text-gray-900">Details</h2>

            <div>
              <label className="text-xs text-gray-500 uppercase tracking-wide">Type</label>
              <div className="mt-1">
                <span className={`text-sm px-2.5 py-1 rounded-full border font-medium ${actionColor(action.actionType)}`}>
                  {actionLabel(action.actionType)}
                </span>
              </div>
            </div>

            <div>
              <label className="text-xs text-gray-500 uppercase tracking-wide">Status</label>
              <div className="mt-1">
                <span className={`text-sm px-2.5 py-1 rounded-full font-medium ${statusColors[action.status] || 'bg-gray-100 text-gray-600'}`}>
                  {action.status}
                  {action.isReversed && ' (reversed)'}
                </span>
              </div>
            </div>

            <div>
              <label className="text-xs text-gray-500 uppercase tracking-wide">Confidence</label>
              <div className="mt-1">
                <ConfidenceBar value={action.confidence} />
              </div>
            </div>

            {action.matchConfidence != null && (
              <div>
                <label className="text-xs text-gray-500 uppercase tracking-wide">Match Confidence</label>
                <div className="mt-1">
                  <ConfidenceBar value={action.matchConfidence} />
                </div>
              </div>
            )}

            {action.entityType && (
              <div>
                <label className="text-xs text-gray-500 uppercase tracking-wide">Entity</label>
                <p className="text-sm text-gray-700 mt-1">
                  {action.entityType}
                  {action.entityId && <span className="text-gray-400 ml-1">#{action.entityId}</span>}
                </p>
              </div>
            )}

            <div>
              <label className="text-xs text-gray-500 uppercase tracking-wide">Created</label>
              <p className="text-sm text-gray-700 mt-1">
                {new Date(action.createdAt).toLocaleString('en-IE')}
              </p>
            </div>

            {action.reasoning && (
              <div>
                <label className="text-xs text-gray-500 uppercase tracking-wide">Reasoning</label>
                <p className="text-sm text-gray-600 mt-1 italic">{action.reasoning}</p>
              </div>
            )}
          </div>

          {/* Audit trail / Modifications */}
          {action.modifications && action.modifications.length > 0 && (
            <div className="bg-white border border-gray-200 rounded-lg p-5">
              <h2 className="text-lg font-semibold text-gray-900 mb-4">Audit Trail</h2>
              <div className="space-y-3">
                {action.modifications.map((mod, i) => (
                  <div key={i} className="relative pl-4 border-l-2 border-gray-200">
                    <div className="absolute -left-[5px] top-1 w-2 h-2 rounded-full bg-gray-400" />
                    <p className="text-xs text-gray-400">
                      {new Date(mod.modifiedAt).toLocaleString('en-IE')}
                    </p>
                    <p className="text-sm text-gray-700 font-medium">{mod.modifiedField.replace(/_/g, ' ')}</p>
                    <p className="text-xs text-gray-500">
                      <span className="line-through">{mod.oldValue}</span> → <span className="font-medium">{mod.newValue}</span>
                    </p>
                    {mod.reason && <p className="text-xs text-gray-400 italic mt-0.5">{mod.reason}</p>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Thread emails */}
          {action.threadEmails && action.threadEmails.length > 0 && (
            <div className="bg-white border border-gray-200 rounded-lg p-5">
              <h2 className="text-lg font-semibold text-gray-900 mb-4">Thread ({action.threadEmails.length})</h2>
              <div className="space-y-2">
                {action.threadEmails.map(email => {
                  const isCurrent = email.id === action.email.id;
                  const isExpanded = expandedThreadEmails.has(email.id);
                  return (
                    <div
                      key={email.id}
                      className={`rounded text-sm border ${isCurrent ? 'bg-blue-50 border-blue-200' : 'border-gray-100 hover:border-gray-200'}`}
                    >
                      <button
                        className="w-full text-left p-2.5 flex items-start gap-2"
                        onClick={() => {
                          setExpandedThreadEmails(prev => {
                            const next = new Set(prev);
                            if (next.has(email.id)) next.delete(email.id);
                            else next.add(email.id);
                            return next;
                          });
                        }}
                      >
                        <span className="text-gray-400 mt-0.5 shrink-0">{isExpanded ? '▾' : '▸'}</span>
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-gray-900 truncate">
                            {isCurrent && <span className="text-blue-600 mr-1">●</span>}
                            {email.subject}
                          </p>
                          <p className="text-xs text-gray-400">
                            {email.fromAddress} · {new Date(email.receivedAt).toLocaleString('en-IE', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                          </p>
                        </div>
                        <span className={`text-xs px-1.5 py-0.5 rounded shrink-0 ${email.status === 'processed' ? 'bg-emerald-50 text-emerald-700' : 'bg-gray-50 text-gray-500'}`}>
                          {email.status}
                        </span>
                      </button>
                      {isExpanded && email.bodyText && (
                        <div className="px-3 pb-2.5 border-t border-gray-100 pt-2">
                          <p className="text-xs text-gray-600 whitespace-pre-wrap max-h-48 overflow-y-auto">
                            {email.bodyText.slice(0, 2000)}
                          </p>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
