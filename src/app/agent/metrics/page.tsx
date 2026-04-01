'use client';

import { useState, useEffect, useCallback } from 'react';
import { extractLearningInsights, type LearningInsight } from '@/app/agent/metrics/learning-response';

type TimeRange = '7d' | '14d' | '30d';

interface MetricsSummary {
  totalEmails: number;
  totalActions: number;
  pendingActions: number;
  confirmedActions: number;
  modifiedActions: number;
  rejectedActions: number;
  autoExecutedActions: number;
  accuracyRate: number;
  strictAccuracy: number;
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
  accuracyRate: number | null;
  strictAccuracy: number | null;
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

// --- Pie / Donut chart for action status distribution ---
function ActionPieChart({ summary }: { summary: MetricsSummary }) {
  const segments = [
    { label: 'Confirmed', count: summary.confirmedActions, color: '#10b981' },
    { label: 'Modified', count: summary.modifiedActions, color: '#f59e0b' },
    { label: 'Rejected', count: summary.rejectedActions, color: '#ef4444' },
    { label: 'Pending', count: summary.pendingActions, color: '#d1d5db' },
    { label: 'Auto-executed', count: summary.autoExecutedActions, color: '#3b82f6' },
  ];

  const total = segments.reduce((s, seg) => s + seg.count, 0);
  if (total === 0) {
    return (
      <div className="flex items-center justify-center h-48 text-sm text-gray-400">
        No actions yet
      </div>
    );
  }

  const cx = 80, cy = 80, outerR = 70, innerR = 40;
  let cumulative = 0;

  function describeArc(startAngle: number, endAngle: number) {
    const startRad = ((startAngle - 90) * Math.PI) / 180;
    const endRad = ((endAngle - 90) * Math.PI) / 180;
    const x1o = cx + outerR * Math.cos(startRad);
    const y1o = cy + outerR * Math.sin(startRad);
    const x2o = cx + outerR * Math.cos(endRad);
    const y2o = cy + outerR * Math.sin(endRad);
    const x1i = cx + innerR * Math.cos(endRad);
    const y1i = cy + innerR * Math.sin(endRad);
    const x2i = cx + innerR * Math.cos(startRad);
    const y2i = cy + innerR * Math.sin(startRad);
    const largeArc = endAngle - startAngle > 180 ? 1 : 0;
    return `M ${x1o} ${y1o} A ${outerR} ${outerR} 0 ${largeArc} 1 ${x2o} ${y2o} L ${x1i} ${y1i} A ${innerR} ${innerR} 0 ${largeArc} 0 ${x2i} ${y2i} Z`;
  }

  return (
    <div className="flex items-center gap-6">
      <svg viewBox="0 0 160 160" className="w-40 h-40 flex-shrink-0">
        {segments.map((seg) => {
          if (seg.count === 0) return null;
          const angle = (seg.count / total) * 360;
          const startAngle = cumulative;
          cumulative += angle;
          return (
            <path
              key={seg.label}
              d={describeArc(startAngle, startAngle + angle)}
              fill={seg.color}
              stroke="#fff"
              strokeWidth="1"
            />
          );
        })}
        {/* Center label */}
        <text x={cx} y={cy - 4} textAnchor="middle" className="fill-gray-900" style={{ fontSize: 18, fontWeight: 600 }}>
          {total}
        </text>
        <text x={cx} y={cy + 12} textAnchor="middle" className="fill-gray-400" style={{ fontSize: 9 }}>
          actions
        </text>
      </svg>
      {/* Legend */}
      <div className="space-y-2">
        {segments.map(seg => (
          <div key={seg.label} className="flex items-center gap-2 text-sm">
            <div className="w-3 h-3 rounded-sm flex-shrink-0" style={{ background: seg.color }} />
            <span className="text-gray-600">{seg.label}</span>
            <span className="text-gray-400 tabular-nums ml-1">{seg.count}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// --- Line chart with range toggle ---
function AccuracyTrendChart({ daily }: { daily: DailyMetric[] }) {
  const padding = { top: 16, right: 16, bottom: 32, left: 40 };
  const width = 600;
  const height = 200;
  const innerW = width - padding.left - padding.right;
  const innerH = height - padding.top - padding.bottom;

  const daysWithAccuracy = daily.map((d, i) => ({
    ...d,
    idx: i,
    useful: d.accuracyRate ?? null,
    strict: d.strictAccuracy ?? null,
  }));

  const hasAnyAccuracy = daysWithAccuracy.some(d => d.useful !== null);
  if (!hasAnyAccuracy) {
    return (
      <div className="flex items-center justify-center h-48 text-sm text-gray-400">
        No accuracy data yet — check back after actions are decided
      </div>
    );
  }

  function linePoints(key: 'useful' | 'strict') {
    const pts: { x: number; y: number; date: string; val: number }[] = [];
    daysWithAccuracy.forEach(d => {
      const val = d[key];
      if (val === null) return;
      const x = padding.left + (d.idx / Math.max(daily.length - 1, 1)) * innerW;
      const y = padding.top + innerH - (val / 100) * innerH;
      pts.push({ x, y, date: d.date, val });
    });
    return pts;
  }

  const usefulPts = linePoints('useful');
  const strictPts = linePoints('strict');
  const yTicks = [0, 25, 50, 75, 100];
  const dateLabels = [
    daily[0],
    daily[Math.floor(daily.length / 2)],
    daily[daily.length - 1],
  ].filter(Boolean).map(d => d.date);

  return (
    <div>
      <div className="flex items-center gap-4 mb-3">
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-0.5 rounded" style={{ background: '#6366f1' }} />
          <span className="text-xs text-gray-500">Useful rate</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-0.5 rounded" style={{ background: '#10b981' }} />
          <span className="text-xs text-gray-500">Strict rate</span>
        </div>
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full" style={{ height: '12rem' }}>
        {yTicks.map(tick => {
          const y = padding.top + innerH - (tick / 100) * innerH;
          return (
            <g key={tick}>
              <line x1={padding.left} y1={y} x2={padding.left + innerW} y2={y} stroke="#f3f4f6" strokeWidth="1" />
              <text x={padding.left - 8} y={y + 4} textAnchor="end" className="fill-gray-400" style={{ fontSize: 10 }}>{tick}%</text>
            </g>
          );
        })}
        {usefulPts.length > 1 && (
          <polyline points={usefulPts.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')} fill="none" stroke="#6366f1" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        )}
        {strictPts.length > 1 && (
          <polyline points={strictPts.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')} fill="none" stroke="#10b981" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        )}
        {usefulPts.map((p, i) => <circle key={`u-${i}`} cx={p.x} cy={p.y} r="3" fill="#6366f1" />)}
        {strictPts.map((p, i) => <circle key={`s-${i}`} cx={p.x} cy={p.y} r="3" fill="#10b981" />)}
        {dateLabels.map((date, i) => {
          const x = padding.left + (i === 0 ? 0 : i === 1 ? innerW / 2 : innerW);
          return <text key={date} x={x} y={height - 8} textAnchor="middle" className="fill-gray-400" style={{ fontSize: 10 }}>{date}</text>;
        })}
      </svg>
    </div>
  );
}

// --- Bar chart for daily email volume ---
function EmailVolumeBarChart({ daily }: { daily: DailyMetric[] }) {
  if (daily.length === 0) return null;

  const maxVal = Math.max(...daily.map(d => d.emailsProcessed + d.emailsReceived), 1);
  const barWidth = Math.max(2, Math.floor(600 / daily.length) - 2);
  const chartH = 140;
  const padding = { top: 8, bottom: 28, left: 40, right: 16 };
  const innerH = chartH - padding.top - padding.bottom;
  const chartW = padding.left + padding.right + daily.length * (barWidth + 2);

  const yTicks = [0, Math.round(maxVal / 2), maxVal];

  return (
    <div>
      <svg viewBox={`0 0 ${chartW} ${chartH}`} className="w-full" style={{ height: '10rem' }}>
        {/* Grid lines */}
        {yTicks.map(tick => {
          const y = padding.top + innerH - (tick / maxVal) * innerH;
          return (
            <g key={tick}>
              <line x1={padding.left} y1={y} x2={chartW - padding.right} y2={y} stroke="#f3f4f6" strokeWidth="1" />
              <text x={padding.left - 6} y={y + 4} textAnchor="end" className="fill-gray-400" style={{ fontSize: 9 }}>{tick}</text>
            </g>
          );
        })}
        {/* Bars */}
        {daily.map((day, i) => {
          const x = padding.left + i * (barWidth + 2);
          const processedH = (day.emailsProcessed / maxVal) * innerH;
          const receivedH = (day.emailsReceived / maxVal) * innerH;
          return (
            <g key={day.date}>
              {/* Received bar (background) */}
              <rect
                x={x} y={padding.top + innerH - receivedH}
                width={barWidth} height={receivedH}
                fill="#e5e7eb" rx="1"
              />
              {/* Processed bar (foreground) */}
              <rect
                x={x} y={padding.top + innerH - processedH}
                width={barWidth} height={processedH}
                fill="#1f2937" rx="1"
              />
              {/* Date label (every Nth) */}
              {i % Math.max(1, Math.floor(daily.length / 6)) === 0 && (
                <text
                  x={x + barWidth / 2} y={chartH - 6}
                  textAnchor="middle" className="fill-gray-400" style={{ fontSize: 8 }}
                >
                  {day.date.slice(5)}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      <div className="flex items-center gap-4 mt-2">
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded-sm bg-gray-900" />
          <span className="text-xs text-gray-500">Processed</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded-sm bg-gray-200" />
          <span className="text-xs text-gray-500">Received</span>
        </div>
      </div>
    </div>
  );
}

export default function AgentMetricsPage() {
  const [summary, setSummary] = useState<MetricsSummary | null>(null);
  const [daily, setDaily] = useState<DailyMetric[]>([]);
  const [insights, setInsights] = useState<LearningInsight[]>([]);
  const [loading, setLoading] = useState(true);
  const [range, setRange] = useState<TimeRange>('30d');

  const fetchMetrics = useCallback(async (r: TimeRange) => {
    try {
      const [metricsRes, learningRes] = await Promise.all([
        fetch(`/api/agent/metrics?range=${r}`),
        fetch('/api/agent/learning'),
      ]);
      if (metricsRes.ok) {
        const data = await metricsRes.json();
        setSummary(data.data.summary);
        setDaily(data.data.daily);
      }
      if (learningRes.ok) {
        const lData = await learningRes.json();
        setInsights(extractLearningInsights(lData));
      }
    } catch {
      // Silent fail
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchMetrics(range); }, [fetchMetrics, range]);

  if (loading) return <div className="text-sm text-gray-500">Loading metrics...</div>;
  if (!summary) return <div className="text-sm text-gray-400">No data available yet</div>;

  // Compute avg confidence from daily data
  const confidences = daily.filter(d => d.avgConfidence !== null).map(d => d.avgConfidence as number);
  const avgConfidence = confidences.length > 0
    ? Math.round((confidences.reduce((a, b) => a + b, 0) / confidences.length) * 100)
    : null;

  const decided = summary.confirmedActions + summary.modifiedActions + summary.rejectedActions;

  return (
    <div className="space-y-6">
      {/* 4 Number Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="Total Processed" value={summary.totalEmails} />
        <StatCard label="Accuracy Rate" value={summary.accuracyRate} suffix="%" />
        <StatCard label="Avg Confidence" value={avgConfidence !== null ? `${avgConfidence}%` : '—'} />
        <StatCard label="Time Saved" value={summary.timeSavedHours} suffix="hrs" />
      </div>

      {/* Pie chart + Accuracy ring side by side */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Pie chart */}
        <div className="border border-gray-200 rounded-lg p-6">
          <p className="text-xs text-gray-500 mb-4">Action Status Distribution</p>
          <ActionPieChart summary={summary} />
        </div>

        {/* Accuracy ring */}
        <div className="border border-gray-200 rounded-lg p-6 flex flex-col items-center justify-center">
          <p className="text-xs text-gray-500 mb-3">Accuracy Rate</p>
          <AccuracyRing rate={summary.accuracyRate} />
          <p className="text-xs text-gray-400 mt-2">
            {summary.confirmedActions} confirmed / {decided} decided
          </p>
        </div>
      </div>

      {/* Accuracy trend chart with range toggle */}
      {daily.length > 0 && (
        <div className="border border-gray-200 rounded-lg p-6">
          <div className="flex items-center justify-between mb-4">
            <p className="text-xs text-gray-500">Accuracy Trend</p>
            <div className="flex gap-1">
              {(['7d', '14d', '30d'] as TimeRange[]).map(r => (
                <button
                  key={r}
                  onClick={() => setRange(r)}
                  className={`px-2.5 py-1 text-xs rounded-md transition-colors ${
                    range === r
                      ? 'bg-gray-900 text-white'
                      : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
                >
                  {r}
                </button>
              ))}
            </div>
          </div>
          <AccuracyTrendChart daily={daily} />
        </div>
      )}

      {/* Daily email volume bar chart */}
      {daily.length > 0 && (
        <div className="border border-gray-200 rounded-lg p-6">
          <p className="text-xs text-gray-500 mb-4">Daily Email Volume (last {range})</p>
          <EmailVolumeBarChart daily={daily} />
        </div>
      )}

      {/* Learning Insights */}
      {insights.length > 0 && (
        <div className="border border-gray-200 rounded-lg p-6">
          <p className="text-xs text-gray-500 mb-4">Learning Insights (corrections applied ≥2 times)</p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 text-left text-xs text-gray-500">
                  <th className="pb-2 pr-4">Field</th>
                  <th className="pb-2 pr-4">Common Mistake</th>
                  <th className="pb-2 pr-4">Suggested Fix</th>
                  <th className="pb-2 text-right">Occurrences</th>
                </tr>
              </thead>
              <tbody>
                {insights.map((insight, i) => (
                  <tr key={i} className="border-b border-gray-50">
                    <td className="py-2 pr-4 font-medium text-gray-900">{insight.field}</td>
                    <td className="py-2 pr-4 text-red-600">{insight.commonMistake || <span className="text-gray-400 italic">empty</span>}</td>
                    <td className="py-2 pr-4 text-emerald-600">{insight.suggestedFix}</td>
                    <td className="py-2 text-right tabular-nums text-gray-600">{insight.occurrences}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
