/**
 * Forecast and project-economics rules.
 *
 * These compare the current derived picture against budget, against the prior close, and against physical
 * progress. Unlike the AP rules — which test facts in the source systems — these test the *result* of the
 * calculation, so a human answer that genuinely fixes the economics makes them stop firing. That is the
 * intended cross-workstream ripple, and the engine emits a cleared event so the audit trail still shows it.
 */

import { latestForecastByCostCode } from '@/calculations/projectMetrics';
import { EMPTY_PROJECTION } from '@/domain/workflow';
import type { DetectedException, Rule, RuleContext } from '../types';
import { formatUsd } from './dataQuality';

export const fcMarginFade: Rule = {
  id: 'FC_MARGIN_FADE',
  workstream: 'Forecast',
  defaultOwnerRole: 'Controller',
  blocking: false,
  blockingScope: 'CLOSE',
  description: 'Projected margin has fallen materially below the original estimate.',
  evaluate(ctx: RuleContext): DetectedException[] {
    const threshold = ctx.config.thresholds.marginFadePercentagePoints;
    const found: DetectedException[] = [];

    for (const [projectId, metrics] of ctx.metrics) {
      const fade = metrics.marginFadePercentagePoints;
      if (fade === null || fade < threshold) continue;

      const project = ctx.model.index.projectById.get(projectId);

      found.push({
        projectId,
        subjectId: projectId,
        severity: 'HIGH',
        title: `Margin has faded ${fade.toFixed(2)} points below the original estimate`,
        explanation:
          `${project?.name ?? projectId} was bid at a ${metrics.originalMarginPct?.toFixed(2)}% margin and ` +
          `is now forecast to finish at ${metrics.projectedMarginPct?.toFixed(2)}% — a fade of ` +
          `${fade.toFixed(2)} percentage points, or about ` +
          `${formatUsd((fade / 100) * metrics.revisedContractValue)} of profit against the current contract.`,
        impact: (fade / 100) * metrics.revisedContractValue,
        impactUnit: 'USD',
        recommendedAction:
          'Review the cost codes driving the fade with the project manager and decide whether the forecast ' +
          'is realistic before the close is finalised.',
        evidence: {
          nodeIds: [projectId],
          sourceRefs: project?.sourceRefs ?? [],
          measured: [
            { label: 'Original margin', value: metrics.originalMarginPct, unit: 'PCT' },
            { label: 'Projected margin', value: metrics.projectedMarginPct, unit: 'PCT' },
            { label: 'Fade', value: fade, unit: 'PP' },
            { label: 'Projected profit', value: metrics.projectedProfit, unit: 'USD' },
          ],
          thresholds: [{
            name: 'marginFadePercentagePoints', value: threshold, comparator: 'GTE', met: true,
          }],
        },
      });
    }

    return found;
  },
};

export const fcEacDeterioration: Rule = {
  id: 'FC_EAC_DETERIORATION',
  workstream: 'Forecast',
  defaultOwnerRole: 'Controller',
  blocking: false,
  blockingScope: 'CLOSE',
  description: 'Forecast final cost has risen materially since the prior close.',
  evaluate(ctx: RuleContext): DetectedException[] {
    const { eacDeteriorationDollar, eacDeteriorationPctContract } = ctx.config.thresholds;
    const found: DetectedException[] = [];

    for (const [projectId, metrics] of ctx.metrics) {
      const prior = ctx.priorMetrics.get(projectId);
      if (!prior) continue;

      const change = metrics.eac - prior.eac;
      if (change <= 0) continue;

      const pctOfContract =
        metrics.revisedContractValue === 0 ? null : change / metrics.revisedContractValue;

      const meetsDollar = change >= eacDeteriorationDollar;
      const meetsPct = pctOfContract !== null && pctOfContract >= eacDeteriorationPctContract;
      if (!meetsDollar && !meetsPct) continue;

      const project = ctx.model.index.projectById.get(projectId);

      found.push({
        projectId,
        subjectId: projectId,
        severity: 'HIGH',
        title: `Forecast final cost is up ${formatUsd(change)} since the prior close`,
        explanation:
          `Estimate at completion for ${project?.name ?? projectId} has moved from ` +
          `${formatUsd(prior.eac)} at ${prior.asOfDate} to ${formatUsd(metrics.eac)} — an increase of ` +
          `${formatUsd(change)}. The prior figure is reconstructed from activity and forecasts as they ` +
          'stood at that date, so this is a genuine month-over-month movement rather than a change in how ' +
          'the number is calculated.',
        impact: change,
        impactUnit: 'USD',
        recommendedAction:
          'Review the movement with the project manager and confirm the current forecast before signing off ' +
          'the close.',
        evidence: {
          nodeIds: [projectId],
          sourceRefs: project?.sourceRefs ?? [],
          measured: [
            { label: `EAC at ${prior.asOfDate}`, value: prior.eac, unit: 'USD' },
            { label: `EAC at ${metrics.asOfDate}`, value: metrics.eac, unit: 'USD' },
            { label: 'Increase', value: change, unit: 'USD' },
            { label: 'Share of contract', value: pctOfContract === null ? null : pctOfContract * 100, unit: 'PCT' },
          ],
          thresholds: [
            { name: 'eacDeteriorationDollar', value: eacDeteriorationDollar, comparator: 'GTE', met: meetsDollar },
            {
              name: 'eacDeteriorationPctContract',
              value: eacDeteriorationPctContract,
              comparator: 'GTE',
              met: meetsPct,
            },
          ],
        },
      });
    }

    return found;
  },
};

