'use client';


import { apiFetch } from '@/lib/api-client';
import { useEffect, useState } from 'react';

interface Client {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  _count: { policies: number };
}

export default function ClientsPage() {
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const pageSize = 20;

  useEffect(() => {
    async function loadClients() {
      setLoading(true);
      try {
        const params = new URLSearchParams();
        if (search) params.set('q', search);

        const res = await apiFetch(`/api/clients?${params}`);
        if (!res.ok) {
          if (res.status === 401) { window.location.href = '/login'; return; }
          throw new Error('Failed to load clients');
        }
        const data = await res.json();
        setClients(data.data);
        setPage(1);
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    }
    loadClients();
  }, [search]);

  const totalPages = Math.max(1, Math.ceil(clients.length / pageSize));
  const paginated = clients.slice((page - 1) * pageSize, page * pageSize);

  return (
    <div className="p-8">
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Clients</h1>
          <p className="text-gray-500 mt-1">Manage your client portfolio</p>
        </div>
        <div className="flex gap-3">
          <input
            type="text"
            placeholder="Search by name..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="px-3 py-2 border border-gray-300 rounded-lg text-sm w-48"
          />
        </div>
      </div>

      {loading ? (
        <div className="text-center text-gray-500 py-12">Loading clients...</div>
      ) : clients.length === 0 ? (
        <div className="text-center text-gray-500 py-12">
          {search ? 'No clients match your search.' : 'No clients found. Import data to get started.'}
        </div>
      ) : (
        <>
          <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
            <table className="min-w-full">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50">
                  <th className="text-left py-3 px-4 text-sm font-medium text-gray-500">Name</th>
                  <th className="text-left py-3 px-4 text-sm font-medium text-gray-500">Email</th>
                  <th className="text-left py-3 px-4 text-sm font-medium text-gray-500">Phone</th>
                  <th className="text-left py-3 px-4 text-sm font-medium text-gray-500">Policies</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {paginated.map(client => (
                  <tr
                    key={client.id}
                    className="hover:bg-gray-50 cursor-pointer"
                    onClick={() => window.location.href = `/clients/${client.id}`}
                  >
                    <td className="py-3 px-4 font-medium">{client.name}</td>
                    <td className="py-3 px-4 text-sm text-gray-600">{client.email || '—'}</td>
                    <td className="py-3 px-4 text-sm text-gray-600">{client.phone || '—'}</td>
                    <td className="py-3 px-4 text-sm">
                      <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                        {client._count.policies}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between mt-4">
              <p className="text-sm text-gray-500">
                Showing {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, clients.length)} of {clients.length}
              </p>
              <div className="flex gap-2">
                <button
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                  disabled={page === 1}
                  className="px-3 py-1.5 text-sm border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-50"
                >
                  Previous
                </button>
                <span className="px-3 py-1.5 text-sm text-gray-600">
                  Page {page} of {totalPages}
                </span>
                <button
                  onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                  disabled={page === totalPages}
                  className="px-3 py-1.5 text-sm border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-50"
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
