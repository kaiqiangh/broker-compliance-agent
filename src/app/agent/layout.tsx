'use client';

import { usePathname } from 'next/navigation';

const tabs = [
  { href: '/agent', label: 'Dashboard' },
  { href: '/agent/config', label: 'Configuration' },
];

export default function AgentLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">AI Agent</h1>
        <p className="mt-1 text-sm text-gray-500">
          Your agent processes emails and suggests updates. Review and confirm actions below.
        </p>
      </div>

      {/* Tabs */}
      <nav className="flex gap-6 border-b border-gray-200">
        {tabs.map(tab => {
          const isActive = pathname === tab.href;
          return (
            <a
              key={tab.href}
              href={tab.href}
              className={`pb-3 text-sm font-medium border-b-2 -mb-px transition-colors ${
                isActive
                  ? 'border-gray-900 text-gray-900'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              {tab.label}
            </a>
          );
        })}
      </nav>

      {children}
    </div>
  );
}
