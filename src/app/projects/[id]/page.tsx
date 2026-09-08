/**
 * Project 360 — everything about one job, in the order a finance person asks about it.
 *
 * Overview says where the job stands. Forecast/WIP shows how the estimate got there and what moved since the
 * prior close. AP & Cost Control shows the cost that is disputed, missing or duplicated. Billing & Change
 * Orders shows what is contracted versus what is billable. Activity is the audit trail.
 */

import Link from 'next/link';
import { notFound } from 'next/navigation';
import { V0_CONFIG } from '@/config/v0Config';
import { canonical, engineState } from '@/workflows/engine';
import { ruleDescription } from '@/workflows/replay';
import { forecastTargetsFor } from '@/workflows/forecastTargets';
import { computeMovement } from '@/calculations/projectMetrics';
import { AGENTS } from '@/agents/agents';
import { projectId as toProjectId } from '@/domain/ids';
import { isSettled } from '@/domain/workflow';
import { Card, CloseReadyTag, Empty, Metric, Td, Th } from '@/components/ui';
import { ExceptionCard } from '@/components/ExceptionCard';
import { ActivityTrail } from '@/components/ActivityTrail';
import { pct, ratioPct, signedUsd, usd } from '@/components/format';

export const dynamic = 'force-dynamic';

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'forecast', label: 'Forecast & WIP' },
  { id: 'ap', label: 'AP & Cost Control' },
  { id: 'billing', label: 'Billing & Change Orders' },
  { id: 'activity', label: 'Activity' },
] as const;

type Tab = (typeof TABS)[number]['id'];

