import type { Metadata } from 'next';
import Link from 'next/link';
import './globals.css';
import { PersonaSwitcher } from '@/components/PersonaSwitcher';
import { DemoGuide } from '@/components/DemoGuide';
import { V0_CONFIG } from '@/config/v0Config';

export const metadata: Metadata = {
  title: 'Summit MEP — Managed Finance',
  description: 'AI-native finance operations prototype for commercial specialty contractors.',
};

const NAV = [
  { href: '/', label: 'Command Center' },
  { href: '/work-queue', label: 'Work Queue' },
  { href: '/graph', label: 'Operating Graph' },
];

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">
        <header className="border-b border-[var(--color-line)] bg-[var(--color-surface)]">
          <div className="mx-auto flex max-w-[1400px] flex-wrap items-center gap-x-8 gap-y-3 px-6 py-3">
            <Link href="/" className="flex items-baseline gap-2">
              <span className="text-sm font-semibold tracking-tight">Summit MEP</span>
              <span className="text-xs text-[var(--color-muted)]">Managed Finance</span>
            </Link>

            <nav className="flex gap-1 text-sm">
              {NAV.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="rounded px-3 py-1.5 text-[var(--color-muted)] transition hover:bg-[var(--color-canvas)] hover:text-[var(--color-ink)]"
                >
                  {item.label}
                </Link>
              ))}
            </nav>

            <div className="ml-auto flex items-center gap-4">
              <span className="hidden text-xs text-[var(--color-muted)] sm:inline">
                Close {V0_CONFIG.closeDate}
              </span>
              <PersonaSwitcher />
            </div>
          </div>
        </header>

        <main className="mx-auto max-w-[1400px] px-6 py-8 pb-28">{children}</main>

        <DemoGuide />

        <footer className="mx-auto max-w-[1400px] px-6 pb-10 pt-4 text-xs text-[var(--color-muted)]">
          Prototype on fictional data. Draft management analysis only — not GAAP-compliant accounting, and no
          journal entries are posted.
        </footer>
      </body>
    </html>
  );
}
