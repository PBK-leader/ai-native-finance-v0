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
  method: [
    'Take the margin the job was bid at, from the original estimate.',
    'Take the margin it is now forecast to finish at, using the current forecast of final cost against the ' +
      'revised contract.',
    'Subtract one from the other to get the fade, in percentage points.',
    'Flag it once the fade passes the threshold, and translate it back into dollars against the current ' +
      'contract so the size of the profit movement is legible.',
    'A project whose margin cannot be worked out — no contract value, or cost with no forecast — is absent ' +
      'from this check rather than passing it. That is a data-quality problem and is raised as one.',
  ],
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
  method: [
    'Rebuild the forecast of final cost as it stood at the prior close, from the activity and forecasts ' +
      'that existed on that date.',
    'Compare it with the forecast today, and keep only projects where the number has risen.',
    'Flag it when the increase is large in dollars, or large as a share of the contract. Either test alone ' +
      'is enough.',
    'Because the prior figure is recalculated the same way rather than read from a stored report, the ' +
      'movement is not an artefact of changing how the number is worked out.',
    'Read the size as directional rather than exact. Only invoices relieve a purchase order in this ' +
      'prototype, so the prior figure still carries full commitment balances alongside cost already posted ' +
      'against the same codes, which overstates it.',
  ],
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
          'stood at that date, so the direction is a genuine month-over-month movement rather than a change ' +
          'in how the number is calculated. Treat the exact size as indicative: prior-period commitment ' +
          'relief is not modelled, so the starting figure runs high.',
        impact: change,
        impactUnit: 'USD',
        recommendedAction:
          'Review the movement with the project manager and confirm the current forecast before signing off ' +
          'the close.',
        evidence: {
          nodeIds: [projectId],
          sourceRefs: project?.sourceRefs ?? [],
          measured: [
            { label: `Forecast final cost at ${prior.asOfDate}`, value: prior.eac, unit: 'USD' },
            { label: `Forecast final cost at ${metrics.asOfDate}`, value: metrics.eac, unit: 'USD' },
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
  method: [
    'For each cost code, build the forecast of final cost: what has been spent, plus what is still ' +
      'committed on purchase orders, plus the remaining cost the project manager expects on top of that.',
    'Compare it against the current budget, which already includes any approved budget revision.',
    'Flag it when the forecast is over budget by more than the allowed percentage, and treat a larger ' +
      'overrun as more serious.',
    'A code with no budget at all is skipped, because there is nothing to compare against. That is a ' +
      'coding problem, reported separately — though only once the cost on it is large enough to raise.',
  ],
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
  method: [
    'For each cost code, add up the approved hours the crew has booked and express them as a percentage of ' +
      'the budgeted hours. Time still awaiting approval is left out.',
    'Take the physical progress the project manager has reported for the same cost code.',
    'Subtract progress from hours consumed. A positive gap means the hours are going faster than the work.',
    'Flag it once that gap passes the threshold, measured in percentage points.',
    'Cost codes with no budgeted hours are skipped rather than divided by zero — no budget is not a ' +
      'productivity finding.',
  ],
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
              { label: 'Hours the project manager still expects', value: costCode.pmRemainingLaborHours, unit: 'HOURS' },
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
  method: [
    'Take the latest forecast on each cost code and keep the ones whose comment is blank.',
    'Find the forecast for the same cost code as it stood at the prior close, read from source history ' +
      'with no human answers layered on. The answer is the thing being judged, so it cannot also be the ' +
      'baseline it is judged against.',
    'Subtract the old remaining cost from the new one to get the movement.',
    'Flag it when that movement is large in dollars, or large as a share of the previous figure. With no ' +
      'previous figure to divide into, the dollar test stands alone.',
    'A comment written last month does not explain a change made this month, which is why only the current ' +
      'comment counts.',
  ],
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
  method: [
    'Add up the cost already spent on change orders that are still pending a client decision. Money spent ' +
      'is what is genuinely at risk; the value being asked for is only a negotiating position.',
    'Divide that exposure by the profit the project is currently forecast to make.',
    'Flag it once the exposure is a large enough share of that profit.',
    'The contract carries none of this revenue, because a pending change order adds nothing to contract ' +
      'value until it is approved.',
    'Whether the forecast already carries the cost is taken from the change order record and is not checked ' +
      'against the job-cost ledger — there is no key linking the two. Confirm it is in cost to date before ' +
      'relying on the profit figure below: if it is not, forecast cost is understated by this amount and the ' +
      'exposure is the smaller of the two problems.',
    'Where the project is not forecast to make a profit at all, there is nothing to divide into and the ' +
      'exposure is treated as material on its own.',
  ],
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
          'has not approved, according to the change orders themselves. The revenue is certainly not in the ' +
          'contract: pending change orders do not increase contract value until they are approved. Whether ' +
          'the cost has reached the job-cost ledger is not something this prototype can confirm, so check ' +
          'that before treating the profit figure as complete. ' +
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
            { label: 'Spent on unapproved change work', value: exposure, unit: 'USD' },
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
  method: [
    'Find the cost codes the project manager has reported as finished, or as good as finished.',
    'Check whether the forecast for those same codes still expects more money to be spent.',
    'Flag it when both hold at once and the remaining forecast is large enough to matter.',
    'The two statements contradict each other: either the work is not actually done, or the leftover ' +
      'forecast should be released back into the project.',
  ],
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