export default async function Project360({
  params, searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const { id } = await params;
  const { tab: rawTab } = await searchParams;
  const tab: Tab = (TABS.find((t) => t.id === rawTab)?.id ?? 'overview') as Tab;

  const state = engineState();
  const model = canonical();
  const projectId = toProjectId(id);
  const project = model.index.projectById.get(projectId);
  if (!project) notFound();

  const metrics = state.current.metricsByProject.get(projectId)!;
  const prior = state.prior.get(projectId)!;
  const readiness = state.current.closeReadiness.get(projectId);
  const manager = model.index.personById.get(project.projectManagerId);

  const exceptions = state.current.exceptions.filter((e) => e.projectId === projectId);
  const tasksByException = new Map(state.current.tasks.map((t) => [t.exceptionId, t]));

  // Computed in the calculation layer, not here — the same function the Close Orchestrator uses to decide
  // whether a change needs Controller review, so the screen and the control cannot disagree.
  const movement = computeMovement(metrics, prior);
  const eacChange = movement.eacChange;
  const marginMove = movement.marginMovementPercentagePoints;

  const renderExceptions = (predicate: (workstream: string) => boolean) => {
    const matching = exceptions.filter((e) => predicate(e.workstream));
    if (matching.length === 0) return <Empty>Nothing outstanding in this area.</Empty>;

    return (
      <div className="space-y-4">
        {matching
          .slice()
          .sort(
            (a, b) =>
              Number(b.blocking) - Number(a.blocking) ||
              Number(b.currentlyTriggering) - Number(a.currentlyTriggering) ||
              (b.impact ?? 0) - (a.impact ?? 0),
          )
          .map((exception) => (
            <ExceptionCard
              key={exception.id}
              exception={exception}
              task={tasksByException.get(exception.id)}
              decisions={state.decisions.filter((d) => d.exceptionId === exception.id)}
              ruleDescription={ruleDescription(exception.ruleId)}
              forecastTargets={forecastTargetsFor(metrics, exception)}
              suppressedByTitle={
                exception.suppressedBy
                  ? exceptions.find((e) => e.id === exception.suppressedBy)?.title
                  : undefined
              }
            />
          ))}
      </div>
    );
  };

  return (
    <div className="space-y-6">
      <div>
        <Link href="/" className="text-xs text-[var(--color-muted)] hover:underline">
          ← Command Center
        </Link>
        <div className="mt-1 flex flex-wrap items-center gap-3">
          <h1 className="text-xl font-semibold tracking-tight">{project.name}</h1>
          <CloseReadyTag ready={readiness?.ready ?? false} />
        </div>
        <p className="mt-1 text-sm text-[var(--color-muted)]">
          {project.customerName} · {project.trade} · {id} · PM {manager?.name ?? '—'}
        </p>
        <p className="mt-2 max-w-2xl text-sm">
          <span className="font-medium">What this answers:</span>{' '}
          <span className="text-[var(--color-muted)]">
            Will this job make the money we thought it would, is anything wrong with the cost, and can we
            bill for everything we have earned?
          </span>
        </p>
      </div>

      <nav className="flex flex-wrap gap-1 border-b border-[var(--color-line)]">
        {TABS.map((t) => (
          <Link
            key={t.id}
            href={`/projects/${id}?tab=${t.id}`}
            className={`-mb-px border-b-2 px-3 py-2 text-sm transition ${
              tab === t.id
                ? 'border-[var(--color-accent)] font-medium text-[var(--color-accent)]'
                : 'border-transparent text-[var(--color-muted)] hover:text-[var(--color-ink)]'
            }`}
          >
            {t.label}
          </Link>
        ))}
      </nav>

      {tab === 'overview' && (
        <div className="space-y-6">
          <Card title="Project economics" subtitle="Draft management view — not GAAP revenue recognition">
            <div className="grid grid-cols-2 gap-6 md:grid-cols-3 lg:grid-cols-6">
              <Metric label="Original contract" value={usd(project.originalContractValue, { compact: true })} />
              <Metric
                label="Revised contract"
                value={usd(metrics.revisedContractValue, { compact: true })}
                sub={`+${usd(metrics.approvedChangeOrderValue, { compact: true })} approved COs`}
              />
              <Metric label="Forecast final cost" value={usd(metrics.eac, { compact: true })} />
              <Metric
                label="Projected profit"
                value={usd(metrics.projectedProfit, { compact: true })}
                tone={metrics.projectedProfit < prior.projectedProfit ? 'warn' : 'good'}
              />
              <Metric
                label="Projected margin"
                value={pct(metrics.projectedMarginPct)}
                sub={`Original ${pct(metrics.originalMarginPct)}`}
                tone={
                  metrics.marginFadePercentagePoints !== null &&
                  metrics.marginFadePercentagePoints >= V0_CONFIG.thresholds.marginFadePercentagePoints
                    ? 'bad'
                    : 'default'
                }
              />
              <Metric
                label="Percent complete"
                value={pct(metrics.percentCompletePct)}
                sub="Cost-to-cost basis"
              />
            </div>
            {metrics.dataQualityError && (
              <p className="mt-4 rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-[var(--color-blocking)]">
                {metrics.dataQualityError}
              </p>
            )}
          </Card>

          <div className="grid gap-6 lg:grid-cols-2">
            <Card title="How the forecast is built" subtitle="Every dollar of forecast final cost">
              <dl className="space-y-2 text-sm">
                <Row label="Posted cost to date" value={usd(metrics.postedCost)} />
                {metrics.acceptedApUnposted > 0 && (
                  <Row label="+ Accepted AP not yet posted" value={usd(metrics.acceptedApUnposted)} adjusted />
                )}
                {metrics.acceptedRni > 0 && (
                  <Row label="+ Accepted received-not-invoiced" value={usd(metrics.acceptedRni)} adjusted />
                )}
                {metrics.acceptedUnpostedLabor > 0 && (
                  <Row label="+ Accepted unposted labour" value={usd(metrics.acceptedUnpostedLabor)} adjusted />
                )}
                <Row label="= Adjusted cost to date" value={usd(metrics.adjustedCostToDate)} strong />
                <Row label="+ Remaining commitments" value={usd(metrics.remainingCommitment)} />
                <Row label="+ PM remaining uncommitted" value={usd(metrics.pmRemainingUncommittedCost)} />
                <Row label="= Forecast final cost" value={usd(metrics.eac)} strong />
              </dl>
            </Card>

            <Card title="Movement since prior close" subtitle={`Reconstructed as at ${prior.asOfDate}`}>
              <div className="grid grid-cols-2 gap-6">
                <Metric
                  label="Forecast cost movement"
                  value={`${eacChange >= 0 ? '+' : '−'}${usd(Math.abs(eacChange), { compact: true })}`}
                  tone={eacChange > 0 ? 'bad' : 'good'}
                  sub={`${usd(prior.eac, { compact: true })} → ${usd(metrics.eac, { compact: true })}`}
                />
                <Metric
                  label="Margin movement"
                  value={marginMove === null ? 'n/a' : `${marginMove > 0 ? '+' : ''}${marginMove.toFixed(2)} pts`}
                  tone={marginMove !== null && marginMove < 0 ? 'bad' : 'good'}
                  sub={`${pct(prior.projectedMarginPct)} → ${pct(metrics.projectedMarginPct)}`}
                />
                <Metric
                  label="Billing position"
                  value={signedUsd(metrics.billingPosition)}
                  sub={metrics.billingPosition !== null && metrics.billingPosition < 0 ? 'Underbilled' : 'Overbilled'}
                  tone={metrics.billingPosition !== null && metrics.billingPosition < 0 ? 'warn' : 'default'}
                />
                <Metric
                  label="Open items"
                  value={String(
                    state.current.tasks.filter((t) => t.projectId === projectId && !isSettled(t.status)).length,
                  )}
                  sub={`${readiness?.blockingTaskIds.length ?? 0} blocking close`}
                  tone={(readiness?.blockingTaskIds.length ?? 0) > 0 ? 'warn' : 'good'}
                />
              </div>
            </Card>
          </div>

          <Card title="Open items" subtitle="Everything the agents found on this project">
            {renderExceptions(() => true)}
          </Card>
        </div>
      )}

      {tab === 'forecast' && (
        <div className="space-y-6">
          <Card title="Cost codes" subtitle="Forecast at completion against current budget, with labour burn">
            <div className="-mx-5 overflow-x-auto">
              <table className="w-full min-w-[64rem]">
                <thead>
                  <tr>
                    <Th>Cost code</Th>
                    <Th align="right">Current budget</Th>
                    <Th align="right">Cost to date</Th>
                    <Th align="right">Committed</Th>
                    <Th align="right">PM remaining</Th>
                    <Th align="right">Forecast</Th>
                    <Th align="right">vs budget</Th>
                    <Th align="right">Hours used</Th>
                    <Th align="right">Progress</Th>
                  </tr>
                </thead>
                <tbody>
                  {metrics.costCodes.map((c) => (
                    <tr key={c.costCodeId} className="hover:bg-[var(--color-canvas)]">
                      <Td>
                        <span className="tabular font-medium">{c.costCode}</span>{' '}
                        <span className="text-[var(--color-muted)]">{c.description}</span>
                        {!c.mapped && (
                          <span className="ml-2 rounded bg-red-50 px-1.5 py-0.5 text-[11px] text-[var(--color-blocking)] ring-1 ring-inset ring-red-200">
                            Unmapped
                          </span>
                        )}
                      </Td>
                      <Td align="right">{c.currentBudget === 0 ? '—' : usd(c.currentBudget)}</Td>
                      <Td align="right">{usd(c.adjustedCostToDate)}</Td>
                      <Td align="right">{usd(c.remainingCommitment)}</Td>
                      <Td align="right">{usd(c.pmRemainingUncommittedCost)}</Td>
                      <Td align="right" className="font-medium">{usd(c.eac)}</Td>
                      <Td
                        align="right"
                        className={
                          c.overrunPct !== null && c.overrunPct > V0_CONFIG.thresholds.costCodeOverrunPct
                            ? 'font-medium text-[var(--color-high)]'
                            : ''
                        }
                      >
                        {c.overrunPct === null ? 'n/a' : ratioPct(c.overrunPct)}
                      </Td>
                      <Td
                        align="right"
                        className={
                          c.hoursConsumedPct !== null &&
                          c.physicalProgressPct !== null &&
                          c.hoursConsumedPct - c.physicalProgressPct >=
                            V0_CONFIG.thresholds.laborBurnAheadProgressPercentagePoints
                            ? 'font-medium text-[var(--color-high)]'
                            : ''
                        }
                      >
                        {c.hoursConsumedPct === null ? 'n/a' : pct(c.hoursConsumedPct)}
                      </Td>
                      <Td align="right">
                        {c.physicalProgressPct === null ? '—' : `${c.physicalProgressPct}%`}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-3 text-xs text-[var(--color-muted)]">
              &quot;n/a&quot; means the comparison has no valid denominator — a cost code with no budget cannot be
              over budget, and one with no budgeted hours has no consumption rate. Unmapped cost stays in the
              project total.
            </p>
          </Card>

          <Card title="Forecast & WIP items">{renderExceptions((w) => w === 'Forecast')}</Card>
        </div>
      )}

      {tab === 'ap' && (
        <div className="space-y-6">
          <Card title="Cost position" subtitle="What is posted, what is committed, what is disputed">
            <div className="grid grid-cols-2 gap-6 md:grid-cols-4">
              <Metric label="Posted cost" value={usd(metrics.postedCost, { compact: true })} />
              <Metric
                label="Accepted adjustments"
                value={usd(metrics.acceptedAdjustmentsTotal, { compact: true })}
                sub="Management cutoff entries"
              />
              <Metric label="Remaining commitments" value={usd(metrics.remainingCommitment, { compact: true })} />
              <Metric label="Adjusted cost to date" value={usd(metrics.adjustedCostToDate, { compact: true })} />
            </div>
          </Card>

          <Card title="AP & cost control items">
            {renderExceptions((w) => w === 'AP' || w === 'Data Quality')}
          </Card>
        </div>
      )}

      {tab === 'billing' && (
        <div className="space-y-6">
          <Card title="Contract and billing" subtitle="Schedule of values reconciliation">
            <div className="grid grid-cols-2 gap-6 md:grid-cols-3 lg:grid-cols-5">
              <Metric label="Revised contract" value={usd(metrics.revisedContractValue, { compact: true })} />
              <Metric
                label="Schedule of values"
                value={usd(metrics.sovTotal, { compact: true })}
                tone={
                  Math.abs(metrics.sovVarianceToRevisedContract) > V0_CONFIG.thresholds.sovToleranceDollar
                    ? 'bad'
                    : 'good'
                }
                sub={
                  Math.abs(metrics.sovVarianceToRevisedContract) <= V0_CONFIG.thresholds.sovToleranceDollar
                    ? 'Reconciles'
                    : `${signedUsd(metrics.sovVarianceToRevisedContract)} variance`
                }
              />
              <Metric label="Billed to date" value={usd(metrics.billedToDate, { compact: true })} />
              <Metric
                label="Draft earned revenue"
                value={usd(metrics.draftEarnedRevenue, { compact: true })}
                sub={`At ${pct(metrics.percentCompletePct)} complete`}
              />
              <Metric
                label="Billing position"
                value={signedUsd(metrics.billingPosition)}
                tone={metrics.billingPosition !== null && metrics.billingPosition < 0 ? 'warn' : 'good'}
                sub={metrics.billingPosition !== null && metrics.billingPosition < 0 ? 'Underbilled' : 'Overbilled'}
              />
            </div>
          </Card>

          <Card title="Change orders" subtitle="Approved value increases the contract; pending value does not">
            <div className="-mx-5 overflow-x-auto">
              <table className="w-full min-w-[48rem]">
                <thead>
                  <tr>
                    <Th>Change order</Th>
                    <Th>Status</Th>
                    <Th align="right">Requested</Th>
                    <Th align="right">Approved</Th>
                    <Th align="right">Cost incurred</Th>
                    <Th>On SOV</Th>
                  </tr>
                </thead>
                <tbody>
                  {model.changeOrders
                    .filter((co) => co.projectId === projectId)
                    .map((co) => {
                      const onSov = exceptions.some(
                        (e) => e.ruleId === 'CO_MISSING_SOV' && e.subjectId === co.id && e.currentlyTriggering,
                      );
                      return (
                        <tr key={co.id} className="hover:bg-[var(--color-canvas)]">
                          <Td>{co.description}</Td>
                          <Td>
                            <span
                              className={`rounded px-1.5 py-0.5 text-[11px] ring-1 ring-inset ${
                                co.status === 'approved'
                                  ? 'bg-green-50 text-[var(--color-ok)] ring-green-200'
                                  : co.status === 'pending'
                                    ? 'bg-amber-50 text-[var(--color-medium)] ring-amber-200'
                                    : 'bg-slate-50 text-[var(--color-muted)] ring-slate-200'
                              }`}
                            >
                              {co.status}
                            </span>
                          </Td>
                          <Td align="right">{usd(co.requestedValue)}</Td>
                          <Td align="right">{co.status === 'approved' ? usd(co.approvedValue) : '—'}</Td>
                          <Td
                            align="right"
                            className={
                              co.status === 'pending' &&
                              co.costIncurredToDate >= V0_CONFIG.thresholds.unapprovedCoIncurredCostDollar
                                ? 'font-medium text-[var(--color-high)]'
                                : ''
                            }
                          >
                            {usd(co.costIncurredToDate)}
                          </Td>
                          <Td>
                            {co.status !== 'approved' ? (
                              <span className="text-xs text-[var(--color-muted)]">n/a</span>
                            ) : onSov ? (
                              <span className="text-xs font-medium text-[var(--color-blocking)]">Missing</span>
                            ) : (
                              <span className="text-xs text-[var(--color-ok)]">Yes</span>
                            )}
                          </Td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
          </Card>

          <Card title="Billing & change order items">
            {renderExceptions((w) => w === 'Billing' || w === 'Change Orders')}
          </Card>
        </div>
      )}

      {tab === 'activity' && (
        <Card
          title="Activity"
          subtitle="What the agents observed, who they asked, what was answered, and what changed"
        >
          <ActivityTrail
            state={state}
            agentNames={Object.fromEntries(AGENTS.map((agent) => [agent.id, agent.name]))}
            projectId={projectId}
          />
        </Card>
      )}
    </div>
  );
}

function Row({
  label, value, strong, adjusted,
}: {
  label: string;
  value: string;
  strong?: boolean;
  adjusted?: boolean;
}) {
  return (
    <div
      className={`flex items-baseline justify-between gap-4 ${
        strong ? 'border-t border-[var(--color-line)] pt-2 font-semibold' : ''
      } ${adjusted ? 'text-[var(--color-accent)]' : ''}`}
    >
      <dt className={strong ? '' : 'text-[var(--color-muted)]'}>{label}</dt>
      <dd className="tabular">{value}</dd>
    </div>
  );
}
