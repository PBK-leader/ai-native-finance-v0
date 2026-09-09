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
  method: [
    'Group every invoice by vendor and invoice number. Two records sharing both are the same document ' +
      'entered twice.',
    'Keep the earliest record in each group and set the later one aside, so the purchase order is not ' +
      'reduced twice and cost is not doubled.',
    'Report the set-aside record dated on or before the close, with another copy alongside it, because ' +
      'that exclusion is a judgement the software made and a human needs to confirm it. Where a number ' +
      'appears three or more times, the copy shown may not be the one that was kept.',
  ],
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
  method: [
    'For each purchase order, add up every invoice matched to it that was approved on or before the close ' +
      'date, ignoring invoices still pending and any duplicate already set aside.',
    'Subtract the committed amount of the purchase order from that total.',
    'Flag it when the excess passes the threshold.',
    'The test is cumulative rather than invoice by invoice: a single large invoice is only an overrun once ' +
      'you count everything already billed against the same purchase order.',
  ],
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
  method: [
    'Take every invoice that counts for this close — approved on or before the close date, and not a ' +
      'duplicate already set aside.',
    'Find the purchase order it is matched to and compare the cost code on each.',
    'Flag any pair that disagrees. One of the two is wrong, so at least one cost code is reporting the ' +
      'wrong position against its budget.',
  ],
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
  method: [
    'Take every invoice approved on or before the close date. An invoice still pending is not late — ' +
      'nobody has approved it yet.',
    'Look for a matching entry in the job-cost ledger, the record of what the project has actually been ' +
      'charged.',
    'Where there is none, count the days since approval and flag it once that exceeds the allowed posting ' +
      'lag.',
    'The full invoice amount is the impact: cost to date is understated by exactly that, which flatters ' +
      'both margin and the billing position.',
    'An invoice already raised as a duplicate, or held because it would breach its purchase order, is left ' +
      'to that finding instead — so this list is shorter than the filter above on its own would suggest.',
  ],
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
  method: [
    'For each purchase order, add up the value of everything physically received on or before the close ' +
      'date.',
    'Add up the invoices against the same purchase order that were approved on or before the close date, ' +
      'ignoring any duplicate already set aside. Excluding those makes the gap larger, not smaller.',
    'Subtract the invoiced total from the received total. What is left is material the company has taken ' +
      'delivery of and owes for, but has not been billed for yet.',
    'Flag it once that gap passes the threshold, and treat a larger gap as more serious.',
  ],
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
          'sits in remaining commitment instead of cost to date, so the project looks less complete than it ' +
          'is and the billing position is understated. Forecast final cost already includes it, so accepting ' +
          'the cutoff moves the money without changing projected profit.',
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
  method: [
    'Group approved timecards by project and cost code, and keep the entries the timekeeping system says ' +
      'never reached payroll. That flag is the only posting signal the source provides.',
    'Within each group, keep only the days that are genuinely late — worked on or before the close date, ' +
      'and older than the allowed posting lag.',
    'Add up the hours and cost on those days, using each crew member\'s own rate with the configured ' +
      'overtime multiplier.',
    'Age the finding from the oldest late day, so one timecard entered yesterday cannot make forty ' +
      'three-week-old ones look current.',
  ],
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
