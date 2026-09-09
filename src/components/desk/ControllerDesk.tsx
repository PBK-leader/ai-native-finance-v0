/**
 * The Controller's desk: what needs their signature, then what needs their eye, then the portfolio.
 *
 * A Controller review exists because a human answer moved the numbers materially. Nothing reaches the books
 * without one, so those sit above everything else.
 */

import Link from 'next/link';
import type { CanonicalModel, Role } from '@/domain/entities';
import type { Task } from '@/domain/workflow';
import type { EngineState } from '@/workflows/replay';
import { ruleDescription } from '@/workflows/replay';
import { forecastTargetsFor } from '@/workflows/forecastTargets';
import { Card } from '@/components/ui';
import { ExceptionCard } from '@/components/ExceptionCard';
import { usd } from '@/components/format';
import type { Persona } from '@/components/persona';
import { CommandCenter } from './CommandCenter';
import { tabFor } from './TaskDesk';

/**
 * Does this item need the Controller to decide something, or is it just theirs to watch?
 *
 * Status cannot answer it — every Controller-routed task carries `WAITING_FOR_CONTROLLER`. Two things can:
 * the item holds the close, or somebody handed it up (the rule routed it elsewhere and an escalation brought
 * it here). Exported as a pure function so the split is testable without rendering.
 */
export function needsControllerDecision(task: Task, routedTo: Role | undefined): boolean {
  return task.blocking || (routedTo !== undefined && routedTo !== 'Controller');
}

export function ControllerDesk({
  persona, tasks, state, model,
}: {
  persona: Persona;
  /** Already prioritised by `openTasksForPerson`. */
  tasks: Task[];
  state: EngineState;
  model: CanonicalModel;
}) {
  const firstName = persona.name.split(' ')[0];
  const exceptionById = new Map(state.current.exceptions.map((e) => [e.id, e]));
  const needsDecision = (t: Task) =>
    needsControllerDecision(t, exceptionById.get(t.exceptionId)?.ownerRole);
  const signOff = tasks.filter(needsDecision);
  const review = tasks.filter((t) => !needsDecision(t));

  return (
    <div className="space-y-8">
      <div className="space-y-6">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">
            {signOff.length === 0
              ? `${firstName}, nothing needs your decision before close`
              : `${firstName}, ${signOff.length} item${signOff.length === 1 ? '' : 's'} need${signOff.length === 1 ? 's' : ''} your decision before close`}
          </h1>
          <p className="mt-1 text-sm text-[var(--color-muted)]">
            {signOff.length === 0
              ? 'Something appears here whenever a human answer moves a forecast enough to need sign-off, or an accountant escalates a judgement call.'
              : 'Each of these holds a month-end close until you act. Approve it, or accept the risk in writing — either way it stays in the record.'}
            {review.length > 0 && ` ${review.length} more item${review.length === 1 ? ' is' : 's are'} on your radar below.`}
          </p>
        </div>

        {signOff.map((task) => {
          const exception = exceptionById.get(task.exceptionId);
          if (!exception) return null;
          return (
            <ExceptionCard
              key={task.id}
              exception={exception}
              task={task}
              decisions={state.decisions.filter((d) => d.exceptionId === exception.id)}
              ruleDescription={ruleDescription(exception.ruleId)}
              forecastTargets={
                exception.projectId
                  ? forecastTargetsFor(state.current.metricsByProject.get(exception.projectId)!, exception)
                  : []
              }
              projectName={
                exception.projectId ? model.index.projectById.get(exception.projectId)?.name : 'Company-wide'
              }
              ownerName={persona.name}
              viewer={persona}
            />
          );
        })}

        {review.length > 0 && (
          <Card title="On your radar" subtitle="Serious, but not holding up the close — worth a look this month">
            <ol className="divide-y divide-[var(--color-line)]">
              {review.map((task) => {
                const exception = exceptionById.get(task.exceptionId);
                if (!exception) return null;
                const project = exception.projectId
                  ? model.index.projectById.get(exception.projectId)
                  : undefined;
                const href = exception.projectId
                  ? `/projects/${exception.projectId}?tab=${tabFor(task.workstream)}#${exception.id}`
                  : '/work-queue?role=Controller';
                return (
                  <li key={task.id} className="flex items-baseline gap-3 py-2.5 text-sm">
                    <div className="min-w-0 flex-1">
                      <Link href={href} className="font-medium hover:underline">{exception.title}</Link>
                      <div className="text-xs text-[var(--color-muted)]">{project?.name ?? 'Company-wide'}</div>
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
      </div>

      <CommandCenter state={state} model={model} title="Where the close stands" />
    </div>
  );
}
