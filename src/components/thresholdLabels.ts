/**
 * Plain-English names for the configured thresholds a rule cites as evidence.
 *
 * Typed against the configuration so a new threshold cannot ship without a label; the raw key
 * (`laborBurnAheadProgressPercentagePoints`) is still available under "show the evidence" for anyone auditing
 * the rule, but it is not what a project manager should read first.
 */

import type { V0Config } from '@/config/v0Config';
import { count, pct, ratioPct, usd } from './format';

type ThresholdUnit = 'USD' | 'DAYS' | 'POINTS' | 'PCT' | 'PCT_FRACTION';

const THRESHOLDS: Record<keyof V0Config['thresholds'], { label: string; unit: ThresholdUnit }> = {
  forecastStaleDays: { label: 'Forecast older than', unit: 'DAYS' },
  apPostingLagDays: { label: 'Invoice unposted for more than', unit: 'DAYS' },
  laborPostingLagDays: { label: 'Time unposted for more than', unit: 'DAYS' },
  unmappedCostCodeDollar: { label: 'Cost on an unmapped code', unit: 'USD' },
  unbudgetedCostDollar: { label: 'Cost on an unbudgeted code', unit: 'USD' },
  commitmentOverrunDollar: { label: 'Invoiced over the purchase order', unit: 'USD' },
  marginFadePercentagePoints: { label: 'Margin fade', unit: 'POINTS' },
  eacDeteriorationDollar: { label: 'Forecast cost increase', unit: 'USD' },
  eacDeteriorationPctContract: { label: 'Forecast cost increase, as a share of contract', unit: 'PCT_FRACTION' },
  costCodeOverrunPct: { label: 'Cost code over budget by', unit: 'PCT_FRACTION' },
  laborBurnAheadProgressPercentagePoints: { label: 'Hours used ahead of progress', unit: 'POINTS' },
  rniMediumDollar: { label: 'Received but not invoiced', unit: 'USD' },
  rniHighDollar: { label: 'Received but not invoiced (high)', unit: 'USD' },
  pendingCoDollar: { label: 'Pending change order value', unit: 'USD' },
  pendingCoDays: { label: 'Pending change order open for', unit: 'DAYS' },
  unapprovedCoIncurredCostDollar: { label: 'Spent on unapproved change work', unit: 'USD' },
  approvedCoUnbilledDollar: { label: 'Approved change work unbilled', unit: 'USD' },
  approvedCoUnbilledDays: { label: 'Approved change work unbilled for', unit: 'DAYS' },
  underbillingDollar: { label: 'Underbilled', unit: 'USD' },
  underbillingPctContract: { label: 'Underbilled, as a share of contract', unit: 'PCT_FRACTION' },
  sovToleranceDollar: { label: 'Schedule of values off by more than', unit: 'USD' },
  retainageToleranceDollar: { label: 'Retainage off by more than', unit: 'USD' },
  pmChangeCommentDollar: { label: 'Forecast change needing an explanation', unit: 'USD' },
  pmChangeCommentPct: { label: 'Forecast change needing an explanation, as a share', unit: 'PCT_FRACTION' },
  controllerEacChangeDollar: { label: 'Forecast movement needing Controller sign-off', unit: 'USD' },
  controllerMarginMovementPercentagePoints: { label: 'Margin movement needing Controller sign-off', unit: 'POINTS' },
  pendingCoCostPctProjectedProfit: { label: 'Unapproved change cost, as a share of projected profit', unit: 'PCT_FRACTION' },
  completeCostCodeProgressPct: { label: 'Cost code reported complete at', unit: 'PCT' },
  completeCostCodeRemainingForecastDollar: { label: 'Remaining forecast on a complete code', unit: 'USD' },
};

export function hasThresholdLabel(name: string): boolean {
  return name in THRESHOLDS;
}

function formatThreshold(value: number, unit: ThresholdUnit): string {
  switch (unit) {
    case 'USD':
      return usd(value);
    case 'DAYS':
      return `${count(value)} days`;
    case 'POINTS':
      return `${value} pts`;
    case 'PCT':
      return pct(value, 0);
    case 'PCT_FRACTION':
      return ratioPct(value, 1);
  }
}

const COMPARATOR: Record<'GTE' | 'LTE' | 'GT' | 'LT', string> = { GTE: '≥', LTE: '≤', GT: '>', LT: '<' };

/** "Hours used ahead of progress ≥ 10 pts" — the rule's test, in words, with the configured number. */
export function describeThreshold(t: {
  name: string; value: number; comparator: 'GTE' | 'LTE' | 'GT' | 'LT';
}): string {
  const entry = (THRESHOLDS as Record<string, { label: string; unit: ThresholdUnit } | undefined>)[t.name];
  const label = entry?.label ?? t.name.replace(/([A-Z])/g, ' $1').toLowerCase();
  const value = entry ? formatThreshold(t.value, entry.unit) : t.value.toLocaleString('en-US');
  return `${label} ${COMPARATOR[t.comparator]} ${value}`;
}
