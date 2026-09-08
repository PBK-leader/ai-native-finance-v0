/**
 * AP and cost-control rules.
 *
 * These are the rules that find cost which is duplicated, unposted, over-committed, miscoded, or received
 * but not yet invoiced. Every one of them reaches invoice→PO, invoice→posting and receipt→PO through the
 * reconciled view, never by re-joining source files.
 *
 * Ordering note: several of these interact. An invoice that is a duplicate, or that is being held because it
 * would breach its purchase order, should not also raise a missing-posting task. That precedence is applied
 * centrally in the suppression pass rather than by each rule second-guessing the others.
 */

import { ageInDays, onOrBefore } from '@/domain/dates';
import type { DetectedException, Rule, RuleContext } from '../types';
import { formatUsd } from './dataQuality';

export const apDuplicate: Rule = {
  id: 'AP_DUPLICATE',
  workstream: 'AP',
  defaultOwnerRole: 'Project Accountant',
  blocking: true,
  blockingScope: 'CLOSE',
  description: 'The same vendor invoice number appears more than once.',
  evaluate(ctx: RuleContext): DetectedException[] {
    const found: DetectedException[] = [];

    for (const invoiceId of ctx.view.suppressedDuplicateIds) {
      const duplicate = ctx.model.index.apInvoiceById.get(invoiceId);
      if (!duplicate) continue;
      if (!onOrBefore(duplicate.invoiceDate, ctx.asOfDate)) continue;

      // The record that was kept — the earliest in the group.
      const original = ctx.model.apInvoices.find(
        (i) =>
          i.id !== duplicate.id &&
          i.vendorId === duplicate.vendorId &&
          i.invoiceNumber === duplicate.invoiceNumber,
      );
      const vendor = ctx.view.vendorForInvoice(duplicate.id);

      found.push({
        projectId: duplicate.projectId,
        subjectId: duplicate.id,
        severity: 'HIGH',
        title: `Duplicate invoice ${duplicate.invoiceNumber} from ${vendor?.name ?? 'vendor'}`,
        explanation:
          `Invoice number ${duplicate.invoiceNumber} from ${vendor?.name ?? 'this vendor'} appears twice for ` +
          `${formatUsd(duplicate.amount)}. The later record is excluded from cumulative invoicing so it does ` +
          'not reduce the purchase order or inflate cost, but if it is genuinely a second invoice that ' +
          'exclusion is wrong, and if it is a duplicate it may still get paid.',
        impact: duplicate.amount,
        impactUnit: 'USD',
        recommendedAction:
          'Compare the two invoices against the vendor statement. Confirm the duplicate and block payment, ' +
          'or confirm they are distinct invoices so cumulative invoicing can be corrected.',
        evidence: {
          nodeIds: [duplicate.id, ...(original ? [original.id] : []), ...(vendor ? [vendor.id] : [])],
          sourceRefs: [...duplicate.sourceRefs, ...(original?.sourceRefs ?? [])],
          measured: [
            { label: 'Duplicate amount', value: duplicate.amount, unit: 'USD' },
            { label: 'Copies found', value: original ? 2 : 1, unit: 'COUNT' },
          ],
          thresholds: [],
        },
      });
    }

    return found;
  },
};

