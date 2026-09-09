/**
 * Change-order and billing rules.
 *
 * The commercial edge of the close: work done but not contracted, contracted but not scheduled, scheduled but
 * not billed. The CO→SOV relationship is reached through the reconciled view rather than a field, because a
 * human can create it — recording a missing SOV line is exactly what resolves `CO_MISSING_SOV`.
 */

import { ageInDays, onOrBefore } from '@/domain/dates';
import { withinTolerance } from '@/domain/money';
import type { DetectedException, Rule, RuleContext } from '../types';
import { formatUsd } from './dataQuality';

export const coLargeAging: Rule = {
  id: 'CO_LARGE_AGING',
  workstream: 'Change Orders',
  defaultOwnerRole: 'Project Manager',
  blocking: false,
  blockingScope: 'CLOSE',
  description: 'A large change order has been pending for too long.',
  method: [
    'Take every change order still marked pending that was submitted on or before the close date.',
    'Count the days from the date it was submitted to the close date.',
    'Flag it only when it is both large enough and old enough to matter — a big change order raised last ' +
      'week is normal, and a small one left open is not worth anyone\'s time.',
  ],
  evaluate(ctx: RuleContext): DetectedException[] {
    const { pendingCoDollar, pendingCoDays } = ctx.config.thresholds;
    const found: DetectedException[] = [];

    for (const co of ctx.model.changeOrders) {
      if (co.status !== 'pending') continue;
      if (!onOrBefore(co.submittedDate, ctx.asOfDate)) continue;

      const daysOpen = ageInDays(co.submittedDate, ctx.asOfDate);
      // Both conditions must hold: a large recent CO is normal, and a small old one is not worth a task.
      if (co.requestedValue < pendingCoDollar || daysOpen < pendingCoDays) continue;

      found.push({
        projectId: co.projectId,
        subjectId: co.id,
        severity: co.requestedValue >= pendingCoDollar * 4 ? 'HIGH' : 'MEDIUM',
        title: `${formatUsd(co.requestedValue)} change order has been open ${daysOpen} days`,
        explanation:
          `"${co.description}" was submitted on ${co.submittedDate} for ${formatUsd(co.requestedValue)} and ` +
          `is still unapproved ${daysOpen} days later. It cannot be added to the contract or billed while ` +
          `it sits, and ${formatUsd(co.costIncurredToDate)} of cost has already been booked against it.`,
        impact: co.requestedValue,
        impactUnit: 'USD',
        recommendedAction:
          'Chase the client for a decision, and confirm whether work should continue while it is unapproved.',
        evidence: {
          nodeIds: [co.id, co.projectId],
          sourceRefs: co.sourceRefs,
          measured: [
            { label: 'Requested value', value: co.requestedValue, unit: 'USD' },
            { label: 'Days open', value: daysOpen, unit: 'DAYS' },
            { label: 'Cost already incurred', value: co.costIncurredToDate, unit: 'USD' },
          ],
          thresholds: [
            { name: 'pendingCoDollar', value: pendingCoDollar, comparator: 'GTE', met: true },
            { name: 'pendingCoDays', value: pendingCoDays, comparator: 'GTE', met: true },
          ],
        },
      });
    }

    return found;
  },
};

