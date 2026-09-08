/**
 * Derived financial views: cost-code economics, project economics, WIP, and labor indicators.
 *
 * Declared at layer 3 so rules and agents can name them. Computed in `src/calculations`.
 *
 * Every ratio here is `number | null`, never `NaN`. A `null` means "not applicable" — a project with no
 * contract value has an undefined margin, which is a different statement from a 0% margin — and the UI must
 * render it as such.
 */

import type { IsoDate } from './dates';
import type { Money, Percent } from './money';
import type { CostCodeId, ProjectId } from './ids';

export type CostCodeMetrics = {
  costCodeId: CostCodeId;
  costCode: string;
  description: string;
  mapped: boolean;
  originalBudget: Money;
  currentBudget: Money;
  postedCost: Money;
  acceptedAdjustments: Money;
  adjustedCostToDate: Money;
  remainingCommitment: Money;
  pmRemainingUncommittedCost: Money;
  eac: Money;
  /** EAC over current budget as a fraction, or null when there is no budget to compare against. */
  overrunPct: number | null;
  budgetedLaborHours: number;
  /** Null when labour has not been aggregated for this as-of date — never silently zero. */
  actualLaborHours: number | null;
  pmRemainingLaborHours: number | null;
  /** Null when budgeted hours are zero — the zero-denominator guard the config requires. */
  hoursConsumedPct: Percent | null;
  forecastHours: number | null;
  forecastHoursOverBudgetPct: number | null;
  physicalProgressPct: number | null;
  latestForecastDate: IsoDate | null;
  latestProgressDate: IsoDate | null;
};

export type ProjectMetrics = {
  projectId: ProjectId;
  asOfDate: IsoDate;

  // Contract
  originalContractValue: Money;
  approvedChangeOrderValue: Money;
  revisedContractValue: Money;

  // Cost
  postedCost: Money;
  acceptedApUnposted: Money;
  acceptedRni: Money;
  acceptedUnpostedLabor: Money;
  /** All accepted management adjustments. Kept here so no screen has to add the three types itself. */
  acceptedAdjustmentsTotal: Money;
  adjustedCostToDate: Money;
  remainingCommitment: Money;
  pmRemainingUncommittedCost: Money;
  eac: Money;

  // Profit
  projectedProfit: Money;
  /** Null when revised contract value is zero. */
  projectedMarginPct: Percent | null;
  /** From the original contract and the original budget, not the revised ones. */
  originalMarginPct: Percent | null;
  /** Null when either margin is not applicable. Positive means margin has faded. */
  marginFadePercentagePoints: Percent | null;

  // Draft WIP — management analysis, not GAAP revenue recognition
  /** Null when EAC is zero and cost is not, which is a data-quality problem rather than a percentage. */
  percentCompletePct: Percent | null;
  dataQualityError: string | null;
  draftEarnedRevenue: Money | null;
  billedToDate: Money;
  /** Billed minus earned. Positive is overbilled, negative is underbilled. */
  billingPosition: Money | null;

  // Change orders
  pendingChangeOrderRequestedValue: Money;
  pendingChangeOrderIncurredCost: Money;

  // SOV
  sovTotal: Money;
  sovVarianceToRevisedContract: Money;

  costCodes: readonly CostCodeMetrics[];
};

/** Month-over-month movement, computed from two full metric sets built the same way. */
export type MetricMovement = {
  projectId: ProjectId;
  eacChange: Money;
  eacChangePctOfContract: number | null;
  marginMovementPercentagePoints: Percent | null;
  profitChange: Money;
};
