/**
 * Deterministic project economics: contract, cost, EAC, profit, margin, and the draft WIP view.
 *
 * Every formula here comes from `docs/workflows/FINANCIAL_LOGIC_V0.md`. Nothing in this file reads a raw CSV
 * column or a threshold literal, and no LLM is involved in any arithmetic.
 *
 * Two properties this module is responsible for:
 *
 * 1. **No double counting.** Accepting a received-not-invoiced adjustment moves cost from remaining
 *    commitment into cost-to-date and nets to zero at EAC. Accepting an AP-unposted adjustment adds cost
 *    without touching the commitment again, because the valid invoice already reduced it. Accepting unposted
 *    labour adds cost and touches no commitment at all. The three are kept in separate maps precisely so they
 *    cannot be conflated.
 * 2. **No NaN or Infinity, ever.** Every ratio goes through `safeDivide`, and a `null` result means "not
 *    applicable" — a project with no contract value has an undefined margin, which is a different statement
 *    from a 0% margin.
 *
 * Prior-period reconstruction is this same code path with a different `asOfDate` and an empty projection, so
 * historical actuals can never be mixed with a current forecast.
 */

import type { V0Config } from '@/config/v0Config';
import { onOrBefore, type IsoDate } from '@/domain/dates';
import { clamp, safeDivide, safePercent, type Money } from '@/domain/money';
import type {
  CanonicalModel, ForecastSnapshot, Project, ProgressSnapshot,
} from '@/domain/entities';
import type { CostCodeId, ProjectId } from '@/domain/ids';
import type { ReconciledView } from '@/domain/reconciliation';
import type { CostCodeMetrics, MetricMovement, ProjectMetrics } from '@/domain/metrics';
import type { DecisionProjection } from '@/domain/workflow';

// ---------------------------------------------------------------------------------------------------------
// Selectors that must read the model and the decision overlay as one
// ---------------------------------------------------------------------------------------------------------

/**
 * The latest forecast snapshot per cost code, on or before the as-of date.
 *
 * Deliberately per cost code rather than per project. The reference oracle picks each project's latest
 * snapshot *date* and sums the rows at that date, which is equivalent on the source data because every cost
 * code of a project shares its snapshot dates. It stops being equivalent the moment a PM answers a question:
 * an overlay snapshot for one cost code would make that code the only one at the "latest date" and silently
 * drop the other nine from EAC. Per-cost-code selection ties to the oracle and survives a human answer.
 */
export function latestForecastByCostCode(
  model: CanonicalModel,
  projection: DecisionProjection,
  projectId: ProjectId,
  asOfDate: IsoDate,
): Map<CostCodeId, ForecastSnapshot> {
  const latest = new Map<CostCodeId, ForecastSnapshot>();

  const consider = (snapshot: ForecastSnapshot): void => {
    if (snapshot.projectId !== projectId) return;
    if (!onOrBefore(snapshot.asOfDate, asOfDate)) return;
    const current = latest.get(snapshot.costCodeId);
    if (!current || snapshot.asOfDate >= current.asOfDate) latest.set(snapshot.costCodeId, snapshot);
  };

  for (const snapshot of model.forecastSnapshots) consider(snapshot);
  // Overlay snapshots are dated `effectiveDate`, which defaults to the close date, so they win ties.
  for (const snapshot of projection.forecastOverlay.values()) consider(snapshot);

  return latest;
}

/** The latest physical-progress snapshot per cost code, on or before the as-of date. */
export function latestProgressByCostCode(
  model: CanonicalModel,
  projectId: ProjectId,
  asOfDate: IsoDate,
): Map<CostCodeId, ProgressSnapshot> {
  const latest = new Map<CostCodeId, ProgressSnapshot>();
  for (const snapshot of model.progressSnapshots) {
    if (snapshot.projectId !== projectId) continue;
    if (!onOrBefore(snapshot.asOfDate, asOfDate)) continue;
    const current = latest.get(snapshot.costCodeId);
    if (!current || snapshot.asOfDate >= current.asOfDate) latest.set(snapshot.costCodeId, snapshot);
  }
  return latest;
}

