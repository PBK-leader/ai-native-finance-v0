/**
 * The exception card — the unit of work in this product.
 *
 * `CLAUDE.md`'s evidence rule says every exception must answer eight questions, and this component is where
 * that is honoured. In order: what happened (title), why it matters (explanation), how much (impact),
 * what proves it (measured values, thresholds, source records), who should act (owner), what they should do
 * (requested action), whether it blocks the close (tag), and where it stands (status).
 *
 * A dashboard that shows a number without those answers just moves the investigation somewhere else.
 */

import Link from 'next/link';
import type { ExceptionRecord, ReviewDecision, Task } from '@/domain/workflow';
import type { ForecastTarget } from '@/workflows/forecastTargets';
import { measure, statusLabel, usd } from './format';
import { BlockingTag, SeverityTag, StatusTag } from './ui';
import { ResolveForm } from './ResolveForm';

export function ExceptionCard({
  exception,
  task,
  decisions,
  ruleDescription,
  projectName,
  showResolve = true,
  suppressedByTitle,
  forecastTargets,
}: {
  exception: ExceptionRecord;
  task?: Task;
  decisions: ReviewDecision[];
  ruleDescription: string;
  projectName?: string;
  showResolve?: boolean;
  suppressedByTitle?: string;
  forecastTargets?: ForecastTarget[];
}) {
  const settled = task ? task.status === 'RESOLVED' || task.status === 'ACCEPTED_RISK' : false;

  return (
    <article
      className={`rounded-lg border bg-[var(--color-surface)] ${
        exception.blocking && !settled
          ? 'border-red-200'
          : 'border-[var(--color-line)]'
      }`}
    >
      <header className="flex flex-wrap items-start gap-x-3 gap-y-2 border-b border-[var(--color-line)] px-5 py-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <SeverityTag severity={exception.severity} />
            <BlockingTag blocking={exception.blocking} />
            {task && <StatusTag status={task.status} />}
            {!exception.currentlyTriggering && (
              <span className="rounded bg-slate-50 px-1.5 py-0.5 text-[11px] text-[var(--color-muted)] ring-1 ring-inset ring-slate-200">
                No longer triggering
              </span>
            )}
            <code className="text-[11px] text-[var(--color-muted)]">{exception.ruleId}</code>
          </div>

          {/* 1. What happened */}
          <h3 className="mt-1.5 text-sm font-semibold">{exception.title}</h3>

          {projectName && (
            <p className="mt-0.5 text-xs text-[var(--color-muted)]">
              {exception.projectId ? (
                <Link href={`/projects/${exception.projectId}`} className="hover:underline">
                  {projectName}
                </Link>
              ) : (
                'Portfolio level'
              )}
            </p>
          )}
        </div>

        {/* 3. How much is affected */}
        {exception.impact !== null && (
          <div className="text-right">
            <div className="text-xs text-[var(--color-muted)]">Impact</div>
            <div className="tabular text-lg font-semibold">
              {exception.impactUnit === 'USD'
                ? usd(exception.impact)
                : measure(exception.impact, exception.impactUnit ?? 'COUNT')}
            </div>
          </div>
        )}
      </header>

      <div className="space-y-4 px-5 py-4">
        {/* 2. Why it matters */}
        <p className="text-sm leading-relaxed">{exception.explanation}</p>

        {suppressedByTitle && (
          <p className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-[var(--color-medium)]">
            No task has been opened for this yet — it is held behind a higher-priority issue:{' '}
            <span className="font-medium">{suppressedByTitle}</span>. It will be released automatically once
            that is resolved.
          </p>
        )}

        {/* 4. What proves it */}
        {exception.evidence.measured.length > 0 && (
          <div>
            <h4 className="text-xs font-medium text-[var(--color-muted)]">Evidence</h4>
            <dl className="mt-1.5 grid grid-cols-2 gap-x-6 gap-y-1 sm:grid-cols-3 lg:grid-cols-4">
              {exception.evidence.measured.map((m) => (
                <div key={m.label}>
                  <dt className="text-xs text-[var(--color-muted)]">{m.label}</dt>
                  <dd className="tabular text-sm font-medium">{measure(m.value, m.unit)}</dd>
                </div>
              ))}
            </dl>
          </div>
        )}

        {exception.evidence.thresholds.length > 0 && (
          <div className="flex flex-wrap gap-2 text-[11px]">
            {exception.evidence.thresholds.map((t) => (
              <span
                key={t.name}
                className={`rounded px-1.5 py-0.5 ring-1 ring-inset ${
                  t.met
                    ? 'bg-red-50 text-[var(--color-high)] ring-red-200'
                    : 'bg-slate-50 text-[var(--color-muted)] ring-slate-200'
                }`}
                title={t.met ? 'This threshold was breached' : 'This threshold was not breached'}
              >
                {t.name} {t.comparator === 'GTE' ? '≥' : '≤'} {t.value.toLocaleString('en-US')}
                {t.met ? ' ✓' : ''}
              </span>
            ))}
          </div>
        )}

        {exception.evidence.sourceRefs.length > 0 && (
          <details className="text-xs">
            <summary className="cursor-pointer text-[var(--color-muted)]">
              Source records ({exception.evidence.sourceRefs.length})
            </summary>
            <ul className="mt-2 max-h-48 space-y-1 overflow-y-auto">
              {exception.evidence.sourceRefs.slice(0, 60).map((ref, i) => (
                <li key={`${ref.recordId}-${i}`} className="flex flex-wrap gap-2 text-[var(--color-muted)]">
                  <span className="rounded bg-[var(--color-canvas)] px-1 font-medium text-[var(--color-ink)]">
                    {ref.recordId}
                  </span>
                  <span>{ref.system}</span>
                  <span className="font-mono">{ref.file}</span>
                  {ref.fields && <span>({ref.fields.join(', ')})</span>}
                </li>
              ))}
              {exception.evidence.sourceRefs.length > 60 && (
                <li className="text-[var(--color-muted)]">
                  …and {exception.evidence.sourceRefs.length - 60} more
                </li>
              )}
            </ul>
          </details>
        )}

        <p className="text-[11px] text-[var(--color-muted)]">Rule: {ruleDescription}</p>

        {/* 5 & 6. Who should act, and what they should do */}
        {task && (
          <div className="rounded border border-[var(--color-line)] bg-[var(--color-canvas)] px-4 py-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h4 className="text-xs font-medium">
                Next action — {task.ownerRole}
                {task.ownerPersonId ? '' : ''}
              </h4>
              <span className="text-xs text-[var(--color-muted)]">{statusLabel(task.status)}</span>
            </div>
            <p className="mt-1 text-sm">{task.requestedAction}</p>

            {showResolve && !settled && (
              <ResolveForm task={task} exception={exception} forecastTargets={forecastTargets} />
            )}
          </div>
        )}

        {/* 8. What has happened so far */}
        {decisions.length > 0 && (
          <ol className="space-y-2 border-l-2 border-[var(--color-line)] pl-4">
            {decisions.map((decision) => (
              <li key={decision.id} className="text-xs">
                <div className="font-medium">
                  {decision.payload.type.replaceAll('_', ' ').toLowerCase()} — {decision.actor.role}
                </div>
                <div className="text-[var(--color-muted)]">{describeDecision(decision)}</div>
                <div className="text-[var(--color-muted)]">Effective {decision.effectiveDate}</div>
              </li>
            ))}
          </ol>
        )}
      </div>
    </article>
  );
}

/** Plain-English rendering of what a human actually said. */
function describeDecision(decision: ReviewDecision): string {
  const p = decision.payload;
  switch (p.type) {
    case 'PM_FORECAST_UPDATE':
      return p.lines
        .map((line) => `${line.costCode}: ${usd(line.remainingUncommittedCost)} remaining. ${line.comment}`)
        .join(' ');
    case 'PM_ANSWER':
      return p.answer;
    case 'ACCEPT_ADJUSTMENT':
      return `Accepted ${usd(p.amount)} (${p.adjustmentType.replaceAll('_', ' ').toLowerCase()}). ${p.note}`;
    case 'REJECT_ADJUSTMENT':
      return p.reason;
    case 'RECORD_SOV_CORRECTION':
      return `Added ${usd(p.scheduledValue)} to the schedule of values at ${p.retainagePct}% retainage.`;
    case 'ESCALATE':
      return p.reason;
    case 'ACCEPT_RISK':
      return `Risk accepted: ${p.rationale}`;
    case 'CONTROLLER_APPROVE':
      return p.note || 'Approved for close.';
  }
}
