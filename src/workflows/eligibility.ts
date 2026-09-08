/**
 * Whether a decision's *subject* is a legitimate candidate for it.
 *
 * The transition table answers "may this role do this from this state?". This answers a different question:
 * "is this thing actually eligible?" Without it, an accountant could accept an AP-unposted adjustment
 * against an invoice that already posted — double-counting it against posted cost — or against the
 * suppressed duplicate `AP-INV-00089`, injecting $75,920 of cost that does not exist.
 *
 * One predicate, used on both paths. The API calls it to reject a bad request with a reason the user sees;
 * the replay engine calls it to mark a bad ledger entry `ignored` so it cannot move a number. That second
 * use is what matters most, because the demos and workflow tests are hand-written decision arrays that
 * bypass the API entirely.
 */

import type { V0Config } from '@/config/v0Config';
import type { CanonicalModel } from '@/domain/entities';
import type { ApInvoiceId, CommitmentId, LaborAggregateId } from '@/domain/ids';
import type { ReconciledView } from '@/domain/reconciliation';
import type { DecisionRejection } from '@/domain/taskStatus';
import type { ReviewDecision } from '@/domain/workflow';
import { knownCostCodes } from './forecastTargets';

export type EligibilityContext = {
  model: CanonicalModel;
  view: ReconciledView;
  config: V0Config;
};

/**
 * A finite JavaScript number, and nothing else.
 *
 * `x > 0` and `x < 0` are not type guards. A numeric *string* passes `amount > 0` and then turns every
 * `+=` downstream into string concatenation — EAC becomes `"2913488.940120000059650090..."`, which coerces
 * back to a plausible-looking number and reports a confidently wrong margin. `NaN` passes `x < 0` too, and
 * once inside the domain it makes every threshold comparison false, silently switching off the very rules
 * that watch the forecast. Both are worse than a crash because nothing looks wrong.
 */
