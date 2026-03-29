import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'BrokerComply',
  description: 'Insurance Broker Compliance & Renewal Readiness Platform',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="bg-gray-50 text-gray-900 antialiased">
        <div className="min-h-screen flex flex-col lg:flex-row">
          {/* Mobile header */}
          <header className="lg:hidden bg-white border-b border-gray-200 p-4 flex items-center justify-between">
            <h1 className="text-lg font-bold text-gray-900">BrokerComply</h1>
            <details className="relative">
              <summary className="cursor-pointer p-2 text-gray-600 hover:text-gray-900 list-none">
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                </svg>
              </summary>
              <nav className="absolute right-0 top-12 bg-white border border-gray-200 rounded-lg shadow-lg p-4 w-48 z-50 space-y-1">
                <a href="/dashboard" className="block px-3 py-2 text-sm rounded hover:bg-gray-50">Dashboard</a>
                <a href="/renewals" className="block px-3 py-2 text-sm rounded hover:bg-gray-50">Renewals</a>
                <a href="/import" className="block px-3 py-2 text-sm rounded hover:bg-gray-50">Import Data</a>
                <a href="/audit" className="block px-3 py-2 text-sm rounded hover:bg-gray-50">Audit Trail</a>
                <a href="/settings" className="block px-3 py-2 text-sm rounded hover:bg-gray-50">Settings</a>
                <hr className="my-2" />
                <form action="/api/auth/logout" method="POST">
                  <button type="submit" className="block w-full text-left px-3 py-2 text-sm text-red-600 rounded hover:bg-red-50">Sign out</button>
                </form>
              </nav>
            </details>
          </header>

          <div className="flex flex-1">
            {/* Desktop sidebar */}
            <aside className="hidden lg:flex w-64 bg-white border-r border-gray-200 flex-col">
              <div className="p-6 border-b border-gray-200">
                <h1 className="text-xl font-bold text-gray-900">BrokerComply</h1>
                <p className="text-sm text-gray-500 mt-1">Compliance Platform</p>
              </div>
              <nav className="flex-1 p-4 space-y-1">
                <a href="/dashboard" className="flex items-center px-3 py-2 text-sm font-medium rounded-md text-gray-700 hover:bg-gray-50 hover:text-gray-900">
                  Dashboard
                </a>
                <a href="/renewals" className="flex items-center px-3 py-2 text-sm font-medium rounded-md text-gray-700 hover:bg-gray-50 hover:text-gray-900">
                  Renewals
                </a>
                <a href="/import" className="flex items-center px-3 py-2 text-sm font-medium rounded-md text-gray-700 hover:bg-gray-50 hover:text-gray-900">
                  Import Data
                </a>
                <a href="/audit" className="flex items-center px-3 py-2 text-sm font-medium rounded-md text-gray-700 hover:bg-gray-50 hover:text-gray-900">
                  Audit Trail
                </a>
                <a href="/settings" className="flex items-center px-3 py-2 text-sm font-medium rounded-md text-gray-700 hover:bg-gray-50 hover:text-gray-900">
                  Settings
                </a>
              </nav>
              <div className="p-4 border-t border-gray-200">
                <div className="flex items-center">
                  <div className="w-8 h-8 rounded-full bg-blue-600 flex items-center justify-center text-white text-sm font-medium" aria-hidden="true">
                    ?
                  </div>
                  <div className="ml-3">
                    <p className="text-sm font-medium">Loading...</p>
                    <p className="text-xs text-gray-500">—</p>
                  </div>
                </div>
                <form action="/api/auth/logout" method="POST" className="mt-3">
                  <button type="submit" className="text-xs text-gray-500 hover:text-red-600">
                    Sign out
                  </button>
                </form>
              </div>
            </aside>

            {/* Main content */}
            <main className="flex-1 min-w-0">
              {children}
            </main>
          </div>
        </div>
      </body>
    </html>
  );
}