export const fcCostCodeOverrun: Rule = {
  id: 'FC_COST_CODE_OVERRUN',
  workstream: 'Forecast',
  defaultOwnerRole: 'Project Manager',
  blocking: false,
  blockingScope: 'CLOSE',
  description: 'A cost code is forecast to finish materially over its current budget.',
  evaluate(ctx: RuleContext): DetectedException[] {
    const threshold = ctx.config.thresholds.costCodeOverrunPct;
    const found: DetectedException[] = [];

    for (const [projectId, metrics] of ctx.metrics) {
      for (const costCode of metrics.costCodes) {
        // Compared against CURRENT budget, so an approved budget revision is respected.
        // A code with no budget is a mapping problem, handled by DQ_UNMAPPED_COST_CODE.
        if (costCode.overrunPct === null) continue;
        if (costCode.overrunPct <= threshold) continue;

        const overage = costCode.eac - costCode.currentBudget;

        found.push({
          projectId,
          subjectId: costCode.costCodeId,
          severity: costCode.overrunPct >= 0.25 ? 'HIGH' : 'MEDIUM',
          title: `${costCode.costCode} ${costCode.description} is forecast ${(costCode.overrunPct * 100).toFixed(1)}% over budget`,
          explanation:
            `Cost code ${costCode.costCode} is forecast to finish at ${formatUsd(costCode.eac)} against a ` +
            `current budget of ${formatUsd(costCode.currentBudget)} — ${formatUsd(overage)} over. That is ` +
            `${formatUsd(costCode.adjustedCostToDate)} already spent, ` +
            `${formatUsd(costCode.remainingCommitment)} still committed and ` +
            `${formatUsd(costCode.pmRemainingUncommittedCost)} of remaining uncommitted forecast.`,
          impact: overage,
          impactUnit: 'USD',
          recommendedAction:
            'Confirm the remaining forecast for this cost code, and identify whether the overrun is ' +
            'recoverable through a change order.',
          evidence: {
            nodeIds: [costCode.costCodeId, projectId],
            sourceRefs: ctx.model.index.budgetLineByCostCode.get(costCode.costCodeId)?.sourceRefs ?? [],
            measured: [
              { label: 'Current budget', value: costCode.currentBudget, unit: 'USD' },
              { label: 'Forecast at completion', value: costCode.eac, unit: 'USD' },
              { label: 'Over budget by', value: overage, unit: 'USD' },
              { label: 'Overrun', value: costCode.overrunPct * 100, unit: 'PCT' },
            ],
            thresholds: [{ name: 'costCodeOverrunPct', value: threshold, comparator: 'GTE', met: true }],
          },
        });
      }
    }

    return found;
  },
};

