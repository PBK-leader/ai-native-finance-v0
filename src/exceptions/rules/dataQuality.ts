/**
 * Data-quality rules: things that make the numbers untrustworthy rather than merely unfavourable.
 *
 * The governing principle from `FINANCIAL_LOGIC_V0.md`: cost that is economically real is never dropped
 * because its classification is unresolved. An unmapped cost code still contributes to the project's EAC —
 * it is simply reported so a human can classify it.
 */

import { ageInDays } from '@/domain/dates';
import type { DetectedException, Rule, RuleContext } from '../types';

export const dqProjectMap: Rule = {
  id: 'DQ_PROJECT_MAP',
  workstream: 'Data Quality',
  defaultOwnerRole: 'Project Accountant',
  blocking: true,
  blockingScope: 'CLOSE',
  description: 'A source project cannot be mapped to a canonical project.',
  evaluate(ctx: RuleContext): DetectedException[] {
    return ctx.model.unmappedSources.map((unmapped) => ({
      // No canonical project exists for this record — that is precisely the problem being reported.
      projectId: null,
      subjectId: unmapped.sourceKey,
      severity: 'HIGH',
      title: `Source project ${unmapped.sourceKey} has no canonical mapping`,
      explanation:
        `${unmapped.sourceKey} appears in the project-management system but cannot be matched to a job in ` +
        'the ERP. Any cost, labour or billing recorded against it is invisible to portfolio reporting and to ' +
        'every close calculation.',
      impact: null,
      impactUnit: null,
      recommendedAction:
        'Confirm which ERP job this project corresponds to, or confirm that it should be excluded from the ' +
        'close, and record the mapping decision.',
      evidence: {
        nodeIds: [`UNMAPPED-${unmapped.sourceKey}`],
        sourceRefs: [unmapped.sourceRef],
        measured: [
          { label: 'Mapping confidence', value: unmapped.sourceRef.confidence ?? null, unit: 'PCT' },
        ],
        thresholds: [],
      },
    }));
  },
};

export const dqUnmappedCostCode: Rule = {
  id: 'DQ_UNMAPPED_COST_CODE',
  workstream: 'Data Quality',
  defaultOwnerRole: 'Project Accountant',
  blocking: true,
  blockingScope: 'CLOSE',
  description: 'Material cost is posted to a cost code that is not in the project budget.',
  evaluate(ctx: RuleContext): DetectedException[] {
    const threshold = ctx.config.thresholds.unmappedCostCodeDollar;
    const found: DetectedException[] = [];

    for (const [projectId, metrics] of ctx.metrics) {
      for (const costCode of metrics.costCodes) {
        if (costCode.mapped) continue;
        if (costCode.adjustedCostToDate < threshold) continue;

        // Cite the actual postings, not just the code, so the accountant can see what was charged.
        const postings = ctx.model.jobCostTransactions.filter(
          (txn) => txn.costCodeId === costCode.costCodeId && txn.postingDate <= ctx.asOfDate,
        );

        found.push({
          projectId,
          subjectId: costCode.costCodeId,
          severity: 'HIGH',
          title: `Cost code ${costCode.costCode} is not in the project budget`,
          explanation:
            `${formatUsd(costCode.adjustedCostToDate)} has been charged to cost code ${costCode.costCode}, ` +
            'which does not exist in the approved budget. The cost is still included in the project total ' +
            'under UNMAPPED so nothing is lost, but it cannot be compared against a budget and it distorts ' +
            'cost-code reporting until it is classified.',
          impact: costCode.adjustedCostToDate,
          impactUnit: 'USD',
          recommendedAction:
            'Identify the correct cost code for this charge and reclassify it, or add the code to the ' +
            'project budget if the scope is genuinely new.',
          evidence: {
            nodeIds: [costCode.costCodeId, ...postings.map((p) => p.id)],
            sourceRefs: postings.flatMap((p) => p.sourceRefs),
            measured: [
              { label: 'Cost on unmapped code', value: costCode.adjustedCostToDate, unit: 'USD' },
              { label: 'Postings affected', value: postings.length, unit: 'COUNT' },
            ],
            thresholds: [{
              name: 'unmappedCostCodeDollar',
              value: threshold,
              comparator: 'GTE',
              met: true,
            }],
          },
        });
      }
    }

    return found;
  },
};

