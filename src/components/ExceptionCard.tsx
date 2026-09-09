/**
 * The exception card — the unit of work in this product.
 *
 * `CLAUDE.md`'s evidence rule says every exception must answer eight questions, and this component still
 * honours all of them — but in the order a person needs them, not the order an auditor does. Front:
 * what happened, how much, why it matters, and what to do about it. Behind one "show the evidence"
 * control: the measured values, the thresholds, the source records, the rule and its severity. Nothing is
 * removed; the technical layer is one click away instead of in the way.
 */

import Link from 'next/link';
import { isSettled } from '@/domain/workflow';
import type { ExceptionRecord, ReviewDecision, Task } from '@/domain/workflow';
import type { ForecastTarget } from '@/workflows/forecastTargets';
import { measure, statusLabel, usd } from './format';
import { PERSONAS, type Persona } from './persona';
import { describeThreshold } from './thresholdLabels';
import { BlockingTag, SeverityTag, StatusTag } from './ui';
import { ResolveForm } from './ResolveForm';

export function ExceptionCard({
  exception,
  task,
  decisions,
  ruleDescription,
  projectName,
  ownerName,
  viewer,
  showResolve = true,
  suppressedByTitle,
  forecastTargets,
}: {
  exception: ExceptionRecord;
  task?: Task;
  decisions: ReviewDecision[];
  ruleDescription: string;
  projectName?: string;
  /** The person the task is routed to, so the card can say "waiting on Jamie" rather than a role. */
  ownerName?: string;
  /** Who is looking, so the next step reads "your next step" when it is theirs. */
  viewer?: Persona;
  showResolve?: boolean;
  suppressedByTitle?: string;
  forecastTargets?: ForecastTarget[];
}) {
  const settled = task ? isSettled(task.status) : false;
  const isMine = !!task && !!viewer && task.ownerPersonId === viewer.personId;
  const owner = ownerName ?? task?.ownerRole;
  // The form must render for the same person on the server and in the browser, or React reports a
  // hydration mismatch; the server default is the accountant, so that is the fallback here too.
  const actor = viewer ?? PERSONAS.accountant;

  return (
    <article
      id={exception.id}
      className={`scroll-mt-24 rounded-lg border bg-[var(--color-surface)] ${
        exception.blocking && !settled ? 'border-red-200' : 'border-[var(--color-line)]'
      }`}
    >
      <header className="flex flex-wrap items-start gap-x-3 gap-y-2 border-b border-[var(--color-line)] px-5 py-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            {exception.blocking && <BlockingTag blocking />}
            {task && <StatusTag status={task.status} />}
            {!exception.currentlyTriggering && (
              <span className="rounded bg-slate-50 px-1.5 py-0.5 text-[11px] text-[var(--color-muted)] ring-1 ring-inset ring-slate-200">
                No longer an issue
              </span>
            )}
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
                'Company-wide — not tied to one project'
              )}
            </p>
          )}
        </div>

        {/* 3. How much is affected */}
        {exception.impact !== null && (
          <div className="text-right">
            <div className="text-xs text-[var(--color-muted)]">At stake</div>
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
            Nothing to do yet — this is held behind a bigger issue:{' '}
            <span className="font-medium">{suppressedByTitle}</span>. It will open automatically once that is
            resolved.
          </p>
        )}

        {/* 5 & 6. Who should act, and what they should do — first, not last */}
        {task && (
          <div
            className={`rounded border px-4 py-3 ${
              isMine && !settled
                ? 'border-[var(--color-accent)] bg-blue-50/40'
                : 'border-[var(--color-line)] bg-[var(--color-canvas)]'
            }`}
          >
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h4 className="text-xs font-medium">
                {settled ? 'What was done' : isMine ? 'Your next step' : `Next step — waiting on ${owner}`}
              </h4>
              <span className="text-xs text-[var(--color-muted)]">{statusLabel(task.status)}</span>
            </div>
            <p className="mt-1 text-sm">{task.requestedAction}</p>

            {showResolve && !settled && (
              <ResolveForm
                key={task.id}
                task={task}
                exception={exception}
                forecastTargets={forecastTargets}
                viewer={actor}
              />
            )}
          </div>
        )}

        {/* 8. What has happened so far */}
        {decisions.length > 0 && (
          <ol className="space-y-2 border-l-2 border-[var(--color-line)] pl-4">
            {decisions.map((decision) => (
              <li key={decision.id} className="text-xs">
                <div className="font-medium">
                  {decisionTitle(decision)} — {decision.actor.role}
                </div>
                <div className="text-[var(--color-muted)]">{describeDecision(decision)}</div>
                <div className="text-[var(--color-muted)]">Effective {decision.effectiveDate}</div>
              </li>
            ))}
          </ol>
        )}

        {/* 4 & 7. What proves it, and how serious the rule considers it */}
        <details className="group text-xs">
          <summary className="cursor-pointer select-none text-[var(--color-accent)] hover:underline">
            Show the evidence
          </summary>
          <div className="mt-3 space-y-3 rounded border border-[var(--color-line)] bg-[var(--color-canvas)] px-4 py-3">
            {exception.evidence.measured.length > 0 && (
              <dl className="grid grid-cols-2 gap-x-6 gap-y-1 sm:grid-cols-3 lg:grid-cols-4">
                {exception.evidence.measured.map((m) => (
                  <div key={m.label}>
                    <dt className="text-xs text-[var(--color-muted)]">{m.label}</dt>
                    <dd className="tabular text-sm font-medium">{measure(m.value, m.unit)}</dd>
                  </div>
                ))}
              </dl>
            )}

            {exception.evidence.thresholds.length > 0 && (
              <div>
                <h4 className="text-[11px] font-medium uppercase tracking-wide text-[var(--color-muted)]">
                  The test that fired
                </h4>
                <div className="mt-1 flex flex-wrap gap-2 text-[11px]">
                  {exception.evidence.thresholds.map((t) => (
                    <span
                      key={t.name}
                      className={`rounded px-1.5 py-0.5 ring-1 ring-inset ${
                        t.met
                          ? 'bg-red-50 text-[var(--color-high)] ring-red-200'
                          : 'bg-slate-50 text-[var(--color-muted)] ring-slate-200'
                      }`}
                      title={`${t.name} — ${t.met ? 'breached' : 'not breached'}`}
                    >
                      {describeThreshold(t)}
                      {t.met ? ' ✓' : ''}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {exception.evidence.sourceRefs.length > 0 && (
              <div>
                <h4 className="text-[11px] font-medium uppercase tracking-wide text-[var(--color-muted)]">
                  Source records ({exception.evidence.sourceRefs.length})
                </h4>
                <ul className="mt-1 max-h-48 space-y-1 overflow-y-auto">
                  {exception.evidence.sourceRefs.slice(0, 60).map((ref, i) => (
                    <li key={`${ref.recordId}-${i}`} className="flex flex-wrap gap-2 text-[var(--color-muted)]">
                      <span className="rounded bg-[var(--color-surface)] px-1 font-medium text-[var(--color-ink)]">
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
              </div>
            )}

            <div className="flex flex-wrap items-center gap-2 border-t border-[var(--color-line)] pt-2 text-[11px] text-[var(--color-muted)]">
              <SeverityTag severity={exception.severity} />
              <span>Rule: {ruleDescription}</span>
              <code>{exception.ruleId}</code>
            </div>
          </div>
        </details>
      </div>
    </article>
  );
}

function decisionTitle(decision: ReviewDecision): string {
  switch (decision.payload.type) {
    case 'PM_FORECAST_UPDATE':
      return 'Forecast updated';
    case 'PM_ANSWER':
      return 'Answered';
    case 'ACCEPT_ADJUSTMENT':
      return 'Adjustment accepted';
    case 'REJECT_ADJUSTMENT':
      return 'No adjustment needed';
    case 'RECORD_SOV_CORRECTION':
      return 'Schedule of values corrected';
    case 'ESCALATE':
      return 'Escalated';
    case 'ACCEPT_RISK':
      return 'Risk accepted';
    case 'CONTROLLER_APPROVE':
      return 'Approved for close';
  }
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
