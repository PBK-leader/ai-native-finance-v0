/**
 * The audit trail: agent actions and human decisions, in the order they happened.
 *
 * This is the visible form of the agent loop — observe, detect, open a task, route it, wait, incorporate the
 * answer, recompute, resolve or escalate. It is not a log written alongside the state; it *is* the state,
 * replayed. Every entry was emitted by the agent that took the action.
 */

import type { EngineState } from '@/workflows/replay';
import type { ProjectId } from '@/domain/ids';
import { Empty } from './ui';
import { usd } from './format';

const ACTION_LABEL: Record<string, string> = {
  OBSERVED: 'Observed',
  EXCEPTION_DETECTED: 'Detected',
  TASK_CREATED: 'Opened task',
  TASK_ROUTED: 'Routed',
  RESPONSE_INCORPORATED: 'Incorporated response',
  ANALYSIS_RERUN: 'Recomputed',
  EXCEPTION_CLEARED: 'Cleared',
  ESCALATED: 'Escalated',
  CLOSE_STATUS_CHANGED: 'Close status changed',
};

const ACTION_TONE: Record<string, string> = {
  EXCEPTION_DETECTED: 'text-[var(--color-high)]',
  ESCALATED: 'text-[var(--color-blocking)]',
  EXCEPTION_CLEARED: 'text-[var(--color-ok)]',
  CLOSE_STATUS_CHANGED: 'text-[var(--color-accent)]',
};

export function ActivityTrail({
  state, agentNames, projectId, limit = 200,
}: {
  state: EngineState;
  /** Supplied by the route, so this component does not reach up into the agent layer for a label. */
  agentNames: Record<string, string>;
  projectId?: ProjectId;
  limit?: number;
}) {
  const entries = state.activity.filter((entry) => {
    if (!projectId) return true;
    return entry.kind === 'agent'
      ? entry.action.projectId === projectId
      : entry.decision.subject.projectId === projectId;
  });

  if (entries.length === 0) {
    return <Empty>No activity yet on this project.</Empty>;
  }

  // Newest first: the reader wants to know what just happened.
  const ordered = [...entries].reverse().slice(0, limit);

  return (
    <ol className="space-y-3">
      {ordered.map((entry, index) => {
        if (entry.kind === 'decision') {
          const { decision } = entry;
          return (
            <li
              key={`${decision.id}-${index}`}
              className="rounded border border-[var(--color-accent)] bg-blue-50/40 px-4 py-2.5"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="text-xs font-semibold text-[var(--color-accent)]">
                  Human decision — {decision.actor.role}
                </span>
                <span className="text-[11px] text-[var(--color-muted)]">
                  Step {entry.step} · effective {decision.effectiveDate}
                </span>
              </div>
              <p className="mt-1 text-sm">{describe(decision)}</p>
            </li>
          );
        }

        const { action } = entry;
        return (
          <li key={`${action.id}-${index}`} className="flex gap-3 px-1">
            <div className="w-40 shrink-0 text-xs text-[var(--color-muted)]">
              {agentNames[action.agentId] ?? action.agentId}
            </div>
            <div className="min-w-0 flex-1">
              <span className={`text-xs font-medium ${ACTION_TONE[action.type] ?? ''}`}>
                {ACTION_LABEL[action.type] ?? action.type}
              </span>
              <span className="ml-2 text-sm">{action.summary}</span>
            </div>
            <div className="w-14 shrink-0 text-right text-[11px] text-[var(--color-muted)]">
              Step {action.step}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function describe(decision: EngineState['decisions'][number]): string {
  const p = decision.payload;
  switch (p.type) {
    case 'PM_FORECAST_UPDATE':
      return p.lines
        .map(
          (line) =>
            `Updated ${line.costCode}: ${usd(line.remainingUncommittedCost)} remaining cost` +
            (line.remainingLaborHours !== null
              ? `, ${line.remainingLaborHours.toLocaleString('en-US')} hours`
              : '') +
            `. ${line.comment}`,
        )
        .join(' ');
    case 'PM_ANSWER':
      return p.answer;
    case 'ACCEPT_ADJUSTMENT':
      return `Accepted a ${usd(p.amount)} ${p.adjustmentType.replaceAll('_', ' ').toLowerCase()} adjustment. ${p.note}`;
    case 'REJECT_ADJUSTMENT':
      return `Declined the proposed adjustment: ${p.reason}`;
    case 'RECORD_SOV_CORRECTION':
      return `Added ${usd(p.scheduledValue)} to the schedule of values for the approved change order.`;
    case 'ESCALATE':
      return `Escalated to Controller: ${p.reason}`;
    case 'ACCEPT_RISK':
      return `Accepted the risk and proceeded: ${p.rationale}`;
    case 'CONTROLLER_APPROVE':
      return `Approved for close. ${p.note}`;
  }
}
