'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { apiFetch } from '@/lib/api-client';

interface Policy {
  id: string;
  policyNumber: string;
  policyType: string;
  insurerName: string;
  premium: string | number;
  expiryDate: string;
  policyStatus: string;
  renewals: { id: string; status: string; dueDate: string }[];
}

interface ClientData {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  createdAt: string;
  policies: Policy[];
  _count: { policies: number };
}

export default function ClientDetailPage() {
  const params = useParams();
  const clientId = params.id as string;
  const [client, setClient] = useState<ClientData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadClient() {
      try {
        const res = await apiFetch(`/api/clients/${clientId}`);
        if (!res.ok) {
          if (res.status === 401) { window.location.href = '/login'; return; }
          if (res.status === 404) { setClient(null); return; }
          throw new Error('Failed to load client');
        }
        const data = await res.json();
        setClient(data.data);
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    }
    loadClient();
  }, [clientId]);

  const formatPremium = (value: string | number) => {
    const num = typeof value === 'string' ? parseFloat(value) : value;
    return `€${num.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;
  };

  const statusColors: Record<string, { bg: string; text: string; label: string }> = {
    active: { bg: 'bg-green-100', text: 'text-green-800', label: 'Active' },
    cancelled: { bg: 'bg-red-100', text: 'text-red-800', label: 'Cancelled' },
    lapsed: { bg: 'bg-orange-100', text: 'text-orange-800', label: 'Lapsed' },
    not_in_export: { bg: 'bg-gray-100', text: 'text-gray-800', label: 'Not in Export' },
  };

  if (loading) return <div className="p-8 text-gray-500">Loading client...</div>;
  if (!client) return <div className="p-8 text-red-500">Client not found</div>;

  return (
    <div className="p-8">
      <div className="mb-8">
        <a href="/clients" className="text-sm text-blue-600 hover:underline">← Back to clients</a>
        <h1 className="text-2xl font-bold text-gray-900 mt-2">{client.name}</h1>
        <p className="text-gray-500">{client._count.policies} {client._count.policies === 1 ? 'policy' : 'policies'}</p>
      </div>

      {/* Client Info */}
      <div className="bg-white rounded-lg border border-gray-200 p-6 mb-6">
        <h2 className="text-lg font-semibold mb-4">Client Information</h2>
        <div className="grid grid-cols-2 gap-4 max-w-lg">
          <div>
            <label className="block text-sm font-medium text-gray-500">Name</label>
            <p className="text-sm text-gray-900 mt-1">{client.name}</p>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-500">Email</label>
            <p className="text-sm text-gray-900 mt-1">{client.email || '—'}</p>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-500">Phone</label>
            <p className="text-sm text-gray-900 mt-1">{client.phone || '—'}</p>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-500">Added</label>
            <p className="text-sm text-gray-900 mt-1">
              {new Date(client.createdAt).toLocaleDateString('en-IE')}
            </p>
          </div>
          {client.address && (
            <div className="col-span-2">
              <label className="block text-sm font-medium text-gray-500">Address</label>
              <p className="text-sm text-gray-900 mt-1">{client.address}</p>
            </div>
          )}
        </div>
      </div>

      {/* Policies */}
      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        <div className="p-6 border-b border-gray-200">
          <h2 className="text-lg font-semibold">Policies</h2>
        </div>
        {client.policies.length === 0 ? (
          <div className="p-6 text-center text-gray-500">No policies linked to this client.</div>
        ) : (
          <table className="min-w-full">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50">
                <th className="text-left py-3 px-4 text-sm font-medium text-gray-500">Policy Number</th>
                <th className="text-left py-3 px-4 text-sm font-medium text-gray-500">Type</th>
                <th className="text-left py-3 px-4 text-sm font-medium text-gray-500">Insurer</th>
                <th className="text-left py-3 px-4 text-sm font-medium text-gray-500">Premium</th>
                <th className="text-left py-3 px-4 text-sm font-medium text-gray-500">Expiry</th>
                <th className="text-left py-3 px-4 text-sm font-medium text-gray-500">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {client.policies.map(policy => {
                const s = statusColors[policy.policyStatus] || statusColors.active;
                return (
                  <tr key={policy.id} className="hover:bg-gray-50">
                    <td className="py-3 px-4 font-mono text-xs">{policy.policyNumber}</td>
                    <td className="py-3 px-4 text-sm">{policy.policyType}</td>
                    <td className="py-3 px-4 text-sm">{policy.insurerName}</td>
                    <td className="py-3 px-4 text-sm font-medium">{formatPremium(policy.premium)}</td>
                    <td className="py-3 px-4 text-sm">
                      {new Date(policy.expiryDate).toLocaleDateString('en-IE')}
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
        )}
      </div>
    </div>
  );
}