/**
 * Billed-to-date as at a date.
 *
 * A billing row contributes its full `billedToDate` once its period has closed on or before the as-of date,
 * and `billedToDate − currentBilled` while the period is still open. On this mock data — one July period row
 * per SOV line — that reproduces the reference oracle at both comparison dates, and unlike hardcoding the two
 * dates it generalises to real billing history.
 */
export function billedToDate(view: ReconciledView, projectId: ProjectId, asOfDate: IsoDate): Money {
  let total = 0;
  for (const billing of view.billingsForProject(projectId)) {
    total += periodHasClosed(billing.billingPeriod, asOfDate)
      ? billing.billedToDate
      : billing.billedToDate - billing.currentBilled;
  }
  return total;
}

/** True when the last day of a `YYYY-MM` billing period falls on or before the as-of date. */
function periodHasClosed(billingPeriod: string, asOfDate: IsoDate): boolean {
  const [yearText, monthText] = billingPeriod.split('-');
  const year = Number(yearText);
  const month = Number(monthText);
  if (!Number.isFinite(year) || !Number.isFinite(month)) return true;
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const periodEnd = `${yearText}-${monthText}-${String(lastDay).padStart(2, '0')}`;
  return periodEnd <= asOfDate;
}

// ---------------------------------------------------------------------------------------------------------
// Project metrics
// ---------------------------------------------------------------------------------------------------------

/**
 * Cost-to-cost percent complete, with the zero-EAC cases the config requires.
 *
 * Exported so the edge-case fixtures can exercise the shipped decision rather than a copy of it. A test that
 * re-implements the logic it is testing will keep passing while the real code regresses underneath it.
 *
 * - EAC zero and no cost: 0% by V0 convention — nothing planned, nothing spent.
 * - EAC zero with cost incurred: not a percentage but a data problem. Dividing would report infinite
 *   completion, so it returns null and says why.
 * - Otherwise clamped to 0–100, because cost above EAC would otherwise overstate earned revenue.
 */
export function percentComplete(
  eac: Money,
  adjustedCostToDate: Money,
): { percentCompletePct: number | null; dataQualityError: string | null } {
  if (eac === 0) {
    return adjustedCostToDate === 0
      ? { percentCompletePct: 0, dataQualityError: null }
      : {
          percentCompletePct: null,
          dataQualityError:
            'Estimate at completion is zero while cost has been incurred. Percent complete cannot be computed.',
        };
  }

  const ratio = safeDivide(adjustedCostToDate, eac);
  return {
    percentCompletePct: ratio === null ? null : clamp(ratio, 0, 1) * 100,
    dataQualityError: null,
  };
}

