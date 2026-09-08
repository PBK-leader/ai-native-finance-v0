/**
 * Small presentational building blocks. No financial arithmetic lives here.
 */

import Link from 'next/link';
import type { ReactNode } from 'react';
import type { Severity, TaskStatus } from '@/domain/workflow';
import { statusLabel } from './format';

export function Card({
  title, subtitle, actions, children, className = '',
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] ${className}`}
    >
      {(title || actions) && (
        <header className="flex flex-wrap items-start justify-between gap-3 border-b border-[var(--color-line)] px-5 py-3">
          <div>
            {title && <h2 className="text-sm font-semibold">{title}</h2>}
            {subtitle && <p className="mt-0.5 text-xs text-[var(--color-muted)]">{subtitle}</p>}
          </div>
          {actions}
        </header>
      )}
      <div className="px-5 py-4">{children}</div>
    </section>
  );
}

export function Metric({
  label, value, sub, tone = 'default',
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  tone?: 'default' | 'good' | 'warn' | 'bad';
}) {
  const toneClass =
    tone === 'bad' ? 'text-[var(--color-blocking)]'
    : tone === 'warn' ? 'text-[var(--color-medium)]'
    : tone === 'good' ? 'text-[var(--color-ok)]'
    : '';

  return (
    <div>
      <div className="text-xs text-[var(--color-muted)]">{label}</div>
      <div className={`tabular mt-1 text-xl font-semibold ${toneClass}`}>{value}</div>
      {sub && <div className="mt-0.5 text-xs text-[var(--color-muted)]">{sub}</div>}
    </div>
  );
}

export function SeverityTag({ severity }: { severity: Severity }) {
  const style =
    severity === 'HIGH' ? 'bg-red-50 text-[var(--color-high)] ring-red-200'
    : severity === 'MEDIUM' ? 'bg-amber-50 text-[var(--color-medium)] ring-amber-200'
    : 'bg-slate-50 text-[var(--color-muted)] ring-slate-200';

  return (
    <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ring-1 ring-inset ${style}`}>
      {severity}
    </span>
  );
}

export function BlockingTag({ blocking }: { blocking: boolean }) {
  if (!blocking) {
    return (
      <span className="rounded bg-slate-50 px-1.5 py-0.5 text-[11px] text-[var(--color-muted)] ring-1 ring-inset ring-slate-200">
        Non-blocking
      </span>
    );
  }
  return (
    <span className="rounded bg-red-50 px-1.5 py-0.5 text-[11px] font-medium text-[var(--color-blocking)] ring-1 ring-inset ring-red-200">
      Blocks close
    </span>
  );
}

export function StatusTag({ status }: { status: TaskStatus }) {
  const style =
    status === 'RESOLVED' ? 'bg-green-50 text-[var(--color-ok)] ring-green-200'
    : status === 'ACCEPTED_RISK' ? 'bg-violet-50 text-violet-700 ring-violet-200'
    : 'bg-blue-50 text-[var(--color-accent)] ring-blue-200';

  return (
    <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ring-1 ring-inset ${style}`}>
      {statusLabel(status)}
    </span>
  );
}

export function CloseReadyTag({ ready }: { ready: boolean }) {
  return ready ? (
    <span className="rounded bg-green-50 px-2 py-0.5 text-xs font-medium text-[var(--color-ok)] ring-1 ring-inset ring-green-200">
      Ready to close
    </span>
  ) : (
    <span className="rounded bg-amber-50 px-2 py-0.5 text-xs font-medium text-[var(--color-medium)] ring-1 ring-inset ring-amber-200">
      Not close-ready
    </span>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return (
    <p className="rounded border border-dashed border-[var(--color-line)] px-4 py-6 text-center text-sm text-[var(--color-muted)]">
      {children}
    </p>
  );
}

export function ProjectLink({ id, name }: { id: string; name: string }) {
  return (
    <Link href={`/projects/${id}`} className="font-medium text-[var(--color-accent)] hover:underline">
      {name}
    </Link>
  );
}

export function Th({ children, align = 'left' }: { children: ReactNode; align?: 'left' | 'right' }) {
  return (
    <th
      className={`whitespace-nowrap border-b border-[var(--color-line)] px-3 py-2 text-xs font-medium text-[var(--color-muted)] ${
        align === 'right' ? 'text-right' : 'text-left'
      }`}
    >
      {children}
    </th>
  );
}

export function Td({
  children, align = 'left', className = '',
}: {
  children: ReactNode;
  align?: 'left' | 'right';
  className?: string;
}) {
  return (
    <td
      className={`border-b border-[var(--color-line)] px-3 py-2 text-sm ${
        align === 'right' ? 'tabular text-right' : ''
      } ${className}`}
    >
      {children}
    </td>
  );
}
