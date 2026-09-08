/**
 * Portfolio-level aggregation.
 *
 * These roll-ups used to be summed inside the page components. Two things went wrong there. The work-queue
 * headline added days and percentage points to dollars, because `ExceptionRecord.impact` is a polymorphic
 * quantity governed by `impactUnit` and the reducer ignored it. And it multi-counted: on P-1004 the same
 * $420,000 appears as a missing SOV line, an unbilled change order and part of the SOV variance.
 *
 * De-duplication here is by subject, which collapses the two change-order views onto `CHG-CO-1004-A`. The
 * project-level `BILL_SOV_MISMATCH` keys on the project and so still counts separately — modelling a full
 * subject hierarchy is beyond V0, and an exposure figure that is close and explainable beats one that is
 * precise and opaque. The figure is labelled "value affected", not "total loss".
 *
 * A number on a CFO's screen has to be produced somewhere it can be tested.
 */

import type { ExceptionRecord } from '@/domain/workflow';
import type { ProjectMetrics } from '@/domain/metrics';
import type { Money } from '@/domain/money';

export type PortfolioMetrics = {
  projectCount: number;
  revisedContractValue: Money;
  eac: Money;
  projectedProfit: Money;
  priorProjectedProfit: Money;
  profitMovement: Money;
  /** Work performed but not yet invoiced, across the portfolio. */
  underbilled: Money;
  /** Cost already spent on change work the client has not approved. */
  unapprovedChangeOrderCost: Money;
};

export function computePortfolioMetrics(
  current: readonly ProjectMetrics[],
  prior: readonly ProjectMetrics[],
): PortfolioMetrics {
  const sum = (values: readonly ProjectMetrics[], pick: (m: ProjectMetrics) => number): number =>
    values.reduce((total, m) => total + pick(m), 0);

  const projectedProfit = sum(current, (m) => m.projectedProfit);
  const priorProjectedProfit = sum(prior, (m) => m.projectedProfit);

  return {
    projectCount: current.length,
    revisedContractValue: sum(current, (m) => m.revisedContractValue),
    eac: sum(current, (m) => m.eac),
    projectedProfit,
    priorProjectedProfit,
    profitMovement: projectedProfit - priorProjectedProfit,
    underbilled: sum(current, (m) =>
      m.billingPosition !== null && m.billingPosition < 0 ? -m.billingPosition : 0,
    ),
    unapprovedChangeOrderCost: sum(current, (m) => m.pendingChangeOrderIncurredCost),
  };
}

/**
 * Dollar exposure across a set of exceptions.
 *
 * Counts only impacts actually denominated in dollars, and counts each economic subject once. Several rules
 * legitimately describe the same money from different angles — an approved change order missing from the
 * schedule of values is also unbilled, and also explains the schedule-of-values variance — so summing every
 * exception would treble-count it and overstate the queue.
 */
export function dollarExposure(exceptions: readonly ExceptionRecord[]): {
  total: Money;
  countedExceptions: number;
  excludedNonDollar: number;
} {
  const bySubject = new Map<string, Money>();
  let excludedNonDollar = 0;

  for (const exception of exceptions) {
    if (exception.impactUnit !== 'USD' || exception.impact === null) {
      if (exception.impact !== null) excludedNonDollar += 1;
      continue;
    }
    // Keyed by the object the money belongs to, so overlapping views of one problem collapse to one figure.
    const key = `${exception.projectId ?? 'GLOBAL'}:${exception.subjectId}`;
    bySubject.set(key, Math.max(bySubject.get(key) ?? 0, exception.impact));
  }

  let total = 0;
  for (const amount of bySubject.values()) total += amount;

  return { total, countedExceptions: bySubject.size, excludedNonDollar };
}