export const apCommitmentOverrun: Rule = {
  id: 'AP_COMMITMENT_OVERRUN',
  workstream: 'AP',
  defaultOwnerRole: 'Project Accountant',
  blocking: true,
  blockingScope: 'CLOSE',
  description: 'Cumulative approved invoicing exceeds the purchase order.',
  evaluate(ctx: RuleContext): DetectedException[] {
    const threshold = ctx.config.thresholds.commitmentOverrunDollar;
    const found: DetectedException[] = [];

    for (const commitment of ctx.model.commitments) {
      // Cumulative, not one invoice against a remaining-balance snapshot: a single large invoice is only an
      // overrun in the context of everything already billed against the same PO.
      const validInvoices = ctx.view.validInvoicesForCommitment(commitment.id, ctx.asOfDate);
      const invoiced = validInvoices.reduce((total, invoice) => total + invoice.amount, 0);
      const overrun = invoiced - commitment.committedAmount;
      if (overrun < threshold) continue;

      const vendor = ctx.model.index.vendorById.get(commitment.vendorId);
      // The invoice that tipped it over, for the accountant's benefit.
      const latest = [...validInvoices].sort((a, b) =>
        (a.approvedDate ?? a.invoiceDate) < (b.approvedDate ?? b.invoiceDate) ? -1 : 1,
      ).at(-1);

      found.push({
        projectId: commitment.projectId,
        subjectId: commitment.id,
        severity: 'HIGH',
        title: `${commitment.description} is over-invoiced by ${formatUsd(overrun)}`,
        explanation:
          `Approved invoices against this purchase order now total ${formatUsd(invoiced)} against a ` +
          `commitment of ${formatUsd(commitment.committedAmount)} — an overrun of ${formatUsd(overrun)}. ` +
          'Either a change order was never issued, the work was authorised informally, or an invoice has ' +
          'been coded to the wrong purchase order.',
        impact: overrun,
        impactUnit: 'USD',
        recommendedAction:
          'Confirm whether the extra scope was authorised. If it was, raise a change order to the purchase ' +
          'order; if not, hold the invoice and query it with the vendor.',
        evidence: {
          nodeIds: [commitment.id, ...validInvoices.map((i) => i.id), ...(vendor ? [vendor.id] : [])],
          sourceRefs: [...commitment.sourceRefs, ...validInvoices.flatMap((i) => i.sourceRefs)],
          measured: [
            { label: 'Committed', value: commitment.committedAmount, unit: 'USD' },
            { label: 'Approved invoiced to date', value: invoiced, unit: 'USD' },
            { label: 'Overrun', value: overrun, unit: 'USD' },
            { label: 'Invoices against this PO', value: validInvoices.length, unit: 'COUNT' },
            ...(latest ? [{ label: 'Most recent invoice', value: latest.amount, unit: 'USD' as const }] : []),
          ],
          thresholds: [{ name: 'commitmentOverrunDollar', value: threshold, comparator: 'GTE', met: true }],
        },
      });
    }

    return found;
  },
};

export const apCostCodeMismatch: Rule = {
  id: 'AP_COST_CODE_MISMATCH',
  workstream: 'AP',
  defaultOwnerRole: 'Project Accountant',
  blocking: true,
  blockingScope: 'CLOSE',
  description: 'An invoice is coded to a different cost code than its purchase order.',
  evaluate(ctx: RuleContext): DetectedException[] {
    const found: DetectedException[] = [];

    for (const invoice of ctx.model.apInvoices) {
      // Only invoices that are valid for commitment analysis. A pending invoice has not been coded finally,
      // and a suppressed duplicate is already excluded from cumulative invoicing — raising a blocking
      // exception carrying its full amount would be a claim about a document the model has declared invalid.
      if (!ctx.view.isValidInvoice(invoice.id, ctx.asOfDate)) continue;

      const commitment = ctx.view.commitmentForInvoice(invoice.id);
      if (!commitment) continue;
      if (invoice.costCode === commitment.costCode) continue;

      found.push({
        projectId: invoice.projectId,
        subjectId: invoice.id,
        severity: 'MEDIUM',
        title: `Invoice ${invoice.invoiceNumber} is coded to ${invoice.costCode}, its PO to ${commitment.costCode}`,
        explanation:
          `${formatUsd(invoice.amount)} has been charged to cost code ${invoice.costCode}, but the purchase ` +
          `order it is matched to (${commitment.description}) sits on ${commitment.costCode}. One of the two ` +
          'is wrong, so at least one cost code is being reported with the wrong committed-versus-actual ' +
          'position.',
        impact: invoice.amount,
        impactUnit: 'USD',
        recommendedAction:
          'Confirm which cost code the work belongs to and reclassify either the invoice or the purchase ' +
          'order so the two agree.',
        evidence: {
          nodeIds: [invoice.id, commitment.id, invoice.costCodeId, commitment.costCodeId],
          sourceRefs: [...invoice.sourceRefs, ...commitment.sourceRefs],
          measured: [{ label: 'Invoice amount', value: invoice.amount, unit: 'USD' }],
          thresholds: [],
        },
      });
    }

    return found;
  },
};