export function computeProjectMetrics(
  model: CanonicalModel,
  view: ReconciledView,
  projection: DecisionProjection,
  config: V0Config,
  asOfDate: IsoDate,
  project: Project,
): ProjectMetrics {
  const projectId = project.id;
  const { adjustments } = projection;

  // --- Contract -------------------------------------------------------------------------------------------
  // Only approved change orders, approved on or before the as-of date, increase contract value.
  // Pending ones are a negotiating position; rejected ones are nothing.
  let approvedChangeOrderValue = 0;
  let pendingChangeOrderRequestedValue = 0;
  let pendingChangeOrderIncurredCost = 0;

  for (const co of model.changeOrders) {
    if (co.projectId !== projectId) continue;
    if (co.status === 'approved' && onOrBefore(co.approvalDate, asOfDate)) {
      approvedChangeOrderValue += co.approvedValue;
    } else if (co.status === 'pending') {
      pendingChangeOrderRequestedValue += co.requestedValue;
      // Cost already spent on unapproved work is the real exposure — see ASSUMPTIONS A-01.
      pendingChangeOrderIncurredCost += co.costIncurredToDate;
    }
  }

  const revisedContractValue = project.originalContractValue + approvedChangeOrderValue;

  // --- Posted cost, by cost code ---------------------------------------------------------------------------
  // Includes transactions on unmapped cost codes: the cost is economically real and belongs in the project
  // total even though its classification is unresolved.
  const postedByCostCode = new Map<CostCodeId, Money>();
  let postedCost = 0;
  for (const txn of model.jobCostTransactions) {
    if (txn.projectId !== projectId) continue;
    if (!onOrBefore(txn.postingDate, asOfDate)) continue;
    postedCost += txn.amount;
    postedByCostCode.set(txn.costCodeId, (postedByCostCode.get(txn.costCodeId) ?? 0) + txn.amount);
  }

  // --- Accepted management adjustments, allocated to their cost codes ---------------------------------------
  const adjustmentByCostCode = new Map<CostCodeId, Money>();
  const addAdjustment = (costCodeId: CostCodeId, amount: Money): void => {
    adjustmentByCostCode.set(costCodeId, (adjustmentByCostCode.get(costCodeId) ?? 0) + amount);
  };

  let acceptedRni = 0;
  const acceptedRniByCommitment = new Map<string, Money>();
  for (const [commitmentId, amount] of adjustments.acceptedRni) {
    const commitment = model.index.commitmentById.get(commitmentId);
    if (!commitment || commitment.projectId !== projectId) continue;
    acceptedRni += amount;
    acceptedRniByCommitment.set(commitmentId, amount);
    addAdjustment(commitment.costCodeId, amount);
  }

  let acceptedApUnposted = 0;
  for (const [invoiceId, amount] of adjustments.acceptedApUnposted) {
    const invoice = model.index.apInvoiceById.get(invoiceId);
    if (!invoice || invoice.projectId !== projectId) continue;
    acceptedApUnposted += amount;
    addAdjustment(invoice.costCodeId, amount);
  }

  let acceptedUnpostedLabor = 0;
  for (const [aggregateId, amount] of adjustments.acceptedUnpostedLabor) {
    const aggregate = model.index.laborAggregateById.get(aggregateId);
    if (!aggregate || aggregate.projectId !== projectId) continue;
    acceptedUnpostedLabor += amount;
    addAdjustment(aggregate.costCodeId, amount);
  }

  const acceptedAdjustmentsTotal = acceptedApUnposted + acceptedRni + acceptedUnpostedLabor;
  const adjustedCostToDate = postedCost + acceptedAdjustmentsTotal;

  // --- Remaining commitment -------------------------------------------------------------------------------
  // Cumulative *valid* invoicing reduces the PO; an accepted RNI reduces what is left again, because that
  // cost has just been moved into cost-to-date and must not be counted twice.
  const remainingByCostCode = new Map<CostCodeId, Money>();
  let remainingCommitment = 0;
  for (const commitment of model.commitments) {
    if (commitment.projectId !== projectId) continue;

    const validInvoiced = view
      .validInvoicesForCommitment(commitment.id, asOfDate)
      .reduce((total, invoice) => total + invoice.amount, 0);

    const beforeRni = Math.max(commitment.committedAmount - validInvoiced, 0);
    const rni = acceptedRniByCommitment.get(commitment.id) ?? 0;
    const remaining = Math.max(beforeRni - rni, 0);

    remainingCommitment += remaining;
    remainingByCostCode.set(
      commitment.costCodeId,
      (remainingByCostCode.get(commitment.costCodeId) ?? 0) + remaining,
    );
  }

  // --- PM remaining uncommitted cost ------------------------------------------------------------------------
  const forecasts = latestForecastByCostCode(model, projection, projectId, asOfDate);
  const progress = latestProgressByCostCode(model, projectId, asOfDate);

  let pmRemainingUncommittedCost = 0;
  for (const snapshot of forecasts.values()) {
    pmRemainingUncommittedCost += snapshot.pmRemainingUncommittedCost;
  }

  const eac = adjustedCostToDate + remainingCommitment + pmRemainingUncommittedCost;

  // --- Profit and margin -------------------------------------------------------------------------------------
  const projectedProfit = revisedContractValue - eac;
  const projectedMarginPct = safePercent(projectedProfit, revisedContractValue);
  // Original margin uses the original contract against the *original* budget, not the revised ones.
  const originalMarginPct = safePercent(
    project.originalContractValue - project.originalBudgetCost,
    project.originalContractValue,
  );
  const marginFadePercentagePoints =
    originalMarginPct === null || projectedMarginPct === null
      ? null
      : originalMarginPct - projectedMarginPct;

  // --- Draft WIP ---------------------------------------------------------------------------------------------
  const { percentCompletePct, dataQualityError } = percentComplete(eac, adjustedCostToDate);

  const draftEarnedRevenue =
    percentCompletePct === null ? null : revisedContractValue * (percentCompletePct / 100);
  const billed = billedToDate(view, projectId, asOfDate);
  const billingPosition = draftEarnedRevenue === null ? null : billed - draftEarnedRevenue;

  // --- SOV --------------------------------------------------------------------------------------------------
  const sovTotal = view
    .sovItemsForProject(projectId)
    .filter((item) => item.active)
    .reduce((total, item) => total + item.scheduledValue, 0);

  // --- Cost-code detail ---------------------------------------------------------------------------------------
  const costCodes = buildCostCodeMetrics({
    model, projectId, asOfDate, config,
    postedByCostCode, adjustmentByCostCode, remainingByCostCode, forecasts, progress,
  });

  return {
    projectId,
    asOfDate,
    originalContractValue: project.originalContractValue,
    approvedChangeOrderValue,
    revisedContractValue,
    postedCost,
    acceptedApUnposted,
    acceptedRni,
    acceptedUnpostedLabor,
    acceptedAdjustmentsTotal,
    adjustedCostToDate,
    remainingCommitment,
    pmRemainingUncommittedCost,
    eac,
    projectedProfit,
    projectedMarginPct,
    originalMarginPct,
    marginFadePercentagePoints,
    percentCompletePct,
    dataQualityError,
    draftEarnedRevenue,
    billedToDate: billed,
    billingPosition,
    pendingChangeOrderRequestedValue,
    pendingChangeOrderIncurredCost,
    sovTotal,
    sovVarianceToRevisedContract: sovTotal - revisedContractValue,
    costCodes,
  };
}

