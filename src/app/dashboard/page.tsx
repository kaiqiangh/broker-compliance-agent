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

export default function DashboardPage() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    async function loadDashboard() {
      try {
        const res = await fetch('/api/dashboard');
        if (!res.ok) {
          if (res.status === 401) {
            window.location.href = '/login';
            return;
          }
          throw new Error('Failed to load dashboard');
        }
        const data = await res.json();
        setStats(data.data);
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

  const statusColors: Record<string, string> = {
    overdue: 'bg-red-100 text-red-800',
    at_risk: 'bg-orange-100 text-orange-800',
    in_progress: 'bg-blue-100 text-blue-800',
    compliant: 'bg-green-100 text-green-800',
    pending: 'bg-gray-100 text-gray-800',
  };

  return (
    <div className="p-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
        <p className="text-gray-500 mt-1">CPC Renewal Compliance Overview</p>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <p className="text-sm font-medium text-gray-500">Total Renewals</p>
          <p className="text-3xl font-bold text-gray-900 mt-2">{stats.totalRenewals}</p>
          <p className="text-sm text-gray-500 mt-1">Next 90 days</p>
        </div>
        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <p className="text-sm font-medium text-gray-500">Compliance Rate</p>
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

      {/* Status Breakdown */}
      <div className="grid grid-cols-5 gap-3 mb-8">
        {[
          { label: 'Pending', count: stats.byStatus.pending, color: 'bg-gray-500' },
          { label: 'In Progress', count: stats.byStatus.in_progress, color: 'bg-blue-500' },
          { label: 'At Risk', count: stats.byStatus.at_risk, color: 'bg-orange-500' },
          { label: 'Compliant', count: stats.byStatus.compliant, color: 'bg-green-500' },
          { label: 'Overdue', count: stats.byStatus.overdue, color: 'bg-red-500' },
        ].map(item => (
          <div key={item.label} className="bg-white rounded-lg border border-gray-200 p-4 text-center">
            <div className={`w-3 h-3 rounded-full ${item.color} mx-auto mb-2`} />
            <p className="text-2xl font-bold">{item.count}</p>
            <p className="text-xs text-gray-500">{item.label}</p>
          </div>
        ))}
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
                  <span className={`px-2.5 py-0.5 rounded-full text-xs font-medium ${statusColors[item.status]}`}>
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
    </div>
  );
}