export const apMissingPosting: Rule = {
  id: 'AP_MISSING_POSTING',
  workstream: 'AP',
  defaultOwnerRole: 'Project Accountant',
  blocking: true,
  blockingScope: 'CLOSE',
  description: 'An approved invoice has not reached the job-cost ledger.',
  evaluate(ctx: RuleContext): DetectedException[] {
    const threshold = ctx.config.thresholds.apPostingLagDays;
    const found: DetectedException[] = [];

    for (const invoice of ctx.model.apInvoices) {
      // A pending invoice is not late — it has not been approved yet.
      if (invoice.approvalStatus !== 'approved') continue;
      if (!onOrBefore(invoice.approvedDate, ctx.asOfDate)) continue;
      // Duplicates are detected here too, then removed by the suppression pass, so the reason a duplicate
      // produces no task is explicit rather than an accident of detection order.
      if (ctx.view.postingForInvoice(invoice.id) !== null) continue;

      const age = ageInDays(invoice.approvedDate!, ctx.asOfDate);
      if (age <= threshold) continue;

      const vendor = ctx.view.vendorForInvoice(invoice.id);
      const commitment = ctx.view.commitmentForInvoice(invoice.id);

      found.push({
        projectId: invoice.projectId,
        subjectId: invoice.id,
        severity: 'HIGH',
        title: `Approved invoice ${invoice.invoiceNumber} is ${age} days old and not posted`,
        explanation:
          `${formatUsd(invoice.amount)} from ${vendor?.name ?? 'this vendor'} was approved ${age} days ago ` +
          'but has never reached the job-cost ledger. The project is understating cost to date by that ' +
          'amount, which flatters both margin and the billing position.',
        impact: invoice.amount,
        impactUnit: 'USD',
        recommendedAction:
          'Confirm the invoice is genuinely unposted, then accept a management adjustment to include it in ' +
          'cost to date for this close and chase the posting.',
        evidence: {
          nodeIds: [
            invoice.id,
            ...(vendor ? [vendor.id] : []),
            ...(commitment ? [commitment.id] : []),
          ],
          sourceRefs: invoice.sourceRefs,
          measured: [
            { label: 'Invoice amount', value: invoice.amount, unit: 'USD' },
            { label: 'Days since approval', value: age, unit: 'DAYS' },
          ],
          thresholds: [{ name: 'apPostingLagDays', value: threshold, comparator: 'GTE', met: true }],
        },
      });
    }

    return found;
  },
};

export const apRni: Rule = {
  id: 'AP_RNI',
  workstream: 'AP',
  defaultOwnerRole: 'Project Accountant',
  blocking: true,
  blockingScope: 'CLOSE',
  description: 'Material has been received but not yet invoiced.',
  evaluate(ctx: RuleContext): DetectedException[] {
    const { rniMediumDollar, rniHighDollar } = ctx.config.thresholds;
    const found: DetectedException[] = [];

    for (const commitment of ctx.model.commitments) {
      const receipts = ctx.view
        .receiptsForCommitment(commitment.id)
        .filter((receipt) => onOrBefore(receipt.receiptDate, ctx.asOfDate));
      if (receipts.length === 0) continue;

      const received = receipts.reduce((total, receipt) => total + receipt.receivedValue, 0);
      const invoices = ctx.view.validInvoicesForCommitment(commitment.id, ctx.asOfDate);
      const invoiced = invoices.reduce((total, invoice) => total + invoice.amount, 0);

      const gap = Math.max(received - invoiced, 0);
      if (gap < rniMediumDollar) continue;

      const vendor = ctx.model.index.vendorById.get(commitment.vendorId);
      const severity = gap >= rniHighDollar ? 'HIGH' : 'MEDIUM';

      found.push({
        projectId: commitment.projectId,
        subjectId: commitment.id,
        severity,
        title: `${formatUsd(gap)} received but not invoiced on ${commitment.description}`,
        explanation:
          `${formatUsd(received)} of material has been received against this purchase order but only ` +
          `${formatUsd(invoiced)} has been invoiced and approved. The company owes ${formatUsd(gap)} that ` +
          'does not yet appear in cost to date, so the project looks more profitable and less complete than ' +
          'it is.',
        impact: gap,
        impactUnit: 'USD',
        recommendedAction:
          'Confirm the goods were received in this period, then accept a cutoff adjustment moving ' +
          `${formatUsd(gap)} from remaining commitment into cost to date.`,
        evidence: {
          nodeIds: [
            commitment.id,
            ...receipts.map((r) => r.id),
            ...invoices.map((i) => i.id),
            ...(vendor ? [vendor.id] : []),
          ],
          sourceRefs: [...receipts.flatMap((r) => r.sourceRefs), ...commitment.sourceRefs],
          measured: [
            { label: 'Received to date', value: received, unit: 'USD' },
            { label: 'Approved invoiced to date', value: invoiced, unit: 'USD' },
            { label: 'Received not invoiced', value: gap, unit: 'USD' },
            { label: 'Receipts', value: receipts.length, unit: 'COUNT' },
          ],
          thresholds: [
            { name: 'rniMediumDollar', value: rniMediumDollar, comparator: 'GTE', met: gap >= rniMediumDollar },
            { name: 'rniHighDollar', value: rniHighDollar, comparator: 'GTE', met: gap >= rniHighDollar },
          ],
        },
      });
    }

    return found;
  },
};

