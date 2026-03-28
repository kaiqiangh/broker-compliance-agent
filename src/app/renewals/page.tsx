export default function RenewalsPage() {
  const renewals = [
    { client: 'Máire Ní Chonaill', policy: 'POL-2024-004', type: 'Commercial', insurer: 'FBD', dueDate: '23/12/2024', premium: '€4,200.00', status: 'overdue', progress: '2/8' },
    { client: 'Patrick Kelly', policy: 'POL-2024-003', type: 'Motor', insurer: 'Allianz', dueDate: '12/01/2025', premium: '€1,580.00', status: 'at_risk', progress: '4/8' },
    { client: 'Conor O\'Neill', policy: 'POL-2024-006', type: 'Motor', insurer: 'Aviva', dueDate: '22/01/2025', premium: '€1,100.00', status: 'in_progress', progress: '5/8' },
    { client: 'Seán Ó Briain', policy: 'POL-2024-001', type: 'Motor', insurer: 'Aviva', dueDate: '11/02/2025', premium: '€1,245.00', status: 'pending', progress: '0/8' },
    { client: 'Niamh Fitzgerald', policy: 'POL-2024-007', type: 'Home', insurer: 'Allianz', dueDate: '11/02/2025', premium: '€750.00', status: 'pending', progress: '0/8' },
    { client: 'Áine Murphy', policy: 'POL-2024-002', type: 'Home', insurer: 'Zurich', dueDate: '02/03/2025', premium: '€890.00', status: 'compliant', progress: '8/8' },
    { client: 'Siobhán Doyle', policy: 'POL-2024-008', type: 'Motor', insurer: 'Zurich', dueDate: '21/03/2025', premium: '€1,350.00', status: 'in_progress', progress: '3/8' },
    { client: 'Cormac Brennan', policy: 'POL-2024-005', type: 'Motor', insurer: 'Liberty', dueDate: '12/04/2025', premium: '€980.00', status: 'pending', progress: '0/8' },
  ];

  const statusColors: Record<string, { bg: string; text: string; label: string }> = {
    overdue: { bg: 'bg-red-100', text: 'text-red-800', label: 'Overdue' },
    at_risk: { bg: 'bg-orange-100', text: 'text-orange-800', label: 'At Risk' },
    in_progress: { bg: 'bg-blue-100', text: 'text-blue-800', label: 'In Progress' },
    compliant: { bg: 'bg-green-100', text: 'text-green-800', label: 'Compliant' },
    pending: { bg: 'bg-gray-100', text: 'text-gray-800', label: 'Pending' },
  };

  return (
    <div className="p-8">
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Renewals</h1>
          <p className="text-gray-500 mt-1">Manage CPC renewal compliance for all upcoming policies</p>
        </div>
        <div className="flex gap-3">
          <select className="px-3 py-2 border border-gray-300 rounded-lg text-sm">
            <option>All statuses</option>
            <option>Overdue</option>
            <option>At Risk</option>
            <option>In Progress</option>
            <option>Compliant</option>
            <option>Pending</option>
          </select>
          <select className="px-3 py-2 border border-gray-300 rounded-lg text-sm">
            <option>All types</option>
            <option>Motor</option>
            <option>Home</option>
            <option>Commercial</option>
          </select>
        </div>
      </div>

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
              <th className="text-left py-3 px-4 text-sm font-medium text-gray-500"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {renewals.map((r, i) => {
              const s = statusColors[r.status];
              const [completed, total] = r.progress.split('/').map(Number);
              const pct = Math.round((completed / total) * 100);
              return (
                <tr key={i} className="hover:bg-gray-50">
                  <td className="py-3 px-4 font-medium">{r.client}</td>
                  <td className="py-3 px-4 font-mono text-xs text-gray-600">{r.policy}</td>
                  <td className="py-3 px-4 text-sm">{r.type}</td>
                  <td className="py-3 px-4 text-sm">{r.insurer}</td>
                  <td className="py-3 px-4 text-sm">{r.dueDate}</td>
                  <td className="py-3 px-4 text-sm font-medium">{r.premium}</td>
                  <td className="py-3 px-4">
                    <div className="flex items-center gap-2">
                      <div className="w-20 h-1.5 bg-gray-200 rounded-full">
                        <div
                          className={`h-1.5 rounded-full ${pct === 100 ? 'bg-green-500' : pct > 50 ? 'bg-blue-500' : 'bg-gray-400'}`}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <span className="text-xs text-gray-500">{r.progress}</span>
                    </div>
                  </td>
                  <td className="py-3 px-4">
                    <span className={`px-2.5 py-0.5 rounded-full text-xs font-medium ${s.bg} ${s.text}`}>
                      {s.label}
                    </span>
                  </td>
                  <td className="py-3 px-4">
                    <button className="text-blue-600 text-sm hover:underline">View</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
