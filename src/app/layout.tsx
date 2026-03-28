import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import './globals.css';

export const metadata: Metadata = {
  title: 'BrokerComply',
  description: 'Insurance Broker Compliance & Renewal Readiness Platform',
};

// Simple server-side session reader (matches in-memory session store in lib/auth.ts)
// In production, replace with NextAuth session
function getSessionUser() {
  try {
    // The session cookie is set by login/register API
    // For SSR, we just show a generic sidebar — the client pages handle their own auth state
    return null;
  } catch {
    return null;
  }
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="bg-gray-50 text-gray-900 antialiased">
        <div className="min-h-screen flex">
          {/* Sidebar */}
          <aside className="w-64 bg-white border-r border-gray-200 flex flex-col">
            <div className="p-6 border-b border-gray-200">
              <h1 className="text-xl font-bold text-gray-900">BrokerComply</h1>
              <p className="text-sm text-gray-500 mt-1">Compliance Platform</p>
            </div>
            <nav className="flex-1 p-4 space-y-1">
              <a href="/dashboard" className="flex items-center px-3 py-2 text-sm font-medium rounded-md bg-blue-50 text-blue-700">
                Dashboard
              </a>
              <a href="/renewals" className="flex items-center px-3 py-2 text-sm font-medium rounded-md text-gray-700 hover:bg-gray-50">
                Renewals
              </a>
              <a href="/import" className="flex items-center px-3 py-2 text-sm font-medium rounded-md text-gray-700 hover:bg-gray-50">
                Import Data
              </a>
              <a href="/audit" className="flex items-center px-3 py-2 text-sm font-medium rounded-md text-gray-700 hover:bg-gray-50">
                Audit Trail
              </a>
            </nav>
            <div className="p-4 border-t border-gray-200">
              <div className="flex items-center">
                <div className="w-8 h-8 rounded-full bg-blue-600 flex items-center justify-center text-white text-sm font-medium">
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
          <main className="flex-1">
            {children}
          </main>
        </div>
      </body>
    </html>
  );
}
