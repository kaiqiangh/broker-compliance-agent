'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { apiFetch } from '@/lib/api-client';

interface ChecklistItem {
  id: string;
  itemType: string;
  status: string;
  completedBy: string | null;
  completedAt: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
  rejectionReason: string | null;
  evidenceUrl: string | null;
  notes: string | null;
}

interface ChecklistData {
  items: ChecklistItem[];
  completedCount: number;
  totalCount: number;
  completionRate: number;
  dueDate?: string;
  clientName?: string;
  policyNumber?: string;
}

const ITEM_LABELS: Record<string, string> = {
  renewal_notification: 'Renewal notification sent',
  suitability_assessment: 'Suitability assessment completed',
  market_comparison: 'Market comparison documented',
  premium_disclosure: 'Premium disclosure (new + old)',
  commission_disclosure: 'Commission disclosure',
  client_communication: 'Client communication recorded',
  policy_terms_review: 'Policy terms changes noted',
  final_sign_off: 'Final sign-off',
};

const STATUS_COLORS: Record<string, string> = {
  pending: 'bg-gray-100 text-gray-600',
  in_progress: 'bg-blue-100 text-blue-700',
  completed: 'bg-yellow-100 text-yellow-700',
  pending_review: 'bg-purple-100 text-purple-700',
  approved: 'bg-green-100 text-green-700',
  rejected: 'bg-red-100 text-red-700',
};

/**
 * 40-day countdown bar from expiry date.
 * Colors: >20 days = green, 7-20 = yellow, <7 = red, overdue = dark red.
 */
