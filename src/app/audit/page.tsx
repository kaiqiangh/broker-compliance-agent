'use client';

import { useEffect, useState } from 'react';

interface AuditEvent {
  id: string;
  timestamp: string;
  actorId: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  metadata: Record<string, unknown>;
}

export default function AuditPage() {
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionFilter, setActionFilter] = useState('');
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const pageSize = 50;

  const [totalPages, setTotalPages] = useState(1);

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const params = new URLSearchParams({ page: String(page + 1), pageSize: String(pageSize) });
        if (actionFilter) params.set('action', actionFilter);

        const res = await fetch(`/api/audit?${params}`);
        if (!res.ok) { if (res.status === 401) window.location.href = '/login'; return; }
        const data = await res.json();
        setEvents(data.data);
        setTotal(data.meta.total);
        setTotalPages(data.meta.totalPages);
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [actionFilter, page]);

  function handleExport() {
    const params = new URLSearchParams({ format: 'csv' });
    if (actionFilter) params.set('action', actionFilter);
    window.open(`/api/audit?${params}`, '_blank');
  }

  const actionLabels: Record<string, string> = {
    'policy.import': '📥 Import',
    'checklist.item_completed': '✅ Completed',
    'checklist.item_approved': '👍 Approved',
    'checklist.item_rejected': '👎 Rejected',
    'notification.scheduled': '🔔 Notification',
    'document.generated': '📄 Document',
    'user.invited': '👤 User invited',
    'firm.created': '🏢 Firm created',
    'gdpr.erasure_completed': '🔒 GDPR erasure',
    'evidence.uploaded': '📎 Evidence uploaded',
  };

  return (
    <div className="p-8">
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Audit Trail</h1>
          <p className="text-gray-500 mt-1">{total} events — CBI inspection ready</p>
        </div>
        <div className="flex gap-3">
          <select
            value={actionFilter}
            onChange={e => setActionFilter(e.target.value)}
            className="px-3 py-2 border border-gray-300 rounded-lg text-sm"
          >
            <option value="">All actions</option>
            <option value="policy.import">Imports</option>
            <option value="checklist.item_completed">Completions</option>
            <option value="checklist.item_approved">Approvals</option>
            <option value="checklist.item_rejected">Rejections</option>
            <option value="document.generated">Documents</option>
          </select>
          <button
            onClick={handleExport}
            className="px-4 py-2 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700"
          >
            Export CSV
          </button>
        </div>
      </div>

      {loading ? (
        <div className="text-center text-gray-500 py-12">Loading audit trail...</div>
      ) : events.length === 0 ? (
        <div className="text-center text-gray-500 py-12">No events found</div>
      ) : (
        <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
          <table className="min-w-full">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50">
                <th className="text-left py-3 px-4 text-sm font-medium text-gray-500">Timestamp</th>
                <th className="text-left py-3 px-4 text-sm font-medium text-gray-500">Action</th>
                <th className="text-left py-3 px-4 text-sm font-medium text-gray-500">Entity</th>
                <th className="text-left py-3 px-4 text-sm font-medium text-gray-500">Details</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {events.map(event => (
                <tr key={event.id} className="hover:bg-gray-50">
                  <td className="py-3 px-4 text-sm text-gray-600">
                    {new Date(event.timestamp).toLocaleString('en-IE')}
                  </td>
                  <td className="py-3 px-4 text-sm">
                    {actionLabels[event.action] || event.action}
                  </td>
                  <td className="py-3 px-4 text-sm text-gray-600">
                    {event.entityType}
                  </td>
                  <td className="py-3 px-4 text-xs text-gray-500 max-w-xs truncate">
                    {JSON.stringify(event.metadata)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination */}
      {total > pageSize && (
        <div className="mt-4 flex items-center justify-between">
          <p className="text-sm text-gray-500">
            Showing {page * pageSize + 1}–{Math.min((page + 1) * pageSize, total)} of {total}
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => setPage(p => Math.max(0, p - 1))}
              disabled={page === 0}
              className="px-3 py-1.5 border border-gray-300 rounded text-sm disabled:opacity-50"
            >
              Previous
            </button>
            {Array.from({ length: Math.min(totalPages, 7) }, (_, i) => {
              let pageNum: number;
              if (totalPages <= 7) {
                pageNum = i;
              } else if (page < 3) {
                pageNum = i;
              } else if (page > totalPages - 4) {
                pageNum = totalPages - 7 + i;
              } else {
                pageNum = page - 3 + i;
              }
              return (
                <button
                  key={pageNum}
                  onClick={() => setPage(pageNum)}
                  className={`px-3 py-1.5 border rounded text-sm ${
                    page === pageNum ? 'bg-blue-600 text-white border-blue-600' : 'border-gray-300 hover:bg-gray-50'
                  }`}
                >
                  {pageNum + 1}
                </button>
              );
            })}
            <button
              onClick={() => setPage(p => p + 1)}
              disabled={page + 1 >= totalPages}
              className="px-3 py-1.5 border border-gray-300 rounded text-sm disabled:opacity-50"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
