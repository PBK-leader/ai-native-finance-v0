/**
 * The single typed runtime configuration for the Summit MEP V0 prototype.
 *
 * Source of truth: `docs/product/V0_CONFIG.md`.
 * Machine-readable mirror shipped with the mock data: `data/mock/summit_mep/reference/client_config.json`.
 *
 * `tests/unit/config.test.ts` asserts this module and the reference JSON agree, so the two can never
 * silently drift. Nothing outside this module may hard-code a threshold or a date.
 *
 * These are fictional customer-policy defaults for a prototype. They are not accounting policy.
 */

/** ISO calendar date, `YYYY-MM-DD`. */
export type IsoDate = string;

export type Thresholds = {
  /** A PM forecast snapshot older than this many days is stale. */
  forecastStaleDays: number;
  /** Days after approval before an unposted AP invoice is an exception. */
  apPostingLagDays: number;
  /** Days after the approved work date before unposted labor is an exception. */
  laborPostingLagDays: number;
  /** Minimum dollars on an unmapped cost code before it is worth a task. */
  unmappedCostCodeDollar: number;
  /** Minimum dollars of cost on a mapped but unbudgeted cost code. */
  unbudgetedCostDollar: number;
  /** Minimum dollars a PO may be over-invoiced before it is an exception. */
  commitmentOverrunDollar: number;
  /** Percentage points of margin fade versus original margin. */
  marginFadePercentagePoints: number;
  /** Absolute EAC deterioration versus the prior close. */
  eacDeteriorationDollar: number;
  /** EAC deterioration as a fraction of revised contract value (0.025 = 2.5%). */
  eacDeteriorationPctContract: number;
  /** Cost-code EAC over current budget as a fraction (0.1 = 10%). */
  costCodeOverrunPct: number;
  /** Hours-consumed % minus physical-progress %, in percentage points. */
  laborBurnAheadProgressPercentagePoints: number;
  /** Received-not-invoiced gap that is MEDIUM severity. */
  rniMediumDollar: number;
  /** Received-not-invoiced gap that is HIGH severity. */
  rniHighDollar: number;
  /** Requested value making a pending change order large. */
  pendingCoDollar: number;
  /** Days open making a pending change order aged. */
  pendingCoDays: number;
  /** Cost incurred on a pending/unapproved change order. */
  unapprovedCoIncurredCostDollar: number;
  /** Unbilled value on an approved change order. */
  approvedCoUnbilledDollar: number;
  /** Days since approval before unbilled approved CO value is an exception. */
  approvedCoUnbilledDays: number;
  /** Absolute underbilling that is material. */
  underbillingDollar: number;
  /** Underbilling as a fraction of revised contract value (0.05 = 5%). */
  underbillingPctContract: number;
  /** SOV-to-revised-contract reconciliation tolerance. */
  sovToleranceDollar: number;
  /** Billed retainage versus expected SOV retainage tolerance. */
  retainageToleranceDollar: number;
  /** Absolute PM forecast movement that requires a written explanation. */
  pmChangeCommentDollar: number;
  /** Relative PM forecast movement that requires a written explanation (0.1 = 10%). */
  pmChangeCommentPct: number;
  /** EAC movement caused by a human answer that requires Controller review. */
  controllerEacChangeDollar: number;
  /** Margin movement in percentage points that requires Controller review. */
  controllerMarginMovementPercentagePoints: number;
  /** Pending-CO incurred-cost exposure as a fraction of projected profit (0.1 = 10%). */
  pendingCoCostPctProjectedProfit: number;
  /** Physical progress % at which a cost code counts as complete. */
  completeCostCodeProgressPct: number;
  /** Remaining PM forecast that is inconsistent with a complete cost code. */
  completeCostCodeRemainingForecastDollar: number;
};

export type V0Config = {
  /** Client this configuration belongs to. Later this becomes per-customer policy. */
  clientId: string;
  clientName: string;
  /** The close being prepared. */
  closeDate: IsoDate;
  /** The prior close used for month-over-month reconstruction. */
  priorComparisonDate: IsoDate;
  /** Overtime hours cost this multiple of the employee's hourly cost rate. */
  overtimeCostMultiplier: number;
  thresholds: Thresholds;
};

export const V0_CONFIG: V0Config = {
  clientId: 'C-001',
  clientName: 'Summit MEP Contractors LLC',
  closeDate: '2026-07-31',
  priorComparisonDate: '2026-06-30',
  overtimeCostMultiplier: 1.5,
  thresholds: {
    forecastStaleDays: 21,
    apPostingLagDays: 3,
    laborPostingLagDays: 3,
    unmappedCostCodeDollar: 10_000,
    unbudgetedCostDollar: 10_000,
    commitmentOverrunDollar: 10_000,
    marginFadePercentagePoints: 3.0,
    eacDeteriorationDollar: 100_000,
    eacDeteriorationPctContract: 0.025,
    costCodeOverrunPct: 0.1,
    laborBurnAheadProgressPercentagePoints: 10,
    rniMediumDollar: 20_000,
    rniHighDollar: 75_000,
    pendingCoDollar: 50_000,
    pendingCoDays: 30,
    unapprovedCoIncurredCostDollar: 25_000,
    approvedCoUnbilledDollar: 25_000,
    approvedCoUnbilledDays: 14,
    underbillingDollar: 100_000,
    underbillingPctContract: 0.05,
    sovToleranceDollar: 100,
    retainageToleranceDollar: 500,
    pmChangeCommentDollar: 50_000,
    pmChangeCommentPct: 0.1,
    controllerEacChangeDollar: 100_000,
    controllerMarginMovementPercentagePoints: 2.0,
    pendingCoCostPctProjectedProfit: 0.1,
    completeCostCodeProgressPct: 99,
    completeCostCodeRemainingForecastDollar: 10_000,
  },
};
