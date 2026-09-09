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
  method: [
    'Read the mapping table that ties each project in the project-management system to its job in the ' +
      'accounting system.',
    'Report any source project the table leaves unmapped. The confidence score it carries is shown as ' +
      'evidence but is not itself tested — a project either has a mapping or it does not.',
    'Nothing can be measured for it: cost, labour and billing recorded against that project are invisible ' +
      'to every close calculation until a human says which job it belongs to.',
  ],
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
  method: [
    'Go through each project\'s cost codes and pick out the ones carrying charges that do not appear in ' +
      'the approved budget at all.',
    'Add up what has been charged to each, and flag it once that passes the threshold.',
    'List the posted transactions behind it, so the charge can be traced rather than just counted. The ' +
      'total also includes any adjustment a human has accepted on this code, which has no posting to show.',
    'The money is still included in the project total under an unmapped heading — nothing is dropped ' +
      'because its classification is unresolved — but it cannot be compared against a budget until it is ' +
      'coded properly.',
  ],
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
  method: [
    'Look only at cost codes that do exist in the budget structure. A code missing entirely is a different ' +
      'problem, reported separately.',
    'Keep the ones whose current budget is zero but which are carrying real charges.',
    'Flag it once those charges pass the threshold. Either the budget was never loaded, or the charges ' +
      'belong to another code.',
  ],
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
  method: [
    'For each project, find the date of the most recent forecast on every cost code that has one.',
    'Take the oldest of those dates. A project\'s forecast is only as current as its stalest line, so ' +
      'refreshing one code out of ten does not make the forecast fresh.',
    'Count the days from that date to the close, and flag it once that exceeds the staleness limit.',
    'Cost codes with no forecast at all are skipped, or they would register as infinitely old.',
  ],
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
          `The stalest cost code on ${project?.name ?? projectId} was last forecast on ${oldest}, ${age} ` +
          'days before the close, and a forecast is only as current as its oldest line. Forecast final ' +
          'cost, projected margin and the draft work-in-progress position all rest on assumptions the ' +
          `project manager has not confirmed in ${age} days.`,
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