// ---------------------------------------------------------------------------------------------------------
// Cost-code detail
// ---------------------------------------------------------------------------------------------------------

function buildCostCodeMetrics(input: {
  model: CanonicalModel;
  projectId: ProjectId;
  asOfDate: IsoDate;
  config: V0Config;
  postedByCostCode: Map<CostCodeId, Money>;
  adjustmentByCostCode: Map<CostCodeId, Money>;
  remainingByCostCode: Map<CostCodeId, Money>;
  forecasts: Map<CostCodeId, ForecastSnapshot>;
  progress: Map<CostCodeId, ProgressSnapshot>;
}): CostCodeMetrics[] {
  const {
    model, projectId, asOfDate, postedByCostCode, adjustmentByCostCode, remainingByCostCode,
    forecasts, progress,
  } = input;

  const laborByCostCode = new Map(
    model.laborAggregates
      .filter((aggregate) => aggregate.projectId === projectId)
      .map((aggregate) => [aggregate.costCodeId, aggregate] as const),
  );

  const results: CostCodeMetrics[] = [];

  for (const costCode of model.costCodes) {
    if (costCode.projectId !== projectId) continue;

    const budget = model.index.budgetLineByCostCode.get(costCode.id);
    const postedCost = postedByCostCode.get(costCode.id) ?? 0;
    const acceptedAdjustments = adjustmentByCostCode.get(costCode.id) ?? 0;
    const adjustedCostToDate = postedCost + acceptedAdjustments;
    const remainingCommitment = remainingByCostCode.get(costCode.id) ?? 0;
    const forecast = forecasts.get(costCode.id);
    const pmRemainingUncommittedCost = forecast?.pmRemainingUncommittedCost ?? 0;
    const eac = adjustedCostToDate + remainingCommitment + pmRemainingUncommittedCost;

    const currentBudget = budget?.currentBudget ?? 0;
    // A cost code with no budget cannot be "over budget" — that is a mapping problem, reported separately.
    const overrunRatio = safeDivide(eac, currentBudget);
    const overrunPct = overrunRatio === null ? null : overrunRatio - 1;

    const budgetedLaborHours = budget?.budgetedLaborHours ?? 0;
    const labor = laborByCostCode.get(costCode.id);

    // Labour is pre-aggregated only for the configured close and prior dates. For any other as-of date the
    // answer is "not aggregated", which is emphatically not "zero hours worked" — reporting 0% consumed
    // against 52% progress would be a confident, precise, wrong number, and the labour-burn rule would fire
    // on it. A cost code with a real aggregate but genuinely no time booked still reports 0 correctly.
    const bucket = labor ? labor.byAsOf[asOfDate] : undefined;
    const actualLaborHours = labor === undefined ? 0 : (bucket?.approvedHours ?? null);
    const pmRemainingLaborHours = forecast?.pmRemainingLaborHours ?? null;

    const hoursConsumedPct =
      actualLaborHours === null ? null : safePercent(actualLaborHours, budgetedLaborHours);
    const forecastHours =
      pmRemainingLaborHours === null || actualLaborHours === null
        ? null
        : actualLaborHours + pmRemainingLaborHours;
    const forecastHoursRatio =
      forecastHours === null ? null : safeDivide(forecastHours, budgetedLaborHours);

    results.push({
      costCodeId: costCode.id,
      costCode: costCode.code,
      description: costCode.description,
      mapped: costCode.mapped,
      originalBudget: budget?.originalBudget ?? 0,
      currentBudget,
      postedCost,
      acceptedAdjustments,
      adjustedCostToDate,
      remainingCommitment,
      pmRemainingUncommittedCost,
      eac,
      overrunPct,
      budgetedLaborHours,
      actualLaborHours,
      pmRemainingLaborHours,
      hoursConsumedPct,
      forecastHours,
      forecastHoursOverBudgetPct: forecastHoursRatio === null ? null : forecastHoursRatio - 1,
      physicalProgressPct: progress.get(costCode.id)?.physicalProgressPct ?? null,
      latestForecastDate: forecast?.asOfDate ?? null,
      latestProgressDate: progress.get(costCode.id)?.asOfDate ?? null,
    });
  }

  return results.sort((a, b) => (a.costCode < b.costCode ? -1 : 1));
}

// ---------------------------------------------------------------------------------------------------------
// Portfolio and movement
// ---------------------------------------------------------------------------------------------------------

/** Metrics for every project, as at one date. */
export function computeAllProjectMetrics(
  model: CanonicalModel,
  view: ReconciledView,
  projection: DecisionProjection,
  config: V0Config,
  asOfDate: IsoDate,
): ProjectMetrics[] {
  return model.projects.map((project) =>
    computeProjectMetrics(model, view, projection, config, asOfDate, project),
  );
}

/**
 * Month-over-month movement between two metric sets.
 *
 * Both sides must have been built by the same code path — that is what stops current actuals being compared
 * against a historical forecast and called a deterioration.
 */
export function computeMovement(current: ProjectMetrics, prior: ProjectMetrics): MetricMovement {
  return {
    projectId: current.projectId,
    eacChange: current.eac - prior.eac,
    eacChangePctOfContract: safeDivide(current.eac - prior.eac, current.revisedContractValue),
    marginMovementPercentagePoints:
      current.projectedMarginPct === null || prior.projectedMarginPct === null
        ? null
        : current.projectedMarginPct - prior.projectedMarginPct,
    profitChange: current.projectedProfit - prior.projectedProfit,
  };
}