export const dqUnbudgetedCost: Rule = {
  id: 'DQ_UNBUDGETED_COST',
  workstream: 'Data Quality',
  defaultOwnerRole: 'Project Accountant',
  blocking: true,
  blockingScope: 'CLOSE',
  description: 'A budgeted cost code carries material cost against a zero budget.',
  evaluate(ctx: RuleContext): DetectedException[] {
    const threshold = ctx.config.thresholds.unbudgetedCostDollar;
    const found: DetectedException[] = [];

    for (const [projectId, metrics] of ctx.metrics) {
      for (const costCode of metrics.costCodes) {
        // Only for codes that DO map. An unmapped code is a mapping problem, reported by the rule above.
        if (!costCode.mapped) continue;
        if (costCode.currentBudget > 0) continue;
        if (costCode.adjustedCostToDate < threshold) continue;

        found.push({
          projectId,
          subjectId: costCode.costCodeId,
          severity: 'HIGH',
          title: `Cost code ${costCode.costCode} has cost but no budget`,
          explanation:
            `${formatUsd(costCode.adjustedCostToDate)} has been charged to ${costCode.costCode}, which is in ` +
            'the budget structure but carries a current budget of zero. Either the budget was never loaded ' +
            'or the charges belong somewhere else.',
          impact: costCode.adjustedCostToDate,
          impactUnit: 'USD',
          recommendedAction:
            'Confirm the intended budget for this cost code, or reclassify the charges.',
          evidence: {
            nodeIds: [costCode.costCodeId],
            sourceRefs: [],
            measured: [
              { label: 'Cost to date', value: costCode.adjustedCostToDate, unit: 'USD' },
              { label: 'Current budget', value: costCode.currentBudget, unit: 'USD' },
            ],
            thresholds: [{ name: 'unbudgetedCostDollar', value: threshold, comparator: 'GTE', met: true }],
          },
        });
      }
    }

    return found;
  },
};

export const fcStale: Rule = {
  id: 'FC_STALE',
  workstream: 'Forecast',
  defaultOwnerRole: 'Project Manager',
  blocking: true,
  // Narrower than a full close block: a stale forecast invalidates forecast/WIP, not AP or billing.
  blockingScope: 'FORECAST_WIP',
  description: 'The PM forecast has not been refreshed recently enough to rely on.',
  evaluate(ctx: RuleContext): DetectedException[] {
    const threshold = ctx.config.thresholds.forecastStaleDays;
    const found: DetectedException[] = [];

    for (const [projectId, metrics] of ctx.metrics) {
      // Age is measured from the OLDEST cost code's latest snapshot: a project's forecast is only as fresh
      // as its stalest line. Refreshing one of ten cost codes must not declare the whole forecast current.
      // Only cost codes that actually carry a forecast are considered — an unmapped code has no snapshot and
      // would otherwise register as infinitely stale.
      const dates = metrics.costCodes
        .map((c) => c.latestForecastDate)
        .filter((d): d is string => d !== null);
      if (dates.length === 0) continue;

      const oldest = dates.reduce((a, b) => (a <= b ? a : b));
      const age = ageInDays(oldest, ctx.asOfDate);
      if (age <= threshold) continue;

      const project = ctx.model.index.projectById.get(projectId);
      const staleCodes = metrics.costCodes.filter((c) => c.latestForecastDate === oldest);
      const staleSnapshots = ctx.model.forecastSnapshots.filter(
        (s) => s.projectId === projectId && s.asOfDate === oldest,
      );

      found.push({
        projectId,
        subjectId: projectId,
        severity: 'MEDIUM',
        title: `PM forecast is ${age} days old`,
        explanation:
          `The most recent forecast for ${project?.name ?? projectId} dates from ${oldest}, ${age} days ` +
          `before the close. Estimate at completion, projected margin and the draft WIP position all rest ` +
          'on assumptions the project manager has not confirmed for over three weeks.',
        impact: age,
        impactUnit: 'DAYS',
        recommendedAction:
          'Ask the project manager to refresh remaining cost and remaining labour hours for every cost code ' +
          'before the close is finalised.',
        evidence: {
          nodeIds: [projectId, ...staleCodes.map((c) => c.costCodeId), ...staleSnapshots.map((s) => s.id)],
          // The project's own source refs carry the PM-system project key, which is what a project manager
          // searches on — the canonical id means nothing to them.
          sourceRefs: [...(project?.sourceRefs ?? []), ...staleSnapshots.flatMap((s) => s.sourceRefs)],
          measured: [
            { label: 'Forecast age', value: age, unit: 'DAYS' },
            { label: 'Cost codes at that date', value: staleCodes.length, unit: 'COUNT' },
          ],
          thresholds: [{ name: 'forecastStaleDays', value: threshold, comparator: 'GTE', met: true }],
        },
      });
    }

    return found;
  },
};

/** Shared money formatting for explanation prose. Presentation only — never used in a comparison. */
export function formatUsd(value: number): string {
  return `$${Math.round(value).toLocaleString('en-US')}`;
}

export const dataQualityRules: Rule[] = [dqProjectMap, dqUnmappedCostCode, dqUnbudgetedCost, fcStale];