export const coUnapprovedCost: Rule = {
  id: 'CO_UNAPPROVED_COST',
  workstream: 'Change Orders',
  defaultOwnerRole: 'Project Manager',
  blocking: true,
  blockingScope: 'CLOSE',
  description: 'Material cost has been spent on change work that is not approved.',
  method: [
    'Take every change order still marked pending that was submitted on or before the close date.',
    'Read the cost already booked against it.',
    'Flag it when that spend passes the threshold, and work out what margin rides on approval by ' +
      'subtracting the cost spent from the value being asked for.',
    'Rejected change orders are left out: there is nothing left to negotiate, so the money is simply cost ' +
      'on the job rather than an open commercial question.',
  ],
  evaluate(ctx: RuleContext): DetectedException[] {
    const threshold = ctx.config.thresholds.unapprovedCoIncurredCostDollar;
    const found: DetectedException[] = [];

    for (const co of ctx.model.changeOrders) {
      // Rejected change orders are excluded: there is no prospect of recovery, so this is not an open
      // commercial question — it is simply cost on the job.
      if (co.status !== 'pending') continue;
      if (!onOrBefore(co.submittedDate, ctx.asOfDate)) continue;
      if (co.costIncurredToDate < threshold) continue;

      const recovery = co.requestedValue - co.costIncurredToDate;

      found.push({
        projectId: co.projectId,
        subjectId: co.id,
        severity: 'HIGH',
        title: `${formatUsd(co.costIncurredToDate)} spent on unapproved change "${co.description}"`,
        explanation:
          `The crew has already incurred ${formatUsd(co.costIncurredToDate)} performing "${co.description}", ` +
          `which the client has not approved. The change order asks for ${formatUsd(co.requestedValue)}, so ` +
          `${formatUsd(recovery)} of margin rides on approval — and the whole amount is at risk if it is ` +
          'refused.',
        impact: co.costIncurredToDate,
        impactUnit: 'USD',
        recommendedAction:
          'Confirm who authorised the work and secure written approval, or stop the work and quantify the ' +
          'exposure for the Controller.',
        evidence: {
          nodeIds: [co.id, co.projectId],
          sourceRefs: co.sourceRefs,
          measured: [
            { label: 'Cost incurred', value: co.costIncurredToDate, unit: 'USD' },
            { label: 'Requested value', value: co.requestedValue, unit: 'USD' },
            { label: 'Margin if approved', value: recovery, unit: 'USD' },
            { label: 'Days open', value: ageInDays(co.submittedDate, ctx.asOfDate), unit: 'DAYS' },
          ],
          thresholds: [{
            name: 'unapprovedCoIncurredCostDollar', value: threshold, comparator: 'GTE', met: true,
          }],
        },
      });
    }

    return found;
  },
};

export const coMissingSov: Rule = {
  id: 'CO_MISSING_SOV',
  workstream: 'Change Orders',
  defaultOwnerRole: 'Project Accountant',
  blocking: true,
  blockingScope: 'CLOSE',
  description: 'An approved change order has no line on the schedule of values.',
  method: [
    'Take every change order the client approved on or before the close date.',
    'Look for a matching line on the schedule of values — the breakdown the client is actually invoiced ' +
      'against.',
    'Flag any approved change order with no line, because the revenue counts towards the contract but ' +
      'cannot be billed until it appears on the schedule.',
    'The match is looked up rather than stored, so a line an accountant records here clears this the next ' +
      'time the numbers are recomputed.',
  ],
  evaluate(ctx: RuleContext): DetectedException[] {
    const found: DetectedException[] = [];

    for (const co of ctx.model.changeOrders) {
      if (co.status !== 'approved') continue;
      if (!onOrBefore(co.approvalDate, ctx.asOfDate)) continue;
      // Reached through the view, so an SOV line a human recorded resolves this on the next recomputation.
      if (ctx.view.sovItemForChangeOrder(co.id) !== null) continue;

      found.push({
        projectId: co.projectId,
        subjectId: co.id,
        severity: 'HIGH',
        title: `Approved change order ${formatUsd(co.approvedValue)} is missing from the schedule of values`,
        explanation:
          `"${co.description}" was approved on ${co.approvalDate} for ${formatUsd(co.approvedValue)}, but ` +
          'no matching line exists on the schedule of values. The revenue is in the contract and is not ' +
          'billable, so the schedule of values no longer reconciles to the revised contract and this money ' +
          'cannot be invoiced to the client.',
        impact: co.approvedValue,
        impactUnit: 'USD',
        recommendedAction:
          'Add the approved change order to the schedule of values so it can be billed.',
        evidence: {
          nodeIds: [co.id, co.projectId],
          sourceRefs: co.sourceRefs,
          measured: [
            { label: 'Approved value', value: co.approvedValue, unit: 'USD' },
            { label: 'Days since approval', value: ageInDays(co.approvalDate!, ctx.asOfDate), unit: 'DAYS' },
          ],
          thresholds: [],
        },
      });
    }

    return found;
  },
};

