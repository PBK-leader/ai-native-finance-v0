/**
 * Which cost codes a forecast question is actually about, and what they currently say.
 *
 * The resolve form used to recover the cost code by splitting the exception's subject id on `-` and taking
 * the last segment. That works for a cost-code-subject rule and silently produces nonsense for a
 * project-subject one: `FC_STALE:P-1002:P-1002` yielded a cost code of `1002`, which does not exist. The
 * resulting forecast snapshot landed in the project total but in no cost code's detail, so project economics
 * stopped reconciling to their own breakdown — and the stale-forecast exception never cleared, because it
 * measures age from real cost codes.
 *
 * Resolving the targets from the canonical model instead removes the parsing entirely, and lets the form
 * pre-fill the PM's current position so they confirm or override a proposal rather than typing into a blank.
 */

import type { CanonicalModel } from '@/domain/entities';
import type { ProjectMetrics } from '@/domain/metrics';
import type { ExceptionRecord } from '@/domain/workflow';

export type ForecastTarget = {
  costCode: string;
  description: string;
  /** What the latest forecast currently says, so the form opens on the real numbers. */
  remainingUncommittedCost: number;
  remainingLaborHours: number | null;
};

/** Rules whose resolution is a forecast update rather than an answer or an adjustment. */
const FORECAST_RULES = new Set([
  'FC_STALE',
  'FC_LABOR_BURN',
  'FC_COST_CODE_OVERRUN',
  'FC_PM_CHANGE_NO_EXPLANATION',
  'FC_COMPLETE_CODE_REMAINING',
]);

export function isForecastUpdatable(exception: ExceptionRecord): boolean {
  return FORECAST_RULES.has(exception.ruleId);
}

/**
 * The cost codes a PM should be asked about for this exception.
 *
 * A stale forecast is a whole-project question — its recommended action asks for every cost code to be
 * refreshed, and forecast age is measured from the stalest line, so refreshing one would not clear it.
 * Every other forecast rule is keyed on a single cost code.
 */
export function forecastTargetsFor(
  metrics: ProjectMetrics,
  exception: ExceptionRecord,
): ForecastTarget[] {
  if (!isForecastUpdatable(exception)) return [];

  const targets = metrics.costCodes.filter((costCode) => {
    if (exception.ruleId === 'FC_STALE') {
      // Only codes that actually carry a forecast — an unmapped code has no snapshot to refresh.
      return costCode.latestForecastDate !== null;
    }
    return costCode.costCodeId === exception.subjectId;
  });

  return targets.map((costCode) => ({
    costCode: costCode.costCode,
    description: costCode.description,
    remainingUncommittedCost: costCode.pmRemainingUncommittedCost,
    remainingLaborHours: costCode.pmRemainingLaborHours,
  }));
}

/** Cost codes that exist on a project, for validating a submitted forecast line. */
export function knownCostCodes(model: CanonicalModel, projectId: string): Set<string> {
  return new Set(
    model.costCodes.filter((costCode) => costCode.projectId === projectId).map((costCode) => costCode.code),
  );
}
