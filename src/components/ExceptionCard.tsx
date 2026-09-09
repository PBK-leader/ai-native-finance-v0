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
import type { SourceRef } from '@/domain/entities';
import type { ExceptionRecord, ReviewDecision, Task } from '@/domain/workflow';
import type { ForecastTarget } from '@/workflows/forecastTargets';
import { measure, statusLabel, usd } from './format';
import { PERSONAS, type Persona } from './persona';
import { describeThreshold, thresholdOutcome } from './thresholdLabels';
import { fieldList, recordKind, systemLabel } from './sourceVocabulary';
import { BlockingTag, SeverityTag, StatusTag } from './ui';
import { ResolveForm } from './ResolveForm';

/**
 * How many source records to name before summarising the rest.
 *
 * Some findings cite hundreds — every posting on an unmapped cost code, every late timecard. Naming twelve
 * and counting the remainder is what a person can actually read; the full list is a scroll bar, not evidence.
 */
const RECORD_LIMIT = 12;

export function ExceptionCard({
  exception,
  task,
  decisions,
  ruleDescription,
  ruleMethod,
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
  /** The rule's own account of how it reaches a finding, step by step. */
  ruleMethod: readonly string[];
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

  // One line per record. A rule that cites the same document twice — once for the fields it compared and once
  // for the fields it summed — is one record a reader has to look at, not two.
  const records = dedupeByRecord(exception.evidence.sourceRefs);
  const sourceFiles = [...new Set(exception.evidence.sourceRefs.map((ref) => ref.file))];

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
                ownerName={ownerName}
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
            How we worked this out
          </summary>
          <div className="mt-3 space-y-4 rounded border border-[var(--color-line)] bg-[var(--color-canvas)] px-4 py-3">
            {ruleMethod.length > 0 && (
              <Section title="The steps we took">
                <ol className="space-y-1.5">
                  {ruleMethod.map((step, i) => (
                    // Position, not text: two steps that happen to read alike would collide as keys.
                    <li key={i} className="flex gap-2.5">
                      <span className="tabular mt-px shrink-0 text-[var(--color-muted)]">{i + 1}.</span>
                      <span className="leading-relaxed">{step}</span>
                    </li>
                  ))}
                </ol>
              </Section>
            )}

            {exception.evidence.measured.length > 0 && (
              <Section title="What that came to">
                <dl className="grid grid-cols-2 gap-x-6 gap-y-1 sm:grid-cols-3 lg:grid-cols-4">
                  {exception.evidence.measured.map((m) => (
                    <div key={m.label}>
                      <dt className="text-xs text-[var(--color-muted)]">{m.label}</dt>
                      <dd className="tabular text-sm font-medium">{measure(m.value, m.unit)}</dd>
                    </div>
                  ))}
                </dl>
              </Section>
            )}

            {exception.evidence.thresholds.length > 0 && (
              <Section title="Why that was enough to raise it">
                <ul className="space-y-1">
                  {exception.evidence.thresholds.map((t) => {
                    // A tolerance is breached when it is *not* met, so the tick follows the finding rather
                    // than the flag.
                    const triggered = t.comparator === 'LTE' || t.comparator === 'LT' ? !t.met : t.met;
                    return (
                      <li key={t.name} className="flex gap-2">
                        <span className={triggered ? 'text-[var(--color-high)]' : 'text-[var(--color-muted)]'}>
                          {triggered ? '✓' : '—'}
                        </span>
                        <span>
                          {describeThreshold(t)}
                          <span className="text-[var(--color-muted)]">
                            {' — '}
                            {thresholdOutcome(t.comparator, t.met)}
                          </span>
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </Section>
            )}

            {records.length > 0 && (
              <Section title={records.length === 1 ? 'The record we read' : `The ${records.length} records we read`}>
                <ul className="max-h-56 space-y-1.5 overflow-y-auto">
                  {records.slice(0, RECORD_LIMIT).map((ref) => (
                    <li key={`${ref.file}-${ref.recordId}`}>
                      <span className="font-medium text-[var(--color-ink)]">
                        {recordKind(ref.file)} {ref.recordId}
                      </span>
                      <span className="text-[var(--color-muted)]"> — from {systemLabel(ref.system)}</span>
                      {ref.fields && ref.fields.length > 0 && (
                        <span className="text-[var(--color-muted)]">
                          . We read {fieldList(ref.fields)}.
                        </span>
                      )}
                    </li>
                  ))}
                  {records.length > RECORD_LIMIT && (
                    <li className="text-[var(--color-muted)]">
                      …and {records.length - RECORD_LIMIT} more of the same kind.
                    </li>
                  )}
                </ul>
              </Section>
            )}

            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-[var(--color-line)] pt-2 text-[11px] text-[var(--color-muted)]">
              <SeverityTag severity={exception.severity} />
              <span>{ruleDescription}</span>
              <span title="The internal name of this check, and the files it read — for anyone auditing the software rather than the finding.">
                <code>{exception.ruleId}</code>
                {sourceFiles.length > 0 && <> · {sourceFiles.join(', ')}</>}
              </span>
            </div>
          </div>
        </details>
      </div>
    </article>
  );
}

/** A labelled step in the derivation. The heading is a plain sentence fragment, not a category name. */
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h4 className="mb-1.5 text-[11px] font-medium text-[var(--color-muted)]">{title}</h4>
      {children}
    </div>
  );
}

/**
 * One entry per underlying document, merging the fields cited across every reference to it.
 *
 * Several rules push the same record twice — a change order appears once for the comparison and again as part
 * of a project roll-up. Listing it twice makes the evidence look padded and invites the reader to think two
 * documents are involved when only one is.
 */
function dedupeByRecord(refs: readonly SourceRef[]): SourceRef[] {
  const byKey = new Map<string, SourceRef>();

  for (const ref of refs) {
    const key = `${ref.file}|${ref.recordId}`;
    const seen = byKey.get(key);

    if (!seen) {
      byKey.set(key, ref);
      continue;
    }

    if (ref.fields && ref.fields.length > 0) {
      byKey.set(key, { ...seen, fields: [...new Set([...(seen.fields ?? []), ...ref.fields])] });
    }
  }

  return [...byKey.values()];
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
