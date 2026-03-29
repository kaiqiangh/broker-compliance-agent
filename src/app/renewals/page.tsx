'use client';

import { useEffect, useState } from 'react';

interface Renewal {
  id: string;
  clientName: string;
  policyNumber: string;
  policyType: string;
  insurerName: string;
  dueDate: string;
  premium: number | string;
  newPremium: number | null;
  status: string;
  checklistProgress: string;
  completionRate: number;
  daysUntilDue: number;
}

export default function RenewalsPage() {
  const [renewals, setRenewals] = useState<Renewal[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [search, setSearch] = useState('');

  useEffect(() => {
    async function loadRenewals() {
      try {
        const params = new URLSearchParams();
        if (statusFilter) params.set('status', statusFilter);
        if (typeFilter) params.set('type', typeFilter);

        const res = await fetch(`/api/renewals?${params}`);
        if (!res.ok) {
          if (res.status === 401) { window.location.href = '/login'; return; }
          throw new Error('Failed to load renewals');
        }
        const data = await res.json();
        let filtered = data.data;

        // Client-side search
        if (search) {
          const q = search.toLowerCase();
          filtered = filtered.filter((r: Renewal) =>
            r.clientName.toLowerCase().includes(q) ||
            r.policyNumber.toLowerCase().includes(q) ||
            r.insurerName.toLowerCase().includes(q)
          );
        }

        setRenewals(filtered);
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    }
    loadRenewals();
  }, [statusFilter, typeFilter, search]);

  const statusColors: Record<string, { bg: string; text: string; label: string }> = {
    overdue: { bg: 'bg-red-100', text: 'text-red-800', label: 'Overdue' },
    at_risk: { bg: 'bg-orange-100', text: 'text-orange-800', label: 'At Risk' },
    in_progress: { bg: 'bg-blue-100', text: 'text-blue-800', label: 'In Progress' },
    compliant: { bg: 'bg-green-100', text: 'text-green-800', label: 'Compliant' },
    pending: { bg: 'bg-gray-100', text: 'text-gray-800', label: 'Pending' },
  };

  const formatPremium = (value: number | string) => {
    const num = typeof value === 'string' ? parseFloat(value) : value;
    return `€${(isNaN(num) ? 0 : num).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;
  };

  return (
    <div className="p-8">
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Renewals</h1>
          <p className="text-gray-500 mt-1">Manage CPC renewal compliance</p>
        </div>
        <div className="flex gap-3">
          <input
            type="text"
            placeholder="Search client, policy..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="px-3 py-2 border border-gray-300 rounded-lg text-sm w-48"
          />
          <select
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value)}
            className="px-3 py-2 border border-gray-300 rounded-lg text-sm"
          >
            <option value="">All statuses</option>
            <option value="overdue">Overdue</option>
            <option value="at_risk">At Risk</option>
            <option value="in_progress">In Progress</option>
            <option value="compliant">Compliant</option>
            <option value="pending">Pending</option>
          </select>
          <select
            value={typeFilter}
            onChange={e => setTypeFilter(e.target.value)}
            className="px-3 py-2 border border-gray-300 rounded-lg text-sm"
          >
            <option value="">All types</option>
            <option value="motor">Motor</option>
            <option value="home">Home</option>
            <option value="commercial">Commercial</option>
          </select>
        </div>
      </div>

      {loading ? (
        <div className="text-center text-gray-500 py-12">Loading renewals...</div>
      ) : renewals.length === 0 ? (
        <div className="text-center text-gray-500 py-12">
          No renewals found. Import policy data to get started.
        </div>
      ) : (
        <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
          <table className="min-w-full">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50">
                <th className="text-left py-3 px-4 text-sm font-medium text-gray-500">Client</th>
                <th className="text-left py-3 px-4 text-sm font-medium text-gray-500">Policy</th>
                <th className="text-left py-3 px-4 text-sm font-medium text-gray-500">Type</th>
                <th className="text-left py-3 px-4 text-sm font-medium text-gray-500">Insurer</th>
                <th className="text-left py-3 px-4 text-sm font-medium text-gray-500">Due Date</th>
                <th className="text-left py-3 px-4 text-sm font-medium text-gray-500">Premium</th>
                <th className="text-left py-3 px-4 text-sm font-medium text-gray-500">Checklist</th>
                <th className="text-left py-3 px-4 text-sm font-medium text-gray-500">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {renewals.map((r) => {
                const s = statusColors[r.status] || statusColors.pending;
                return (
                  <tr
                    key={r.id}
                    className="hover:bg-gray-50 cursor-pointer"
                    onClick={() => window.location.href = `/renewals/${r.id}`}
                  >
                    <td className="py-3 px-4 font-medium">{r.clientName}</td>
                    <td className="py-3 px-4 font-mono text-xs text-gray-600">{r.policyNumber}</td>
                    <td className="py-3 px-4 text-sm">{r.policyType}</td>
                    <td className="py-3 px-4 text-sm">{r.insurerName}</td>
                    <td className="py-3 px-4 text-sm">
                      {new Date(r.dueDate).toLocaleDateString('en-IE')}
                    </td>
                    <td className="py-3 px-4 text-sm font-medium">{formatPremium(r.premium)}</td>
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-2">
                        <div className="w-20 h-1.5 bg-gray-200 rounded-full">
                          <div
                            className={`h-1.5 rounded-full ${
                              r.completionRate === 100 ? 'bg-green-500' :
                              r.completionRate > 50 ? 'bg-blue-500' : 'bg-gray-400'
                            }`}
                            style={{ width: `${r.completionRate}%` }}
                          />
                        </div>
                        <span className="text-xs text-gray-500">{r.checklistProgress}</span>
                      </div>
                    </td>
                    <td className="py-3 px-4">
                      <span className={`px-2.5 py-0.5 rounded-full text-xs font-medium ${s.bg} ${s.text}`}>
                        {s.label}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
