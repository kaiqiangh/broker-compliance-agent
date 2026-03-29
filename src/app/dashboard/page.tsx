'use client';

import { useEffect, useState } from 'react';

interface DashboardStats {
  totalRenewals: number;
  byStatus: {
    pending: number;
    in_progress: number;
    at_risk: number;
    compliant: number;
    overdue: number;
  };
  complianceRate: number;
  compliancePeriod?: string;
  upcomingDeadlines: Array<{
    id: string;
    clientName: string;
    policyNumber: string;
    policyType: string;
    daysUntilDue: number;
    status: string;
  }>;
  overdueItems: Array<{
    id: string;
    clientName: string;
    policyNumber: string;
    daysUntilDue: number;
  }>;
}

interface AuditEvent {
  id: string;
  timestamp: string;
  action: string;
  entityType: string;
  entityId?: string;
  actorId?: string;
  metadata?: Record<string, unknown>;
}

function relativeTime(timestamp: string): string {
  const now = Date.now();
  const then = new Date(timestamp).getTime();
  const diffSec = Math.floor((now - then) / 1000);
  if (diffSec < 60) return 'just now';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 7) return `${diffDay}d ago`;
  return new Date(timestamp).toLocaleDateString('en-IE');
}

function formatAction(action: string): string {
  return action.replace(/\./g, ' ').replace(/_/g, ' ');
}

const STATUS_META: Record<string, { label: string; color: string; bg: string }> = {
  pending:      { label: 'Pending',      color: '#6b7280', bg: 'bg-gray-100 text-gray-800' },
  in_progress:  { label: 'In Progress',  color: '#3b82f6', bg: 'bg-blue-100 text-blue-800' },
  at_risk:      { label: 'At Risk',      color: '#f97316', bg: 'bg-orange-100 text-orange-800' },
  compliant:    { label: 'Compliant',    color: '#22c55e', bg: 'bg-green-100 text-green-800' },
  overdue:      { label: 'Overdue',      color: '#ef4444', bg: 'bg-red-100 text-red-800' },
};

const STATUS_ORDER = ['pending', 'in_progress', 'at_risk', 'compliant', 'overdue'] as const;

