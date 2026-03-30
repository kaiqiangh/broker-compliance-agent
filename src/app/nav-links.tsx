'use client';

import { usePathname } from 'next/navigation';

const links = [
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/agent', label: 'Agent' },
  { href: '/renewals', label: 'Renewals' },
  { href: '/clients', label: 'Clients' },
  { href: '/import', label: 'Import Data' },
  { href: '/audit', label: 'Audit Trail' },
  { href: '/settings', label: 'Settings' },
];

export function NavLinks({ mobile = false }: { mobile?: boolean }) {
  const pathname = usePathname();

  return (
    <>
      {links.map(link => {
        const isActive = pathname === link.href ||
          (link.href !== '/dashboard' && pathname.startsWith(link.href));

        if (mobile) {
          return (
            <a
              key={link.href}
              href={link.href}
              className={`block px-3 py-2 text-sm rounded ${
                isActive ? 'bg-blue-50 text-blue-700 font-medium' : 'hover:bg-gray-50'
              }`}
            >
              {link.label}
            </a>
          );
        }

        return (
          <a
            key={link.href}
            href={link.href}
            className={`flex items-center px-3 py-2 text-sm font-medium rounded-md ${
              isActive
                ? 'bg-blue-50 text-blue-700'
                : 'text-gray-700 hover:bg-gray-50 hover:text-gray-900'
            }`}
          >
            {link.label}
          </a>
        );
      })}
    </>
  );
}
