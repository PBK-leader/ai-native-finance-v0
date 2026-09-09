/**
 * Finance Command Center — the CFO's and Controller's portfolio view.
 *
 * The question this screen answers is not "how are we doing" but "what is in my way, and who am I waiting
 * on". Portfolio totals are context; the close-readiness table and the waiting-on list are the point.
 */

import Link from 'next/link';
import { V0_CONFIG } from '@/config/v0Config';
import type { CanonicalModel } from '@/domain/entities';
import { isSettled } from '@/domain/workflow';
import type { EngineState } from '@/workflows/replay';
import { computePortfolioMetrics } from '@/calculations/portfolio';
import { Card, CloseReadyTag, Empty, Metric, ProjectLink, Td, Th } from '@/components/ui';
import { DemoBar } from '@/components/DemoBar';
import { pct, signedUsd, usd } from '@/components/format';

export function CommandCenter({
  state, model, title = 'Finance Command Center',
}: {
  state: EngineState;
  model: CanonicalModel;
  title?: string;
}) {
  const metrics = [...state.current.metricsByProject.values()];

  // Every figure here is produced by the calculation layer, not summed in the view.
  const portfolio = computePortfolioMetrics(metrics, [...state.prior.values()]);

  const openTasks = state.current.tasks.filter((task) => !isSettled(task.status));
  const blockingTasks = openTasks.filter((task) => task.blocking);
  const readyCount = [...state.current.closeReadiness.values()].filter((r) => r.ready).length;

  // Who the company is actually waiting on, which is the operational question.
  const waitingOn = new Map<string, { name: string; role: string; tasks: number; blocking: number }>();
  for (const task of openTasks) {
    const person = task.ownerPersonId ? model.index.personById.get(task.ownerPersonId) : null;
    const key = person?.id ?? `role:${task.ownerRole}`;
    const entry = waitingOn.get(key) ?? {
      name: person?.name ?? task.ownerRole,
      role: task.ownerRole,
      tasks: 0,
      blocking: 0,
    };
    entry.tasks += 1;
    if (task.blocking) entry.blocking += 1;
    waitingOn.set(key, entry);
  }

  const rniCandidates = state.current.exceptions.filter(
    (e) => e.ruleId === 'AP_RNI' && e.currentlyTriggering && e.suppressedBy === null,
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
          <p className="mt-1 text-sm text-[var(--color-muted)]">
            {model.company.name} · close {V0_CONFIG.closeDate} · compared with{' '}
            {V0_CONFIG.priorComparisonDate}
          </p>
          <p className="mt-2 max-w-2xl text-sm">
            <span className="font-medium">What this answers:</span>{' '}
            <span className="text-[var(--color-muted)]">
              Can we close the books this month, and if not, what is in the way and who are we waiting on?
            </span>
          </p>
        </div>
        <DemoBar hasDecisions={state.decisions.length > 0} />
      </div>

      <Card title="Portfolio" subtitle="Draft management analysis across six active projects">
        <div className="grid grid-cols-2 gap-6 md:grid-cols-3 lg:grid-cols-6">
          <Metric label="Revised contract" value={usd(portfolio.revisedContractValue, { compact: true })} />
          <Metric label="Forecast final cost" value={usd(portfolio.eac, { compact: true })} />
          <Metric
            label="Projected profit"
            value={usd(portfolio.projectedProfit, { compact: true })}
            sub={`${portfolio.profitMovement < 0 ? '▼' : '▲'} ${usd(Math.abs(portfolio.profitMovement), { compact: true })} vs last month`}
            tone={portfolio.profitMovement < 0 ? 'warn' : 'good'}
          />
          <Metric
            label="Ready to close"
            value={`${readyCount} of ${metrics.length}`}
            tone={readyCount === metrics.length ? 'good' : 'warn'}
          />
          <Metric
            label="Underbilled"
            value={usd(portfolio.underbilled, { compact: true })}
            tone={portfolio.underbilled > 0 ? 'warn' : 'default'}
            sub="Work done, not yet invoiced"
          />
          <Metric
            label="Unapproved change cost"
            value={usd(portfolio.unapprovedChangeOrderCost, { compact: true })}
            tone={portfolio.unapprovedChangeOrderCost > 0 ? 'warn' : 'default'}
            sub="Spent on work not yet under contract"
          />
        </div>
      </Card>

      <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        <Card
          title="Can each project close?"
          subtitle="A project cannot close while anything blocking is unresolved"
        >
          <div className="-mx-5 overflow-x-auto">
            <table className="w-full min-w-[52rem]">
              <thead>
                <tr>
                  <Th>Project</Th>
                  <Th align="right">Contract</Th>
                  <Th align="right">Forecast cost</Th>
                  <Th align="right">Margin</Th>
                  <Th align="right">vs last month</Th>
                  <Th align="right">Billing position</Th>
                  <Th align="right">Open</Th>
                  <Th>Status</Th>
                </tr>
              </thead>
              <tbody>
                {metrics.map((m) => {
                  const project = model.index.projectById.get(m.projectId)!;
                  const prior = state.prior.get(m.projectId);
                  const readiness = state.current.closeReadiness.get(m.projectId);
                  const marginMove =
                    prior?.projectedMarginPct != null && m.projectedMarginPct != null
                      ? m.projectedMarginPct - prior.projectedMarginPct
                      : null;
                  const open = state.current.tasks.filter(
                    (t) => t.projectId === m.projectId && !isSettled(t.status),
                  );
                  const blocking = open.filter((t) => t.blocking).length;

                  return (
                    <tr key={m.projectId} className="hover:bg-[var(--color-canvas)]">
                      <Td>
                        <ProjectLink id={m.projectId} name={project.name} />
                        <div className="text-xs text-[var(--color-muted)]">{project.trade}</div>
                      </Td>
                      <Td align="right">{usd(m.revisedContractValue, { compact: true })}</Td>
                      <Td align="right">{usd(m.eac, { compact: true })}</Td>
                      <Td align="right">{pct(m.projectedMarginPct)}</Td>
                      <Td
                        align="right"
                        className={marginMove != null && marginMove < 0 ? 'text-[var(--color-high)]' : ''}
                      >
                        {marginMove === null ? 'n/a' : `${marginMove > 0 ? '+' : ''}${marginMove.toFixed(2)} pts`}
                      </Td>
                      <Td
                        align="right"
                        className={
                          m.billingPosition !== null && m.billingPosition < 0
                            ? 'text-[var(--color-medium)]'
                            : ''
                        }
                      >
                        {signedUsd(m.billingPosition)}
                      </Td>
                      <Td align="right">
                        {open.length}
                        {blocking > 0 && (
                          <span className="ml-1 text-xs text-[var(--color-blocking)]">({blocking})</span>
                        )}
                      </Td>
                      <Td>
                        <CloseReadyTag ready={readiness?.ready ?? false} />
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-xs text-[var(--color-muted)]">
            Billing position: negative means underbilled. Figures in brackets are items blocking the close.
          </p>
        </Card>

        <div className="space-y-6">
          <Card title="Who we are waiting on" subtitle={`${openTasks.length} open items, ${blockingTasks.length} blocking`}>
            {waitingOn.size === 0 ? (
              <Empty>Nothing outstanding. Every item has been resolved or explicitly accepted.</Empty>
            ) : (
              <ul className="space-y-2">
                {[...waitingOn.values()]
                  .sort((a, b) => b.blocking - a.blocking || b.tasks - a.tasks)
                  .map((entry) => (
                    <li key={entry.name} className="flex items-baseline justify-between gap-3 text-sm">
                      <span>
                        {entry.name}
                        <span className="ml-1 text-xs text-[var(--color-muted)]">{entry.role}</span>
                      </span>
                      <span className="tabular text-xs">
                        {entry.tasks}
                        {entry.blocking > 0 && (
                          <span className="ml-1 text-[var(--color-blocking)]">
                            ({entry.blocking} blocking)
                          </span>
                        )}
                      </span>
                    </li>
                  ))}
              </ul>
            )}
            <Link
              href="/work-queue"
              className="mt-3 inline-block text-xs font-medium text-[var(--color-accent)] hover:underline"
            >
              Open the work queue →
            </Link>
          </Card>

          <Card title="Cutoff candidates" subtitle="Delivered, but the invoice has not arrived">
            {rniCandidates.length === 0 ? (
              <Empty>No open received-not-invoiced items.</Empty>
            ) : (
              <ul className="space-y-2">
                {rniCandidates.map((exception) => (
                  <li key={exception.id} className="flex items-baseline justify-between gap-3 text-sm">
                    <Link
                      href={`/projects/${exception.projectId}?tab=ap`}
                      className="truncate hover:underline"
                    >
                      {model.index.projectById.get(exception.projectId!)?.name}
                    </Link>
                    <span className="tabular whitespace-nowrap font-medium">{usd(exception.impact)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