export default function DashboardPage() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [auditEvents, setAuditEvents] = useState<AuditEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    async function loadDashboard() {
      try {
        const [dashRes, auditRes] = await Promise.all([
          fetch('/api/dashboard'),
          fetch('/api/audit?limit=10'),
        ]);

        if (!dashRes.ok) {
          if (dashRes.status === 401) {
            window.location.href = '/login';
            return;
          }
          throw new Error('Failed to load dashboard');
        }

        const dashData = await dashRes.json();
        setStats(dashData.data);

        if (auditRes.ok) {
          const auditData = await auditRes.json();
          setAuditEvents(auditData.data || []);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error');
      } finally {
        setLoading(false);
      }
    }
    loadDashboard();
  }, []);

  if (loading) {
    return (
      <div className="p-8 flex items-center justify-center h-64">
        <div className="text-gray-500">Loading dashboard...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-8">
        <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-red-700">
          {error}
        </div>
      </div>
    );
  }

  if (!stats) return null;

  // --- Conic-gradient ring chart data ---
  const total = stats.totalRenewals || 1; // avoid division by zero
  const segments: Array<{ status: string; pct: number }> = [];
  let cumulative = 0;
  for (const s of STATUS_ORDER) {
    const count = stats.byStatus[s];
    if (count > 0) {
      const pct = (count / total) * 100;
      segments.push({ status: s, pct });
      cumulative += pct;
    }
  }

  // Build conic-gradient stops
  let gradientStops: string[] = [];
  let acc = 0;
  for (const seg of segments) {
    const start = acc;
    acc += seg.pct;
    gradientStops.push(`${STATUS_META[seg.status].color} ${start}% ${acc}%`);
  }
  const conicGradient = segments.length > 0
    ? `conic-gradient(${gradientStops.join(', ')})`
    : 'conic-gradient(#e5e7eb 0% 100%)';

  return (
    <div className="p-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
        <p className="text-gray-500 mt-1">CPC Renewal Compliance Overview</p>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <p className="text-sm font-medium text-gray-500">Total Renewals</p>
          <p className="text-3xl font-bold text-gray-900 mt-2">{stats.totalRenewals}</p>
          <p className="text-sm text-gray-500 mt-1">Next 90 days</p>
        </div>
        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <p className="text-sm font-medium text-gray-500">
            Compliance Rate
            {stats.compliancePeriod === 'quarter' && (
              <span className="ml-1 text-xs text-blue-500">(Q{Math.floor(new Date().getMonth() / 3) + 1})</span>
            )}
          </p>
          <p className="text-3xl font-bold text-green-600 mt-2">{stats.complianceRate}%</p>
          <div className="mt-2 h-2 bg-gray-200 rounded-full">
            <div
              className="h-2 bg-green-500 rounded-full transition-all"
              style={{ width: `${stats.complianceRate}%` }}
            />
          </div>
        </div>
        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <p className="text-sm font-medium text-gray-500">At Risk</p>
          <p className="text-3xl font-bold text-orange-600 mt-2">{stats.byStatus.at_risk}</p>
          <p className="text-sm text-gray-500 mt-1">&lt; 7 days, incomplete</p>
        </div>
        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <p className="text-sm font-medium text-gray-500">Overdue</p>
          <p className="text-3xl font-bold text-red-600 mt-2">{stats.byStatus.overdue}</p>
          <p className="text-sm text-gray-500 mt-1">Needs immediate action</p>
        </div>
      </div>

      {/* Status Breakdown — Ring Chart + Legend */}
      <div className="bg-white rounded-lg border border-gray-200 p-6 mb-8">
        <h2 className="text-lg font-semibold mb-4">Status Distribution</h2>
        <div className="flex flex-col md:flex-row items-center gap-8">
          {/* Pure CSS donut chart */}
          <div className="relative w-48 h-48 flex-shrink-0">
            <div
              className="w-full h-full rounded-full"
              style={{ background: conicGradient }}
            />
            {/* Inner circle for donut effect */}
            <div className="absolute inset-6 bg-white rounded-full flex items-center justify-center flex-col">
              <span className="text-2xl font-bold">{stats.totalRenewals}</span>
              <span className="text-xs text-gray-500">Total</span>
            </div>
          </div>

          {/* Legend with horizontal stacked bar */}
          <div className="flex-1 w-full space-y-3">
            {/* Stacked bar */}
            <div className="flex h-4 rounded-full overflow-hidden">
              {segments.map(seg => (
                <div
                  key={seg.status}
                  style={{
                    width: `${seg.pct}%`,
                    backgroundColor: STATUS_META[seg.status].color,
                  }}
                  title={`${STATUS_META[seg.status].label}: ${stats.byStatus[seg.status as keyof typeof stats.byStatus]}`}
                />
              ))}
              {segments.length === 0 && (
                <div className="w-full bg-gray-200" />
              )}
            </div>

            {/* Legend items */}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {STATUS_ORDER.map(s => {
                const count = stats.byStatus[s];
                const pct = total > 0 ? Math.round((count / stats.totalRenewals) * 100) : 0;
                return (
                  <div key={s} className="flex items-center gap-2">
                    <span
                      className="w-3 h-3 rounded-full flex-shrink-0"
                      style={{ backgroundColor: STATUS_META[s].color }}
                    />
                    <span className="text-sm text-gray-700">
                      {STATUS_META[s].label}
                      <span className="ml-1 text-gray-400">
                        {count} ({pct}%)
                      </span>
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* Upcoming Deadlines */}
      <div className="bg-white rounded-lg border border-gray-200">
        <div className="px-6 py-4 border-b border-gray-200">
          <h2 className="text-lg font-semibold">Upcoming Deadlines</h2>
        </div>
        <div className="divide-y divide-gray-200">
          {stats.upcomingDeadlines.length === 0 ? (
            <div className="px-6 py-8 text-center text-gray-500">
              No upcoming deadlines in the next 30 days
            </div>
          ) : (
            stats.upcomingDeadlines.map((item) => (
              <div key={item.id} className="px-6 py-4 flex items-center justify-between">
                <div>
                  <p className="font-medium text-gray-900">{item.clientName}</p>
                  <p className="text-sm text-gray-500">{item.policyNumber} · {item.policyType}</p>
                </div>
                <div className="flex items-center gap-4">
                  <span className={`px-2.5 py-0.5 rounded-full text-xs font-medium ${STATUS_META[item.status]?.bg ?? 'bg-gray-100 text-gray-800'}`}>
                    {item.status.replace('_', ' ')}
                  </span>
                  <span className="text-sm text-gray-500">
                    {item.daysUntilDue < 0
                      ? `${Math.abs(item.daysUntilDue)} days overdue`
                      : `${item.daysUntilDue} days`}
                  </span>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Quick Actions */}
      <div className="mt-8 flex gap-4">
        <a
          href="/import"
          className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700"
        >
          Import CSV
        </a>
        <a
          href="/renewals"
          className="px-4 py-2 bg-white border border-gray-300 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-50"
        >
          View All Renewals
        </a>
      </div>

      {/* Activity Feed */}
      <div className="mt-8 bg-white rounded-lg border border-gray-200">
        <div className="px-6 py-4 border-b border-gray-200">
          <h2 className="text-lg font-semibold">Recent Activity</h2>
        </div>
        <div className="divide-y divide-gray-200">
          {auditEvents.length === 0 ? (
            <div className="px-6 py-8 text-center text-gray-500">
              No recent activity
            </div>
          ) : (
            auditEvents.map((event) => (
              <div key={event.id} className="px-6 py-3 flex items-center gap-4">
                <span className="text-xs text-gray-400 w-20 flex-shrink-0">
                  {relativeTime(event.timestamp)}
                </span>
                <div className="flex-1 min-w-0">
                  <span className="text-sm font-medium text-gray-900 capitalize">
                    {formatAction(event.action)}
                  </span>
                  <span className="text-sm text-gray-500 ml-2">
                    {event.entityType}
                    {event.actorId && ` by ${event.actorId}`}
                  </span>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