export const laborMissingPosting: Rule = {
  id: 'LABOR_MISSING_POSTING',
  workstream: 'Forecast',
  defaultOwnerRole: 'Project Accountant',
  blocking: true,
  blockingScope: 'CLOSE',
  description: 'Approved time has not reached payroll or job cost.',
  evaluate(ctx: RuleContext): DetectedException[] {
    const threshold = ctx.config.thresholds.laborPostingLagDays;
    const found: DetectedException[] = [];

    for (const aggregate of ctx.model.laborAggregates) {
      const { unposted } = aggregate;
      if (unposted.entryCount === 0) continue;

      // Select only the entries that are actually late. Judging the group by its newest entry would let a
      // single timecard booked yesterday hide forty that are three weeks old — and the missing cost would
      // stay out of cost to date with no task anywhere to recover it.
      let entryCount = 0;
      let hours = 0;
      let cost = 0;
      let earliest: string | null = null;
      let latest: string | null = null;

      for (const [workDate, bucket] of Object.entries(unposted.byWorkDate)) {
        if (!onOrBefore(workDate, ctx.asOfDate)) continue;
        if (ageInDays(workDate, ctx.asOfDate) <= threshold) continue;
        entryCount += bucket.entryCount;
        hours += bucket.hours;
        cost += bucket.cost;
        if (earliest === null || workDate < earliest) earliest = workDate;
        if (latest === null || workDate > latest) latest = workDate;
      }

      if (entryCount === 0 || earliest === null || latest === null) continue;

      // Aged from the oldest late entry, which is the honest measure of how long this has been outstanding.
      const age = ageInDays(earliest, ctx.asOfDate);
      const crew = ctx.view.employeesForLaborAggregate(aggregate.id);
      const project = ctx.model.index.projectById.get(aggregate.projectId);

      found.push({
        projectId: aggregate.projectId,
        subjectId: aggregate.id,
        severity: 'HIGH',
        title: `${entryCount} approved time entries on ${aggregate.costCode} are unposted`,
        explanation:
          `${hours.toLocaleString('en-US')} approved hours worked between ${earliest} and ${latest} have ` +
          'not reached payroll or the job-cost ledger. At the crew cost rates that is roughly ' +
          `${formatUsd(cost)} of labour missing from cost to date.`,
        impact: cost,
        impactUnit: 'USD',
        recommendedAction:
          'Confirm the time is approved and genuinely unposted, then accept a management adjustment to ' +
          'include the estimated labour cost in this close.',
        evidence: {
          nodeIds: [aggregate.id, aggregate.costCodeId, ...crew.slice(0, 10).map((e) => e.id)],
          // Includes the timekeeping-system project key so the accountant can find these entries at source.
          sourceRefs: [...(project?.sourceRefs ?? []), ...aggregate.sourceRefs],
          measured: [
            { label: 'Late unposted entries', value: entryCount, unit: 'COUNT' },
            { label: 'Late unposted hours', value: hours, unit: 'HOURS' },
            { label: 'Estimated labour cost', value: cost, unit: 'USD' },
            { label: 'Days since oldest late entry', value: age, unit: 'DAYS' },
            { label: 'Total unposted entries', value: unposted.entryCount, unit: 'COUNT' },
          ],
          thresholds: [{ name: 'laborPostingLagDays', value: threshold, comparator: 'GT', met: true }],
        },
      });
    }

    return found;
  },
};

export const apRules: Rule[] = [
  apDuplicate,
  apCommitmentOverrun,
  apCostCodeMismatch,
  apMissingPosting,
  apRni,
  laborMissingPosting,
];
