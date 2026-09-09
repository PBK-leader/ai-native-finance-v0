/**
 * My desk — what one person has to do, in the order to do it.
 *
 * A project manager should never see a portfolio dashboard; an accountant should not have to filter a shared
 * queue to find their own work. This is the proactive half of the agent loop made visible: the system has
 * already detected, routed and prioritised — here is the first thing, with the answer form open.
 */

import Link from 'next/link';
import type { CanonicalModel } from '@/domain/entities';
import type { Task, Workstream } from '@/domain/workflow';
import type { EngineState } from '@/workflows/replay';
import { ruleDescription } from '@/workflows/replay';
import { forecastTargetsFor } from '@/workflows/forecastTargets';
import { dollarExposure } from '@/calculations/portfolio';
import { Card, Empty } from '@/components/ui';
import { ExceptionCard } from '@/components/ExceptionCard';
import { usd } from '@/components/format';
import type { Persona } from '@/components/persona';

/** Which Project 360 tab a workstream's items live on. */
export function tabFor(workstream: Workstream): string {
  switch (workstream) {
    case 'Forecast':
      return 'forecast';
    case 'Billing':
    case 'Change Orders':
      return 'billing';
    default:
      return 'ap';
  }
}

export function TaskDesk({
  persona, tasks, state, model, intro,
}: {
  persona: Persona;
  /** Already prioritised by `openTasksForPerson`. */
  tasks: Task[];
  state: EngineState;
  model: CanonicalModel;
  intro?: string;
}) {
  const firstName = persona.name.split(' ')[0];
  const exceptionById = new Map(state.current.exceptions.map((e) => [e.id, e]));
  const exceptions = tasks.map((t) => exceptionById.get(t.exceptionId)).filter((e) => e !== undefined);
  const blocking = tasks.filter((t) => t.blocking).length;
  const exposure = dollarExposure(exceptions);

  const [first, ...rest] = tasks;
  const firstException = first ? exceptionById.get(first.exceptionId) : undefined;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">
          {tasks.length === 0
            ? `${firstName}, you are all caught up`
            : `${firstName}, you have ${tasks.length} thing${tasks.length === 1 ? '' : 's'} to do`}
        </h1>
        <p className="mt-1 text-sm text-[var(--color-muted)]">
          {tasks.length === 0
            ? 'Nothing is waiting on you. Anything new will appear here first.'
            : `${blocking} ${blocking === 1 ? 'is' : 'are'} holding up a month-end close · ${usd(exposure.total, { compact: true })} at stake`}
        </p>
        {intro && <p className="mt-2 max-w-2xl text-sm text-[var(--color-muted)]">{intro}</p>}
      </div>

      {first && firstException && (
        <section>
          <h2 className="mb-2 text-[11px] font-medium uppercase tracking-wide text-[var(--color-muted)]">
            Start here
          </h2>
          <ExceptionCard
            exception={firstException}
            task={first}
            decisions={state.decisions.filter((d) => d.exceptionId === firstException.id)}
            ruleDescription={ruleDescription(firstException.ruleId)}
            forecastTargets={
              firstException.projectId
                ? forecastTargetsFor(state.current.metricsByProject.get(firstException.projectId)!, firstException)
                : []
            }
            projectName={
              firstException.projectId
                ? model.index.projectById.get(firstException.projectId)?.name
                : 'Company-wide'
            }
            ownerName={persona.name}
            viewer={persona}
          />
        </section>
      )}

      {rest.length > 0 && (
        <Card title="Then" subtitle="In order of what matters most — each opens on the project it belongs to">
          <ol className="divide-y divide-[var(--color-line)]">
            {rest.map((task, i) => {
              const exception = exceptionById.get(task.exceptionId);
              if (!exception) return null;
              const project = exception.projectId
                ? model.index.projectById.get(exception.projectId)
                : undefined;
              const href = exception.projectId
                ? `/projects/${exception.projectId}?tab=${tabFor(task.workstream)}#${exception.id}`
                : `/work-queue?role=${encodeURIComponent(persona.role)}`;
              return (
                <li key={task.id} className="flex items-baseline gap-3 py-2.5 text-sm">
                  <span className="tabular w-5 shrink-0 text-xs text-[var(--color-muted)]">{i + 2}.</span>
                  <div className="min-w-0 flex-1">
                    <Link href={href} className="font-medium hover:underline">
                      {exception.title}
                    </Link>
                    <div className="text-xs text-[var(--color-muted)]">
                      {project?.name ?? 'Company-wide'}
                      {task.blocking && (
                        <span className="ml-2 text-[var(--color-blocking)]">Blocks close</span>
                      )}
                    </div>
                  </div>
                  {exception.impact !== null && exception.impactUnit === 'USD' && (
                    <span className="tabular shrink-0 text-sm font-medium">{usd(exception.impact)}</span>
                  )}
                </li>
              );
            })}
          </ol>
        </Card>
      )}

      {tasks.length === 0 && <Empty>Nothing on your desk.</Empty>}
    </div>
  );
}