function CountdownBar({ dueDate }: { dueDate: string }) {
  const now = new Date();
  const expiry = new Date(dueDate);
  const daysRemaining = Math.ceil((expiry.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
  const totalWindow = 40;

  // Progress: 0% = 40 days remaining, 100% = expiry date
  const elapsed = totalWindow - daysRemaining;
  const progressPct = Math.min(100, Math.max(0, (elapsed / totalWindow) * 100));

  let barColor: string;
  let textColor: string;
  if (daysRemaining <= 0) {
    barColor = 'bg-red-900';
    textColor = 'text-red-900';
  } else if (daysRemaining < 7) {
    barColor = 'bg-red-500';
    textColor = 'text-red-600';
  } else if (daysRemaining <= 20) {
    barColor = 'bg-yellow-500';
    textColor = 'text-yellow-600';
  } else {
    barColor = 'bg-green-500';
    textColor = 'text-green-600';
  }

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-6 mb-6">
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-sm font-medium text-gray-500">40-Day Renewal Countdown</h2>
        <span className={`text-sm font-semibold ${textColor}`}>
          {daysRemaining <= 0
            ? `${Math.abs(daysRemaining)} days overdue`
            : `${daysRemaining} days remaining`}
        </span>
      </div>
      <div className="h-3 bg-gray-200 rounded-full overflow-hidden">
        <div
          className={`h-full ${barColor} rounded-full transition-all`}
          style={{ width: `${progressPct}%` }}
        />
      </div>
      <div className="flex justify-between mt-1 text-xs text-gray-400">
        <span>40 days before</span>
        <span>Expiry: {new Date(dueDate).toLocaleDateString('en-IE')}</span>
      </div>
    </div>
  );
}

export default function ChecklistPage() {
  const params = useParams();
  const renewalId = params.id as string;
  const [checklist, setChecklist] = useState<ChecklistData | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [rejectReason, setRejectReason] = useState<Record<string, string>>({});
  const [generatingPdf, setGeneratingPdf] = useState<string | null>(null);
  const [uploadingId, setUploadingId] = useState<string | null>(null);

  async function loadChecklist() {
    try {
      const res = await apiFetch(`/api/renewals/${renewalId}/checklist`);
      if (!res.ok) throw new Error('Failed to load');
      const data = await res.json();
      setChecklist(data.data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadChecklist(); }, [renewalId]);

  async function handleAction(itemId: string, action: string, extra?: Record<string, unknown>) {
    setActionLoading(itemId);
    try {
      const res = await apiFetch(`/api/checklist/${itemId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, ...extra }),
      });
      if (!res.ok) {
        const data = await res.json();
        alert(data.error || 'Action failed');
        return;
      }
      await loadChecklist();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Action failed');
    } finally {
      setActionLoading(null);
    }
  }

  async function handleUploadEvidence(itemId: string, file: File) {
    setUploadingId(itemId);
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('checklistItemId', itemId);

      const uploadRes = await apiFetch('/api/upload', {
        method: 'POST',
        body: formData,
      });

      if (!uploadRes.ok) {
        const data = await uploadRes.json();
        alert(data.error?.message || 'Upload failed');
        return;
      }

      const uploadData = await uploadRes.json();

      // Auto-complete the checklist item with evidence
      await handleAction(itemId, 'complete', {
        evidenceUrl: uploadData.data.fileUrl,
        notes: `Evidence uploaded: ${uploadData.data.fileName}`,
      });
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploadingId(null);
    }
  }

  if (loading) return <div className="p-8 text-gray-500">Loading checklist...</div>;
  if (!checklist) return <div className="p-8 text-red-500">Failed to load checklist</div>;

  return (
    <div className="p-8">
      <div className="mb-8">
        <a href="/renewals" className="text-sm text-blue-600 hover:underline">← Back to renewals</a>
        <h1 className="text-2xl font-bold text-gray-900 mt-2">Renewal Checklist</h1>
        <p className="text-gray-500">{checklist.completedCount}/{checklist.totalCount} items complete</p>
        <div className="mt-2 h-2 bg-gray-200 rounded-full max-w-md">
          <div
            className="h-2 bg-green-500 rounded-full transition-all"
            style={{ width: `${checklist.completionRate}%` }}
          />
        </div>
      </div>

      {/* 40-Day Countdown Bar */}
      {checklist.dueDate && <CountdownBar dueDate={checklist.dueDate} />}

      <div className="space-y-4">
        {checklist.items.map(item => {
          const label = ITEM_LABELS[item.itemType] || item.itemType;
          const statusColor = STATUS_COLORS[item.status] || STATUS_COLORS.pending;
          const isLoading = actionLoading === item.id;

          return (
            <div key={item.id} className="bg-white rounded-lg border border-gray-200 p-6">
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-3 mb-2">
                    <h3 className="font-medium text-gray-900">{label}</h3>
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusColor}`}>
                      {item.status.replace('_', ' ')}
                    </span>
                  </div>

                  {item.completedAt && (
                    <p className="text-sm text-gray-500">
                      Completed {new Date(item.completedAt).toLocaleDateString('en-IE')}
                      {item.completedBy && ` by ${item.completedBy}`}
                    </p>
                  )}

                  {item.rejectionReason && (
                    <div className="mt-2 p-3 bg-red-50 rounded text-sm text-red-700">
                      Rejected: {item.rejectionReason}
                    </div>
                  )}

                  {item.notes && (
                    <p className="text-sm text-gray-600 mt-1">{item.notes}</p>
                  )}
                </div>

                {/* Action buttons based on status */}
                <div className="flex gap-2 ml-4">
                  {item.status === 'pending' && (
                    <button
                      onClick={() => handleAction(item.id, 'complete', { notes: notes[item.id] })}
                      disabled={isLoading}
                      className="px-3 py-1.5 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 disabled:opacity-50"
                    >
                      {isLoading ? '...' : 'Complete'}
                    </button>
                  )}

                  {item.status === 'pending_review' && (
                    <>
                      <button
                        onClick={() => handleAction(item.id, 'approve', { comment: notes[item.id] })}
                        disabled={isLoading}
                        className="px-3 py-1.5 bg-green-600 text-white text-sm rounded hover:bg-green-700 disabled:opacity-50"
                      >
                        Approve
                      </button>
                      <button
                        onClick={() => {
                          const reason = rejectReason[item.id] || prompt('Reason for rejection:');
                          if (reason) handleAction(item.id, 'reject', { reason });
                        }}
                        disabled={isLoading}
                        className="px-3 py-1.5 bg-red-600 text-white text-sm rounded hover:bg-red-700 disabled:opacity-50"
                      >
                        Reject
                      </button>
                    </>
                  )}

                  {item.status === 'rejected' && (
                    <button
                      onClick={() => handleAction(item.id, 'complete', { notes: notes[item.id] })}
                      disabled={isLoading}
                      className="px-3 py-1.5 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 disabled:opacity-50"
                    >
                      Retry
                    </button>
                  )}

                  {item.status === 'approved' && (
                    <span className="text-green-600 text-sm">✓ Done</span>
                  )}
                </div>
              </div>

              {/* Notes input for pending items */}
              {(item.status === 'pending' || item.status === 'rejected') && (
                <div className="mt-3">
                  <textarea
                    placeholder="Add notes (optional)..."
                    value={notes[item.id] || ''}
                    onChange={e => setNotes(prev => ({ ...prev, [item.id]: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-200 rounded text-sm resize-none"
                    rows={2}
                  />
                </div>
              )}

              {/* Evidence display & upload */}
              <div className="mt-3 flex items-center gap-3">
                {item.evidenceUrl && (
                  <a
                    href={item.evidenceUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm text-blue-600 hover:underline flex items-center gap-1"
                  >
                    📎 View evidence
                  </a>
                )}
                {(item.status === 'pending' || item.status === 'rejected') && (
                  <label className="px-3 py-1.5 bg-gray-100 text-gray-700 text-sm rounded hover:bg-gray-200 cursor-pointer disabled:opacity-50">
                    {uploadingId === item.id ? '⏳ Uploading...' : '📤 Upload Evidence'}
                    <input
                      type="file"
                      accept=".pdf,.png,.jpg,.jpeg,.eml"
                      className="hidden"
                      disabled={uploadingId !== null}
                      onChange={e => {
                        const file = e.target.files?.[0];
                        if (file) handleUploadEvidence(item.id, file);
                      }}
                    />
                  </label>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Document Generation */}
      <div className="mt-8 bg-white rounded-lg border border-gray-200 p-6">
        <h2 className="text-lg font-semibold mb-4">Generate Documents</h2>
        <p className="text-sm text-gray-500 mb-4">
          Generate CPC-compliant documents for this renewal.
        </p>
        <div className="flex gap-3">
          <button
            onClick={async () => {
              try {
                const res = await apiFetch('/api/documents', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ renewalId, documentType: 'renewal_notification' }),
                });
                if (!res.ok) throw new Error('Generation failed');
                const data = await res.json();
                const win = window.open('', '_blank');
                if (win) {
                  win.document.write(data.data.html);
                  win.document.close();
                }
              } catch (err) {
                alert(err instanceof Error ? err.message : 'Generation failed');
              }
            }}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700"
          >
            📄 Renewal Notification Letter
          </button>
          <button
            onClick={async () => {
              try {
                const res = await apiFetch('/api/documents', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ renewalId, documentType: 'suitability_assessment' }),
                });
                if (!res.ok) throw new Error('Generation failed');
                const data = await res.json();
                const win = window.open('', '_blank');
                if (win) {
                  win.document.write(data.data.html);
                  win.document.close();
                }
              } catch (err) {
                alert(err instanceof Error ? err.message : 'Generation failed');
              }
            }}
            className="px-4 py-2 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700"
          >
            📋 Suitability Assessment
          </button>
          <button
            onClick={async () => {
              setGeneratingPdf('inspection_pack');
              try {
                const res = await apiFetch('/api/documents', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ renewalId, documentType: 'inspection_pack' }),
                });
                if (!res.ok) throw new Error('Pack generation failed');
                const blob = await res.blob();
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `CBI-Pack-${renewalId.slice(0, 8)}.zip`;
                a.click();
                URL.revokeObjectURL(url);
              } catch (err) {
                alert(err instanceof Error ? err.message : 'Pack generation failed');
              } finally {
                setGeneratingPdf(null);
              }
            }}
            disabled={generatingPdf !== null}
            className="px-4 py-2 bg-red-600 text-white rounded-lg text-sm font-medium hover:bg-red-700 disabled:opacity-50"
          >
            {generatingPdf === 'inspection_pack' ? '⏳ Building pack...' : '📦 CBI Inspection Pack'}
          </button>
          <button
            onClick={() => window.print()}
            className="px-4 py-2 bg-white border border-gray-300 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-50"
          >
            🖨️ Print
          </button>
          <button
            onClick={async () => {
              setGeneratingPdf('renewal_notification');
              try {
                const res = await apiFetch('/api/documents', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ renewalId, documentType: 'renewal_notification', format: 'pdf' }),
                });
                if (!res.ok) throw new Error('PDF generation failed');
                const blob = await res.blob();
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `renewal-notification-${renewalId.slice(0, 8)}.pdf`;
                a.click();
                URL.revokeObjectURL(url);
              } catch (err) {
                alert(err instanceof Error ? err.message : 'PDF generation failed');
              } finally {
                setGeneratingPdf(null);
              }
            }}
            disabled={generatingPdf !== null}
            className="px-4 py-2 bg-purple-600 text-white rounded-lg text-sm font-medium hover:bg-purple-700 disabled:opacity-50"
          >
            {generatingPdf === 'renewal_notification' ? '⏳ Generating...' : '📥 Download PDF'}
          </button>
        </div>
      </div>
    </div>
  );
}