export const fcLaborBurn: Rule = {
  id: 'FC_LABOR_BURN',
  workstream: 'Forecast',
  defaultOwnerRole: 'Project Manager',
  blocking: false,
  blockingScope: 'CLOSE',
  description: 'Labour hours are being consumed faster than physical progress.',
  evaluate(ctx: RuleContext): DetectedException[] {
    const threshold = ctx.config.thresholds.laborBurnAheadProgressPercentagePoints;
    const found: DetectedException[] = [];

    for (const [projectId, metrics] of ctx.metrics) {
      for (const costCode of metrics.costCodes) {
        // With no budgeted hours there is no meaningful consumption ratio — the config is explicit that we
        // must not raise this exception from a zero denominator.
        // A null consumption percentage means either no budgeted hours or no labour aggregate for this
        // as-of date. Neither is a productivity finding, so the rule must not fire from it.
        if (costCode.hoursConsumedPct === null) continue;
        if (costCode.actualLaborHours === null) continue;
        if (costCode.physicalProgressPct === null) continue;

        const gap = costCode.hoursConsumedPct - costCode.physicalProgressPct;
        if (gap < threshold) continue;

        found.push({
          projectId,
          subjectId: costCode.costCodeId,
          severity: 'HIGH',
          title: `${costCode.costCode} has burned ${costCode.hoursConsumedPct.toFixed(1)}% of hours for ${costCode.physicalProgressPct}% progress`,
          explanation:
            `The crew has used ${costCode.actualLaborHours.toLocaleString('en-US')} of ` +
            `${costCode.budgetedLaborHours.toLocaleString('en-US')} budgeted hours on ${costCode.costCode}, ` +
            `but the project manager reports the work is only ${costCode.physicalProgressPct}% complete. ` +
            `At this rate the remaining ${(100 - costCode.physicalProgressPct).toFixed(0)}% of work has ` +
            `far fewer hours left than it needs.`,
          impact: gap,
          impactUnit: 'PP',
          recommendedAction:
            'Ask the project manager to confirm remaining labour hours and remaining cost for this cost ' +
            'code, and explain what is driving the productivity gap.',
          evidence: {
            nodeIds: [costCode.costCodeId, projectId],
            sourceRefs: ctx.model.progressSnapshots
              .filter((s) => s.costCodeId === costCode.costCodeId && s.asOfDate === costCode.latestProgressDate)
              .flatMap((s) => s.sourceRefs),
            measured: [
              { label: 'Budgeted hours', value: costCode.budgetedLaborHours, unit: 'HOURS' },
              { label: 'Actual hours', value: costCode.actualLaborHours, unit: 'HOURS' },
              { label: 'Hours consumed', value: costCode.hoursConsumedPct, unit: 'PCT' },
              { label: 'Physical progress', value: costCode.physicalProgressPct, unit: 'PCT' },
              { label: 'Gap', value: gap, unit: 'PP' },
              { label: 'PM remaining hours', value: costCode.pmRemainingLaborHours, unit: 'HOURS' },
            ],
            thresholds: [{
              name: 'laborBurnAheadProgressPercentagePoints',
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

export const fcPmChangeNoExplanation: Rule = {
  id: 'FC_PM_CHANGE_NO_EXPLANATION',
  workstream: 'Forecast',
  defaultOwnerRole: 'Project Manager',
  blocking: false,
  blockingScope: 'CLOSE',
  description: 'A material forecast movement has no written explanation.',
  evaluate(ctx: RuleContext): DetectedException[] {
    const { pmChangeCommentDollar, pmChangeCommentPct } = ctx.config.thresholds;
    const found: DetectedException[] = [];

    for (const projectId of ctx.metrics.keys()) {
      const current = latestForecastByCostCode(ctx.model, ctx.projection, projectId, ctx.asOfDate);
      // The prior comparison always reads source history with no overlay — a human answer is the thing being
      // compared, not part of the baseline it is compared against.
      const prior = latestForecastByCostCode(
        ctx.model, EMPTY_PROJECTION, projectId, ctx.config.priorComparisonDate,
      );

      for (const [costCodeId, snapshot] of current) {
        // "Without explanation" means the CURRENT comment is blank after trimming. A prior narrative does
        // not explain a new movement.
        if (snapshot.comment.trim() !== '') continue;

        const priorSnapshot = prior.get(costCodeId);
        // Same snapshot on both sides means nothing has moved.
        if (priorSnapshot && priorSnapshot.id === snapshot.id) continue;

        const priorValue = priorSnapshot?.pmRemainingUncommittedCost ?? 0;
        const change = snapshot.pmRemainingUncommittedCost - priorValue;
        const absoluteChange = Math.abs(change);

        const meetsDollar = absoluteChange >= pmChangeCommentDollar;
        // With no prior value there is no percentage to take, so the dollar test stands alone.
        const meetsPct =
          priorValue !== 0 && Math.abs(change / priorValue) >= pmChangeCommentPct;
        if (!meetsDollar && !meetsPct) continue;

        const costCode = ctx.model.index.costCodeById.get(costCodeId);
        const direction = change > 0 ? 'increased' : 'reduced';

        found.push({
          projectId,
          subjectId: costCodeId,
          severity: 'MEDIUM',
          title: `Forecast for ${costCode?.code ?? costCodeId} ${direction} by ${formatUsd(absoluteChange)} with no explanation`,
          explanation:
            `Remaining uncommitted cost on ${costCode?.code ?? costCodeId} moved from ` +
            `${formatUsd(priorValue)} to ${formatUsd(snapshot.pmRemainingUncommittedCost)} between ` +
            `${priorSnapshot?.asOfDate ?? 'the prior close'} and ${snapshot.asOfDate}, and the current ` +
            'snapshot carries no comment. A movement this size needs a reason recorded, both for the ' +
            'Controller review and so the pattern can be understood later.',
          impact: absoluteChange,
          impactUnit: 'USD',
          recommendedAction:
            'Ask the project manager to record why the remaining forecast changed.',
          evidence: {
            nodeIds: [costCodeId, snapshot.id, ...(priorSnapshot ? [priorSnapshot.id] : [])],
            sourceRefs: [...snapshot.sourceRefs, ...(priorSnapshot?.sourceRefs ?? [])],
            measured: [
              { label: 'Prior remaining', value: priorValue, unit: 'USD' },
              { label: 'Current remaining', value: snapshot.pmRemainingUncommittedCost, unit: 'USD' },
              { label: 'Change', value: change, unit: 'USD' },
            ],
            thresholds: [
              { name: 'pmChangeCommentDollar', value: pmChangeCommentDollar, comparator: 'GTE', met: meetsDollar },
              { name: 'pmChangeCommentPct', value: pmChangeCommentPct, comparator: 'GTE', met: meetsPct },
            ],
          },
        });
      }
    }

    return found;
  },
};

export const fcProfitRiskConcentration: Rule = {
  id: 'FC_PROFIT_RISK_CONCENTRATION',
  workstream: 'Forecast',
  defaultOwnerRole: 'Controller',
  blocking: false,
  blockingScope: 'CLOSE',
  description: 'Cost already spent on unapproved change work is material against projected profit.',
  evaluate(ctx: RuleContext): DetectedException[] {
    const threshold = ctx.config.thresholds.pendingCoCostPctProjectedProfit;
    const found: DetectedException[] = [];

    for (const [projectId, metrics] of ctx.metrics) {
      // Exposure is cost already incurred on unapproved work, not the requested value of the change order.
      // Money spent is the money genuinely at risk; a requested value is a negotiating position.
      const exposure = metrics.pendingChangeOrderIncurredCost;
      if (exposure <= 0) continue;

      const profit = metrics.projectedProfit;
      const share = profit > 0 ? exposure / profit : null;

      // With no profit to divide into, the exposure is inherently material rather than infinite.
      if (share !== null && share < threshold) continue;

      const project = ctx.model.index.projectById.get(projectId);
      const pendingCos = ctx.model.changeOrders.filter(
        (co) => co.projectId === projectId && co.status === 'pending' && co.costIncurredToDate > 0,
      );
      const requestedValue = pendingCos.reduce((total, co) => total + co.requestedValue, 0);

      found.push({
        projectId,
        subjectId: projectId,
        severity: share === null ? 'HIGH' : 'MEDIUM',
        title:
          share === null
            ? `${formatUsd(exposure)} spent on unapproved change work with no projected profit`
            : `${formatUsd(exposure)} of unrecovered cost on unapproved change work, ${(share * 100).toFixed(1)}% of projected profit`,
        explanation:
          `${project?.name ?? projectId} has spent ${formatUsd(exposure)} performing change work the client ` +
          'has not approved. That cost is already in the forecast, but the revenue is not: pending change ' +
          'orders do not increase contract value until they are approved. ' +
          (share === null
            ? 'The project is not currently forecast to make a profit, so any amount that goes unrecovered ' +
              'deepens the loss directly.'
            : `So projected profit of ${formatUsd(profit)} is already carrying this cost — approval would ` +
              `add up to ${formatUsd(requestedValue)} of contract value and recover it, while rejection ` +
              `makes ${formatUsd(exposure)} permanently unrecovered. The exposure is ` +
              `${(share * 100).toFixed(1)}% of the profit currently forecast.`),
        impact: exposure,
        impactUnit: 'USD',
        recommendedAction:
          'Review the pending change orders with the project manager and decide whether to press for ' +
          'approval, stop the work, or reserve against the exposure.',
        evidence: {
          nodeIds: [projectId, ...pendingCos.map((co) => co.id)],
          sourceRefs: pendingCos.flatMap((co) => co.sourceRefs),
          measured: [
            { label: 'Cost incurred on pending COs', value: exposure, unit: 'USD' },
            { label: 'Value requested if approved', value: requestedValue, unit: 'USD' },
            { label: 'Projected profit (already bearing this cost)', value: profit, unit: 'USD' },
            { label: 'Exposure share', value: share === null ? null : share * 100, unit: 'PCT' },
            { label: 'Pending change orders', value: pendingCos.length, unit: 'COUNT' },
          ],
          thresholds: [{
            name: 'pendingCoCostPctProjectedProfit', value: threshold, comparator: 'GTE', met: true,
          }],
        },
      });
    }

    return found;
  },
};

export const fcCompleteCodeRemaining: Rule = {
  id: 'FC_COMPLETE_CODE_REMAINING',
  workstream: 'Forecast',
  defaultOwnerRole: 'Project Manager',
  blocking: false,
  blockingScope: 'CLOSE',
  description: 'A cost code reported complete still carries remaining forecast cost.',
  evaluate(ctx: RuleContext): DetectedException[] {
    const { completeCostCodeProgressPct, completeCostCodeRemainingForecastDollar } = ctx.config.thresholds;
    const found: DetectedException[] = [];

    for (const [projectId, metrics] of ctx.metrics) {
      for (const costCode of metrics.costCodes) {
        if (costCode.physicalProgressPct === null) continue;
        if (costCode.physicalProgressPct < completeCostCodeProgressPct) continue;
        if (costCode.pmRemainingUncommittedCost < completeCostCodeRemainingForecastDollar) continue;

        found.push({
          projectId,
          subjectId: costCode.costCodeId,
          severity: 'MEDIUM',
          title: `${costCode.costCode} is ${costCode.physicalProgressPct}% complete but still forecasts ${formatUsd(costCode.pmRemainingUncommittedCost)}`,
          explanation:
            `${costCode.costCode} ${costCode.description} is reported as ${costCode.physicalProgressPct}% ` +
            `complete, yet the forecast still carries ${formatUsd(costCode.pmRemainingUncommittedCost)} of ` +
            'remaining uncommitted cost. Either the work is not actually finished or the forecast should be ' +
            'released — this is a forecast-consistency question, not an accounting entry.',
          impact: costCode.pmRemainingUncommittedCost,
          impactUnit: 'USD',
          recommendedAction:
            'Confirm whether the remaining forecast should be released or the progress percentage corrected.',
          evidence: {
            nodeIds: [costCode.costCodeId, projectId],
            sourceRefs: ctx.model.progressSnapshots
              .filter((s) => s.costCodeId === costCode.costCodeId && s.asOfDate === costCode.latestProgressDate)
              .flatMap((s) => s.sourceRefs),
            measured: [
              { label: 'Physical progress', value: costCode.physicalProgressPct, unit: 'PCT' },
              { label: 'Remaining forecast', value: costCode.pmRemainingUncommittedCost, unit: 'USD' },
            ],
            thresholds: [
              {
                name: 'completeCostCodeProgressPct',
                value: completeCostCodeProgressPct,
                comparator: 'GTE',
                met: true,
              },
              {
                name: 'completeCostCodeRemainingForecastDollar',
                value: completeCostCodeRemainingForecastDollar,
                comparator: 'GTE',
                met: true,
              },
            ],
          },
        });
      }
    }

    return found;
  },
};

export const forecastRules: Rule[] = [
  fcMarginFade,
  fcEacDeterioration,
  fcCostCodeOverrun,
  fcLaborBurn,
  fcPmChangeNoExplanation,
  fcProfitRiskConcentration,
  fcCompleteCodeRemaining,
];