export const coApprovedUnbilled: Rule = {
  id: 'CO_APPROVED_UNBILLED',
  workstream: 'Change Orders',
  defaultOwnerRole: 'Project Accountant',
  blocking: false,
  blockingScope: 'CLOSE',
  description: 'An approved change order has been billable for a while and is still unbilled.',
  method: [
    'Take every change order the client approved on or before the close date.',
    'Find its line on the schedule of values and add up everything billed against that line.',
    'Subtract what has been billed from the approved value to get what is still uninvoiced.',
    'Flag it when that unbilled amount is large enough and enough days have passed since approval.',
    'A change order with no schedule line counts as entirely unbilled, but stays quiet while the missing ' +
      'line is being fixed — so you are not asked to bill something that has nowhere to be billed from.',
  ],
  evaluate(ctx: RuleContext): DetectedException[] {
    const { approvedCoUnbilledDollar, approvedCoUnbilledDays } = ctx.config.thresholds;
    const found: DetectedException[] = [];

    for (const co of ctx.model.changeOrders) {
      if (co.status !== 'approved') continue;
      if (!onOrBefore(co.approvalDate, ctx.asOfDate)) continue;

      // A change order with no SOV line is still unbilled revenue — it is detected here and then silenced by
      // the suppression pass while CO_MISSING_SOV is open, rather than never being detected at all. That way
      // the UI can say "this is also unbilled, but fix the schedule of values first", and the moment someone
      // records the missing line this exception is released on its own.
      const sov = ctx.view.sovItemForChangeOrder(co.id);

      const billed = sov
        ? ctx.view.billingsForSovItem(sov.id).reduce((total, billing) => total + billing.billedToDate, 0)
        : 0;
      const unbilled = co.approvedValue - billed;
      const daysSinceApproval = ageInDays(co.approvalDate!, ctx.asOfDate);

      if (unbilled < approvedCoUnbilledDollar || daysSinceApproval < approvedCoUnbilledDays) continue;

      found.push({
        projectId: co.projectId,
        subjectId: co.id,
        severity: unbilled >= approvedCoUnbilledDollar * 4 ? 'HIGH' : 'MEDIUM',
        title: `${formatUsd(unbilled)} of approved change work is unbilled after ${daysSinceApproval} days`,
        explanation:
          `"${co.description}" was approved ${daysSinceApproval} days ago for ` +
          `${formatUsd(co.approvedValue)}, and only ${formatUsd(billed)} has been billed. ` +
          `${formatUsd(unbilled)} of earned revenue is sitting on the schedule of values uninvoiced, which ` +
          'is cash the company has already spent to earn.',
        impact: unbilled,
        impactUnit: 'USD',
        recommendedAction:
          'Include the approved change order value in the next payment application.',
        evidence: {
          nodeIds: [co.id, ...(sov ? [sov.id] : []), co.projectId],
          sourceRefs: [...co.sourceRefs, ...(sov?.sourceRefs ?? [])],
          measured: [
            { label: 'Approved value', value: co.approvedValue, unit: 'USD' },
            { label: 'Billed to date', value: billed, unit: 'USD' },
            { label: 'Unbilled', value: unbilled, unit: 'USD' },
            { label: 'Days since approval', value: daysSinceApproval, unit: 'DAYS' },
          ],
          thresholds: [
            { name: 'approvedCoUnbilledDollar', value: approvedCoUnbilledDollar, comparator: 'GTE', met: true },
            { name: 'approvedCoUnbilledDays', value: approvedCoUnbilledDays, comparator: 'GTE', met: true },
          ],
        },
      });
    }

    return found;
  },
};