function isMoney(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/** Returns a rejection reason, or `null` when the decision may be applied. */
export function checkEligibility(
  ctx: EligibilityContext,
  decision: ReviewDecision,
): DecisionRejection | null {
  const payload = decision.payload;

  if (payload.type === 'ACCEPT_ADJUSTMENT') {
    if (!isMoney(payload.amount) || payload.amount <= 0) {
      return {
        kind: 'INELIGIBLE_SUBJECT',
        reason: 'An accepted adjustment must be a positive, finite dollar amount.',
      };
    }

    switch (payload.adjustmentType) {
      case 'AP_UNPOSTED': {
        const invoiceId = payload.subjectId as ApInvoiceId;
        const invoice = ctx.model.index.apInvoiceById.get(invoiceId);
        if (!invoice) {
          return { kind: 'INELIGIBLE_SUBJECT', reason: `Unknown invoice ${payload.subjectId}.` };
        }
        if (invoice.approvalStatus !== 'approved') {
          return {
            kind: 'INELIGIBLE_SUBJECT',
            reason: `Invoice ${invoice.invoiceNumber} is not approved, so it cannot be accrued.`,
          };
        }
        if (ctx.view.postingForInvoice(invoiceId) !== null) {
          return {
            kind: 'INELIGIBLE_SUBJECT',
            reason:
              `Invoice ${invoice.invoiceNumber} has already posted to job cost. Accruing it would count the ` +
              'same cost twice.',
          };
        }
        if (ctx.view.suppressedDuplicateIds.has(invoiceId)) {
          return {
            kind: 'INELIGIBLE_SUBJECT',
            reason:
              `Invoice ${invoice.invoiceNumber} is a suspected duplicate. Resolve the duplicate review ` +
              'before accruing it.',
          };
        }
        if (payload.amount > invoice.amount) {
          return {
            kind: 'INELIGIBLE_SUBJECT',
            reason: `Adjustment exceeds the invoice amount of ${invoice.amount}.`,
          };
        }
        return null;
      }

      case 'RNI': {
        const commitmentId = payload.subjectId as CommitmentId;
        const commitment = ctx.model.index.commitmentById.get(commitmentId);
        if (!commitment) {
          return { kind: 'INELIGIBLE_SUBJECT', reason: `Unknown commitment ${payload.subjectId}.` };
        }

        const received = ctx.view
          .receiptsForCommitment(commitmentId)
          .filter((receipt) => receipt.receiptDate <= decision.effectiveDate)
          .reduce((total, receipt) => total + receipt.receivedValue, 0);
        const invoiced = ctx.view
          .validInvoicesForCommitment(commitmentId, decision.effectiveDate)
          .reduce((total, invoice) => total + invoice.amount, 0);
        const gap = Math.max(received - invoiced, 0);

        if (gap <= 0) {
          return {
            kind: 'INELIGIBLE_SUBJECT',
            reason: `${commitment.description} has no received-not-invoiced balance to accrue.`,
          };
        }
        if (payload.amount > gap) {
          return {
            kind: 'INELIGIBLE_SUBJECT',
            reason: `Adjustment exceeds the received-not-invoiced gap of ${gap}.`,
          };
        }
        return null;
      }

      case 'UNPOSTED_LABOR': {
        const aggregateId = payload.subjectId as LaborAggregateId;
        const aggregate = ctx.model.index.laborAggregateById.get(aggregateId);
        if (!aggregate) {
          return { kind: 'INELIGIBLE_SUBJECT', reason: `Unknown labour aggregate ${payload.subjectId}.` };
        }
        if (aggregate.unposted.entryCount === 0) {
          return {
            kind: 'INELIGIBLE_SUBJECT',
            reason: `Cost code ${aggregate.costCode} has no unposted approved time.`,
          };
        }
        if (payload.amount > aggregate.unposted.cost + 0.01) {
          return {
            kind: 'INELIGIBLE_SUBJECT',
            reason: `Adjustment exceeds the estimated unposted labour cost of ${aggregate.unposted.cost}.`,
          };
        }
        return null;
      }
    }
  }

  if (payload.type === 'RECORD_SOV_CORRECTION') {
    if (!isMoney(payload.scheduledValue) || payload.scheduledValue < 0) {
      return {
        kind: 'INELIGIBLE_SUBJECT',
        reason: 'A schedule-of-values line must carry a non-negative, finite value.',
      };
    }
    if (!isMoney(payload.retainagePct) || payload.retainagePct < 0 || payload.retainagePct > 100) {
      return { kind: 'INELIGIBLE_SUBJECT', reason: 'Retainage must be a percentage between 0 and 100.' };
    }

    const changeOrder = ctx.model.index.changeOrderById.get(payload.changeOrderId);
    if (!changeOrder) {
      return { kind: 'INELIGIBLE_SUBJECT', reason: `Unknown change order ${payload.changeOrderId}.` };
    }
    if (changeOrder.status !== 'approved') {
      return {
        kind: 'INELIGIBLE_SUBJECT',
        reason: 'Only an approved change order belongs on the schedule of values.',
      };
    }
    if (ctx.view.sovItemForChangeOrder(payload.changeOrderId) !== null) {
      return {
        kind: 'INELIGIBLE_SUBJECT',
        reason: 'This change order already has a schedule-of-values line.',
      };
    }
    return null;
  }

  if (payload.type === 'PM_FORECAST_UPDATE') {
    if (payload.lines.length === 0) {
      return { kind: 'INELIGIBLE_SUBJECT', reason: 'A forecast update must cover at least one cost code.' };
    }

    const projectId = decision.subject.projectId;
    if (!projectId) {
      return {
        kind: 'INELIGIBLE_SUBJECT',
        reason: 'A forecast update must name the project it applies to.',
      };
    }

    // Every line must land on a cost code that exists. Without this, a bad line creates a forecast snapshot
    // on a phantom cost code: it is summed into the project's remaining cost but appears in no cost code's
    // detail, so project economics silently stop reconciling to their own breakdown.
    const known = knownCostCodes(ctx.model, projectId);

    for (const line of payload.lines) {
      if (!known.has(line.costCode)) {
        return {
          kind: 'INELIGIBLE_SUBJECT',
          reason: `Cost code ${line.costCode} does not exist on this project.`,
        };
      }
      if (!isMoney(line.remainingUncommittedCost) || line.remainingUncommittedCost < 0) {
        return {
          kind: 'INELIGIBLE_SUBJECT',
          reason: `Remaining cost for ${line.costCode} must be a non-negative, finite number.`,
        };
      }
      if (
        line.remainingLaborHours !== null &&
        (!isMoney(line.remainingLaborHours) || line.remainingLaborHours < 0)
      ) {
        return {
          kind: 'INELIGIBLE_SUBJECT',
          reason: `Remaining hours for ${line.costCode} must be a non-negative, finite number.`,
        };
      }
    }

    return null;
  }

  if (payload.type === 'ACCEPT_RISK' && payload.rationale.trim().length < 5) {
    return {
      kind: 'INELIGIBLE_SUBJECT',
      reason: 'Accepting a risk requires a written rationale for the audit trail.',
    };
  }

  return null;
}
