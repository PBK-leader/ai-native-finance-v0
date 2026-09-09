/**
 * Work Queue — the shared list of what needs a human.
 *
 * Filters are query parameters rather than client state, so a filtered queue is a URL a controller can send
 * to an accountant. Blocking items sort first, then by dollar impact: the queue should open on the thing
 * that matters most, not the thing that happened to be detected first.
 */

import Link from 'next/link';
import { canonical, engineState } from '@/workflows/engine';
import { compareByUrgency, ruleDescription } from '@/workflows/replay';
import { forecastTargetsFor } from '@/workflows/forecastTargets';
import { isSettled } from '@/domain/workflow';
import type { Role } from '@/domain/entities';
import type { Workstream } from '@/domain/workflow';
import { Card, Empty } from '@/components/ui';
import { ExceptionCard } from '@/components/ExceptionCard';
import { dollarExposure } from '@/calculations/portfolio';
import { usd } from '@/components/format';
import { currentPersona } from '@/components/personaServer';

export const dynamic = 'force-dynamic';

const ROLES: (Role | 'All')[] = ['All', 'Project Manager', 'Project Accountant', 'Controller'];
const WORKSTREAMS: (Workstream | 'All')[] = [
  'All', 'Forecast', 'AP', 'Billing', 'Change Orders', 'Data Quality',
];
const STATUSES = ['open', 'blocking', 'settled', 'all'] as const;

export default async function WorkQueue({
  searchParams,
}: {
  searchParams: Promise<{ role?: string; workstream?: string; project?: string; status?: string }>;
}) {
  const params = await searchParams;
  const role = (params.role ?? 'All') as Role | 'All';
  const workstream = (params.workstream ?? 'All') as Workstream | 'All';
  const projectFilter = params.project ?? 'All';
  const status = (params.status ?? 'open') as (typeof STATUSES)[number];

  const { persona: viewer } = await currentPersona();
  const state = engineState();
  const model = canonical();
  const exceptionById = new Map(state.current.exceptions.map((e) => [e.id, e]));

  const tasks = state.current.tasks.filter((task) => {
    if (role !== 'All' && task.ownerRole !== role) return false;
    if (workstream !== 'All' && task.workstream !== workstream) return false;
    if (projectFilter !== 'All' && task.projectId !== projectFilter) return false;
    if (status === 'open') return !isSettled(task.status);
    if (status === 'blocking') return task.blocking && !isSettled(task.status);
    if (status === 'settled') return isSettled(task.status);
    return true;
  });

  // Open before settled, then the one shared definition of urgency the desks use.
  const impactOf = (task: (typeof tasks)[number]) => exceptionById.get(task.exceptionId)?.impact ?? 0;
  const sorted = [...tasks].sort(
    (a, b) => Number(isSettled(a.status)) - Number(isSettled(b.status)) || compareByUrgency(a, b, impactOf),
  );

  const exposure = dollarExposure(
    sorted.map((task) => exceptionById.get(task.exceptionId)).filter((e) => e !== undefined),
  );
  const blockingCount = sorted.filter((t) => t.blocking && !isSettled(t.status)).length;

  const buildHref = (patch: Record<string, string>) => {
    const next = new URLSearchParams({ role, workstream, project: projectFilter, status, ...patch });
    for (const [key, value] of [...next.entries()]) if (value === 'All') next.delete(key);
    const query = next.toString();
    return query ? `/work-queue?${query}` : '/work-queue';
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Work queue</h1>
        <p className="mt-1 max-w-2xl text-sm">
          <span className="font-medium">What this answers:</span>{' '}
          <span className="text-[var(--color-muted)]">
            Everything that needs a human across the whole team — who owns it, and what to do. Your own
            items are already waiting on{' '}
            <Link href="/" className="text-[var(--color-accent)] hover:underline">your desk</Link>.
          </span>
        </p>
        <p className="mt-2 text-sm text-[var(--color-muted)]">
          {sorted.length} item{sorted.length === 1 ? '' : 's'} · {blockingCount} blocking the close ·{' '}
          {usd(exposure.total, { compact: true })} of value affected
        </p>
      </div>

      <Card>
        <div className="space-y-3">
          <FilterRow label="Owner" options={ROLES} current={role} param="role" buildHref={buildHref} />
          <FilterRow
            label="Workstream"
            options={WORKSTREAMS}
            current={workstream}
            param="workstream"
            buildHref={buildHref}
          />
          <FilterRow
            label="Project"
            options={['All', ...model.projects.map((p) => p.id)]}
            current={projectFilter}
            param="project"
            buildHref={buildHref}
            labelFor={(value) =>
              value === 'All' ? 'All' : (model.index.projectById.get(value as never)?.name ?? value)
            }
          />
          <FilterRow
            label="Status"
            options={[...STATUSES]}
            current={status}
            param="status"
            buildHref={buildHref}
            labelFor={(value) =>
              value === 'open' ? 'Open'
              : value === 'blocking' ? 'Blocking only'
              : value === 'settled' ? 'Resolved'
              : 'Everything'
            }
          />
        </div>
      </Card>

      {sorted.length === 0 ? (
        <Empty>
          Nothing matches these filters.{' '}
          <Link href="/work-queue" className="text-[var(--color-accent)] hover:underline">
            Clear them
          </Link>
          .
        </Empty>
      ) : (
        <div className="space-y-4">
          {sorted.map((task) => {
            const exception = exceptionById.get(task.exceptionId);
            if (!exception) return null;
            return (
              <ExceptionCard
                key={task.id}
                exception={exception}
                task={task}
                decisions={state.decisions.filter((d) => d.exceptionId === exception.id)}
                ruleDescription={ruleDescription(exception.ruleId)}
                ownerName={task.ownerPersonId ? model.index.personById.get(task.ownerPersonId)?.name : undefined}
                viewer={viewer}
                forecastTargets={
                  exception.projectId
                    ? forecastTargetsFor(
                        state.current.metricsByProject.get(exception.projectId)!,
                        exception,
                      )
                    : []
                }
                projectName={
                  exception.projectId
                    ? model.index.projectById.get(exception.projectId)?.name
                    : 'Company-wide'
                }
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

function FilterRow({
  label, options, current, param, buildHref, labelFor,
}: {
  label: string;
  options: readonly string[];
  current: string;
  param: string;
  buildHref: (patch: Record<string, string>) => string;
  labelFor?: (value: string) => string;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="w-20 shrink-0 text-xs text-[var(--color-muted)]">{label}</span>
      {options.map((option) => (
        <Link
          key={option}
          href={buildHref({ [param]: option })}
          className={`rounded border px-2.5 py-1 text-xs transition ${
            current === option
              ? 'border-[var(--color-accent)] bg-blue-50 font-medium text-[var(--color-accent)]'
              : 'border-[var(--color-line)] hover:border-[var(--color-accent)]'
          }`}
        >
          {labelFor ? labelFor(option) : option}
        </Link>
      ))}
    </div>
  );
}
