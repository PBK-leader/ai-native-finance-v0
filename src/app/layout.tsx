import type { Metadata } from 'next';
import Link from 'next/link';
import './globals.css';
import { PersonaSwitcher } from '@/components/PersonaSwitcher';
import { DemoGuide } from '@/components/DemoGuide';
import { WaitingOnYou } from '@/components/WaitingOnYou';
import { V0_CONFIG } from '@/config/v0Config';

export const metadata: Metadata = {
  title: 'Summit MEP — Managed Finance',
  description: 'AI-native finance operations prototype for commercial specialty contractors.',
};

const NAV = [
  { href: '/', label: 'My desk' },
  { href: '/work-queue', label: 'Work queue' },
];

/** The machinery — for the finance lead who wants to see how the answers were produced. */
const UNDER_THE_HOOD = [
  { href: '/agents', label: 'Agents' },
  { href: '/graph', label: 'Operating graph' },
];

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">
        <header className="border-b border-[var(--color-line)] bg-[var(--color-surface)]">
          <div className="mx-auto flex max-w-[1400px] flex-wrap items-center gap-x-6 gap-y-3 px-6 py-3">
            <Link href="/" className="flex items-baseline gap-2">
              <span className="text-sm font-semibold tracking-tight">Summit MEP</span>
              <span className="text-xs text-[var(--color-muted)]">Managed Finance</span>
            </Link>

            <nav className="flex items-center gap-1 text-sm">
              {NAV.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="rounded px-3 py-1.5 text-[var(--color-muted)] transition hover:bg-[var(--color-canvas)] hover:text-[var(--color-ink)]"
                >
                  {item.label}
                </Link>
              ))}
              <span className="ml-3 hidden text-[11px] uppercase tracking-wide text-[var(--color-muted)] sm:inline">
                Under the hood
              </span>
              {UNDER_THE_HOOD.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="rounded px-2.5 py-1.5 text-xs text-[var(--color-muted)] transition hover:bg-[var(--color-canvas)] hover:text-[var(--color-ink)]"
                >
                  {item.label}
                </Link>
              ))}
            </nav>

            <div className="ml-auto flex items-center gap-4">
              <WaitingOnYou />
              <span className="hidden text-xs text-[var(--color-muted)] lg:inline">
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
