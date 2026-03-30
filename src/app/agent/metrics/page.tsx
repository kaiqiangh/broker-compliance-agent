'use client';

import { useState, useEffect, useCallback } from 'react';

interface MetricsSummary {
  totalEmails: number;
  totalActions: number;
  pendingActions: number;
  confirmedActions: number;
  modifiedActions: number;
  rejectedActions: number;
  autoExecutedActions: number;
  accuracyRate: number;
  timeSavedMinutes: number;
  timeSavedHours: number;
}

interface DailyMetric {
  date: string;
  emailsReceived: number;
  emailsProcessed: number;
  actionsCreated: number;
  actionsConfirmed: number;
  actionsModified: number;
  actionsRejected: number;
  avgConfidence: number | null;
}

function StatCard({ label, value, suffix }: { label: string; value: string | number; suffix?: string }) {
  return (
    <div className="border border-gray-200 rounded-lg p-4">
      <p className="text-xs text-gray-500 mb-1">{label}</p>
      <p className="text-2xl font-semibold text-gray-900 tabular-nums">
        {value}{suffix && <span className="text-sm font-normal text-gray-400 ml-1">{suffix}</span>}
      </p>
    </div>
  );
}

function AccuracyRing({ rate }: { rate: number }) {
  const radius = 36;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (rate / 100) * circumference;
  const color = rate >= 90 ? '#10b981' : rate >= 70 ? '#f59e0b' : '#ef4444';

  return (
    <div className="relative w-24 h-24">
      <svg className="w-24 h-24 -rotate-90" viewBox="0 0 96 96">
        <circle cx="48" cy="48" r={radius} fill="none" stroke="#f3f4f6" strokeWidth="8" />
        <circle
          cx="48" cy="48" r={radius} fill="none"
          stroke={color} strokeWidth="8"
          strokeDasharray={circumference} strokeDashoffset={offset}
          strokeLinecap="round"
          className="transition-all duration-500"
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="text-lg font-semibold text-gray-900">{rate}%</span>
      </div>
    </div>
  );
}

export default function AgentMetricsPage() {
  const [summary, setSummary] = useState<MetricsSummary | null>(null);
  const [daily, setDaily] = useState<DailyMetric[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchMetrics = useCallback(async () => {
    try {
      const res = await fetch('/api/agent/metrics?days=30');
      if (!res.ok) throw new Error('Failed');
      const data = await res.json();
      setSummary(data.data.summary);
      setDaily(data.data.daily);
    } catch {
      // Silent fail
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchMetrics(); }, [fetchMetrics]);

  if (loading) return <div className="text-sm text-gray-500">Loading metrics...</div>;
  if (!summary) return <div className="text-sm text-gray-400">No data available yet</div>;

  const decided = summary.confirmedActions + summary.modifiedActions + summary.rejectedActions;

  return (
    <div className="space-y-6">
      {/* Top stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="Emails Processed" value={summary.totalEmails} />
        <StatCard label="Actions Created" value={summary.totalActions} />
        <StatCard label="Pending" value={summary.pendingActions} />
        <StatCard label="Time Saved" value={summary.timeSavedHours} suffix="hrs" />
      </div>

      {/* Accuracy + Breakdown */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Accuracy ring */}
        <div className="border border-gray-200 rounded-lg p-6 flex flex-col items-center justify-center">
          <p className="text-xs text-gray-500 mb-3">Accuracy Rate</p>
          <AccuracyRing rate={summary.accuracyRate} />
          <p className="text-xs text-gray-400 mt-2">
            {summary.confirmedActions} confirmed / {decided} decided
          </p>
        </div>

        {/* Actions breakdown */}
        <div className="md:col-span-2 border border-gray-200 rounded-lg p-6">
          <p className="text-xs text-gray-500 mb-4">Actions Breakdown</p>
          <div className="space-y-3">
            {[
              { label: 'Confirmed', count: summary.confirmedActions, color: 'bg-emerald-500' },
              { label: 'Modified', count: summary.modifiedActions, color: 'bg-amber-500' },
              { label: 'Rejected', count: summary.rejectedActions, color: 'bg-red-500' },
              { label: 'Auto-executed', count: summary.autoExecutedActions, color: 'bg-blue-500' },
              { label: 'Pending', count: summary.pendingActions, color: 'bg-gray-300' },
            ].map(item => {
              const pct = summary.totalActions > 0
                ? Math.round((item.count / summary.totalActions) * 100)
                : 0;
              return (
                <div key={item.label} className="flex items-center gap-3">
                  <span className="text-xs text-gray-600 w-24">{item.label}</span>
                  <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full ${item.color} transition-all duration-300`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <span className="text-xs text-gray-500 w-12 text-right tabular-nums">{item.count}</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Daily chart (simple bar chart) */}
      {daily.length > 0 && (
        <div className="border border-gray-200 rounded-lg p-6">
          <p className="text-xs text-gray-500 mb-4">Daily Activity (last 30 days)</p>
          <div className="flex items-end gap-1 h-32">
            {daily.map(day => {
              const maxVal = Math.max(...daily.map(d => d.emailsProcessed), 1);
              const height = (day.emailsProcessed / maxVal) * 100;
              return (
                <div
                  key={day.date}
                  className="flex-1 flex flex-col items-center gap-1"
                  title={`${day.date}: ${day.emailsProcessed} emails`}
                >
                  <div
                    className="w-full bg-gray-900 rounded-t transition-all duration-300 min-h-[2px]"
                    style={{ height: `${height}%` }}
                  />
                </div>
              );
            })}
          </div>
          <div className="flex justify-between text-xs text-gray-400 mt-2">
            <span>{daily[0]?.date}</span>
            <span>{daily[daily.length - 1]?.date}</span>
          </div>
        </div>
      )}
    </div>
  );
}
