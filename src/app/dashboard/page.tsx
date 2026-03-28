export default function DashboardPage() {
  // Mock data for initial render — will be replaced with API calls
  const stats = {
    totalRenewals: 8,
    compliant: 2,
    inProgress: 3,
    atRisk: 1,
    overdue: 1,
    pending: 1,
    complianceRate: 25,
  };

  const upcomingDeadlines = [
    { client: 'Máire Ní Chonaill', policy: 'POL-2024-004', type: 'Commercial', daysUntilDue: -5, status: 'overdue' },
    { client: 'Patrick Kelly', policy: 'POL-2024-003', type: 'Motor', daysUntilDue: 15, status: 'at_risk' },
    { client: 'Conor O\'Neill', policy: 'POL-2024-006', type: 'Motor', daysUntilDue: 25, status: 'in_progress' },
    { client: 'Seán Ó Briain', policy: 'POL-2024-001', type: 'Motor', daysUntilDue: 45, status: 'pending' },
  ];

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
            <div className="h-2 bg-green-500 rounded-full" style={{ width: `${stats.complianceRate}%` }} />
          </div>
        </div>
        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <p className="text-sm font-medium text-gray-500">At Risk</p>
          <p className="text-3xl font-bold text-orange-600 mt-2">{stats.atRisk}</p>
          <p className="text-sm text-gray-500 mt-1">&lt; 7 days, incomplete</p>
        </div>
        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <p className="text-sm font-medium text-gray-500">Overdue</p>
          <p className="text-3xl font-bold text-red-600 mt-2">{stats.overdue}</p>
          <p className="text-sm text-gray-500 mt-1">Needs immediate action</p>
        </div>
      </div>

      {/* Status Breakdown */}
      <div className="grid grid-cols-5 gap-3 mb-8">
        {[
          { label: 'Pending', count: stats.pending, color: 'bg-gray-500' },
          { label: 'In Progress', count: stats.inProgress, color: 'bg-blue-500' },
          { label: 'At Risk', count: stats.atRisk, color: 'bg-orange-500' },
          { label: 'Compliant', count: stats.compliant, color: 'bg-green-500' },
          { label: 'Overdue', count: stats.overdue, color: 'bg-red-500' },
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
          {upcomingDeadlines.map((item, i) => (
            <div key={i} className="px-6 py-4 flex items-center justify-between">
              <div>
                <p className="font-medium text-gray-900">{item.client}</p>
                <p className="text-sm text-gray-500">{item.policy} · {item.type}</p>
              </div>
              <div className="flex items-center gap-4">
                <span className={`px-2.5 py-0.5 rounded-full text-xs font-medium ${statusColors[item.status]}`}>
                  {item.status.replace('_', ' ')}
                </span>
                <span className="text-sm text-gray-500">
                  {item.daysUntilDue < 0 ? `${Math.abs(item.daysUntilDue)} days overdue` : `${item.daysUntilDue} days`}
                </span>
              </div>
            </div>
          ))}
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