export const billUnderbilling: Rule = {
  id: 'BILL_UNDERBILLING',
  workstream: 'Billing',
  defaultOwnerRole: 'Project Accountant',
  blocking: false,
  blockingScope: 'CLOSE',
  description: 'The project has earned materially more than it has billed.',
  method: [
    'Work out draft earned revenue: the revised contract multiplied by percent complete, where percent ' +
      'complete is cost to date over forecast final cost. It is a cost-based management figure, not a ' +
      'measure of physical progress and not GAAP revenue.',
    'Subtract what has actually been billed from that.',
    'Keep only projects that have billed less than they have earned. Billing ahead of the work is a ' +
      'different question and is deliberately not raised here.',
    'Flag it when the shortfall is large in dollars, or large as a share of the contract. Either test on ' +
      'its own is enough, because a small contract can be badly underbilled without reaching a dollar bar.',
    'A project whose billing position cannot be worked out is absent from this check rather than passing ' +
      'it. That is a data-quality problem and is raised as one.',
  ],
  evaluate(ctx: RuleContext): DetectedException[] {
    const { underbillingDollar, underbillingPctContract } = ctx.config.thresholds;
    const found: DetectedException[] = [];

    for (const [projectId, metrics] of ctx.metrics) {
      // Negative billing position means underbilled. A positive position is overbilling, which is a
      // different question and deliberately not flagged here.
      if (metrics.billingPosition === null || metrics.billingPosition >= 0) continue;

      const underbilled = Math.abs(metrics.billingPosition);
      const shareOfContract =
        metrics.revisedContractValue === 0 ? null : underbilled / metrics.revisedContractValue;

      const meetsDollar = underbilled > underbillingDollar;
      const meetsPct = shareOfContract !== null && shareOfContract > underbillingPctContract;
      if (!meetsDollar && !meetsPct) continue;

      const project = ctx.model.index.projectById.get(projectId);

      found.push({
        projectId,
        subjectId: projectId,
        severity: meetsDollar && meetsPct ? 'HIGH' : 'MEDIUM',
        title: `${formatUsd(underbilled)} underbilled`,
        explanation:
          `${project?.name ?? projectId} has drawn ${formatUsd(metrics.billedToDate)} against draft earned ` +
          `revenue of ${formatUsd(metrics.draftEarnedRevenue ?? 0)}, leaving ${formatUsd(underbilled)} of ` +
          'work performed but not invoiced. That is cash the company has funded on the client\'s behalf.',
        impact: underbilled,
        impactUnit: 'USD',
        recommendedAction:
          'Review the next payment application against actual progress and bill the shortfall where the ' +
          'schedule of values allows.',
        evidence: {
          nodeIds: [projectId],
          sourceRefs: project?.sourceRefs ?? [],
          measured: [
            { label: 'Billed to date', value: metrics.billedToDate, unit: 'USD' },
            { label: 'Draft earned revenue', value: metrics.draftEarnedRevenue, unit: 'USD' },
            { label: 'Underbilled', value: underbilled, unit: 'USD' },
            { label: 'Percent complete', value: metrics.percentCompletePct, unit: 'PCT' },
            {
              label: 'Share of contract',
              value: shareOfContract === null ? null : shareOfContract * 100,
              unit: 'PCT',
            },
          ],
          thresholds: [
            { name: 'underbillingDollar', value: underbillingDollar, comparator: 'GTE', met: meetsDollar },
            {
              name: 'underbillingPctContract',
              value: underbillingPctContract,
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

export const billSovMismatch: Rule = {
  id: 'BILL_SOV_MISMATCH',
  workstream: 'Billing',
  defaultOwnerRole: 'Project Accountant',
  blocking: true,
  blockingScope: 'CLOSE',
  description: 'The schedule of values does not reconcile to the revised contract.',
  method: [
    'Add up every active line on the schedule of values and compare the total to the revised contract — the ' +
      'original contract plus every approved change order.',
    'Flag any project where the two differ by more than the rounding tolerance. They are meant to be the ' +
      'same number described two ways.',
    'Then look for approved change orders on that project with no schedule line, and add up their value.',
    'Only claim those account for the gap when their total actually matches it. Where they explain part of ' +
      'it, say how much is left, because the rest is a different break and will still be there afterwards.',
  ],
  evaluate(ctx: RuleContext): DetectedException[] {
    const tolerance = ctx.config.thresholds.sovToleranceDollar;
    const found: DetectedException[] = [];

    for (const [projectId, metrics] of ctx.metrics) {
      const variance = metrics.sovVarianceToRevisedContract;
      if (withinTolerance(variance, tolerance)) continue;

      // Where missing change orders explain the gap, name them — this is a grouped reconciliation status,
      // and the fix lives on those change orders rather than here.
      const missingFromSov = ctx.model.changeOrders.filter(
        (co) =>
          co.projectId === projectId &&
          co.status === 'approved' &&
          onOrBefore(co.approvalDate, ctx.asOfDate) &&
          ctx.view.sovItemForChangeOrder(co.id) === null,
      );
      const explained = missingFromSov.reduce((total, co) => total + co.approvedValue, 0);

      // Whether those change orders account for the *whole* gap, not merely whether any exist. Telling an
      // accountant that adding the missing lines clears the reconciliation, when it would leave part of the
      // break standing, stops them looking for the rest — so the claim is only made when it is true.
      const fullyExplained = missingFromSov.length > 0
        && withinTolerance(explained - Math.abs(variance), tolerance);
      const unexplained = Math.abs(variance) - explained;

      found.push({
        projectId,
        subjectId: projectId,
        severity: 'HIGH',
        title: `Schedule of values is ${formatUsd(Math.abs(variance))} ${variance < 0 ? 'below' : 'above'} the revised contract`,
        explanation:
          `The schedule of values totals ${formatUsd(metrics.sovTotal)} against a revised contract of ` +
          `${formatUsd(metrics.revisedContractValue)}. ` +
          (fullyExplained
            ? `${missingFromSov.length} approved change order${missingFromSov.length > 1 ? 's' : ''} worth ` +
              `${formatUsd(explained)} ${missingFromSov.length > 1 ? 'are' : 'is'} missing from the schedule, ` +
              'which accounts for the difference. Fixing those resolves this.'
            : missingFromSov.length > 0
              ? `${missingFromSov.length} approved change order${missingFromSov.length > 1 ? 's' : ''} worth ` +
                `${formatUsd(explained)} ${missingFromSov.length > 1 ? 'are' : 'is'} missing from the ` +
                `schedule, but that leaves ${formatUsd(Math.abs(unexplained))} of the difference unaccounted ` +
                'for. Adding those lines will not fully reconcile this.'
              : 'No missing approved change order explains the difference, so the schedule itself needs review.'),
        impact: Math.abs(variance),
        impactUnit: 'USD',
        recommendedAction:
          fullyExplained
            ? 'Resolve the missing change-order lines; this reconciliation clears once they are added.'
            : missingFromSov.length > 0
              ? 'Add the missing change-order lines, then reconcile the remaining difference line by line.'
              : 'Reconcile the schedule of values line by line against the contract and approved changes.',
        evidence: {
          nodeIds: [projectId, ...missingFromSov.map((co) => co.id)],
          sourceRefs: missingFromSov.flatMap((co) => co.sourceRefs),
          measured: [
            { label: 'Schedule of values total', value: metrics.sovTotal, unit: 'USD' },
            { label: 'Revised contract', value: metrics.revisedContractValue, unit: 'USD' },
            { label: 'Variance', value: variance, unit: 'USD' },
            { label: 'Approved change orders missing from the schedule', value: missingFromSov.length, unit: 'COUNT' },
          ],
          thresholds: [{ name: 'sovToleranceDollar', value: tolerance, comparator: 'LTE', met: false }],
        },
      });
    }

    return found;
  },
};

export const billRetainage: Rule = {
  id: 'BILL_RETAINAGE',
  workstream: 'Billing',
  defaultOwnerRole: 'Project Accountant',
  blocking: false,
  blockingScope: 'CLOSE',
  description: 'Retainage held does not match the schedule-of-values rate.',
  method: [
    'For each billing, take the amount billed to date and multiply it by the retainage rate its schedule ' +
      'of values line specifies. That is what the client should be holding back.',
    'Compare that against the retainage actually held.',
    'Flag any billing where the two differ by more than the rounding tolerance — the client is either ' +
      'holding money they are not entitled to, or releasing money too early.',
  ],
  evaluate(ctx: RuleContext): DetectedException[] {
    const tolerance = ctx.config.thresholds.retainageToleranceDollar;
    const found: DetectedException[] = [];

    for (const projectId of ctx.metrics.keys()) {
      for (const sov of ctx.view.sovItemsForProject(projectId)) {
        for (const billing of ctx.view.billingsForSovItem(sov.id)) {
          const expected = billing.billedToDate * (sov.retainagePct / 100);
          const variance = billing.retainageHeld - expected;
          if (withinTolerance(variance, tolerance)) continue;

          found.push({
            projectId,
            subjectId: sov.id,
            severity: 'MEDIUM',
            title: `Retainage on ${sov.description} is off by ${formatUsd(Math.abs(variance))}`,
            explanation:
              `${formatUsd(billing.retainageHeld)} of retainage is held against billings of ` +
              `${formatUsd(billing.billedToDate)}, but the schedule of values specifies ` +
              `${sov.retainagePct}%, which would be ${formatUsd(expected)}.`,
            impact: Math.abs(variance),
            impactUnit: 'USD',
            recommendedAction:
              'Confirm the contractual retainage rate and correct the payment application.',
            evidence: {
              nodeIds: [sov.id, billing.id],
              sourceRefs: [...billing.sourceRefs, ...sov.sourceRefs],
              measured: [
                { label: 'Retainage held', value: billing.retainageHeld, unit: 'USD' },
                { label: 'Expected retainage', value: expected, unit: 'USD' },
                { label: 'Variance', value: variance, unit: 'USD' },
                { label: 'Rate', value: sov.retainagePct, unit: 'PCT' },
              ],
              thresholds: [{
                name: 'retainageToleranceDollar', value: tolerance, comparator: 'LTE', met: false,
              }],
            },
          });
        }
      }
    }

    return found;
  },
};

export const billingRules: Rule[] = [
  coLargeAging,
  coUnapprovedCost,
  coMissingSov,
  coApprovedUnbilled,
  billUnderbilling,
  billSovMismatch,
  billRetainage,
];
