/**
 * Reduce the decision ledger into overlays the derived pipeline can read.
 *
 * This is where idempotency comes from. Every overlay is a keyed `Map` and the reduction runs over the whole
 * prefix rather than folding incrementally, so accepting the same adjustment twice writes the same key twice
 * and yields one adjustment. There is no "have I already applied this?" check to forget.
 *
 * Nothing here mutates the canonical model. A PM's answer becomes a new forecast snapshot in an overlay; an
 * accountant's SOV correction becomes an overlay SOV line plus the graph link that connects it to its change
 * order. The frozen source data is never touched, which is what keeps `/api/reset` honest and the audit trail
 * complete.
 */

import { costCodeId, forecastSnapshotId, graphLinkId, overlaySovItemId } from '@/domain/ids';
import type { ApInvoiceId, CommitmentId, LaborAggregateId, SovItemId } from '@/domain/ids';
import type { CanonicalModel, ForecastSnapshot, SourceRef, SovItem } from '@/domain/entities';
import type { GraphLink } from '@/domain/graph';
import type { Money } from '@/domain/money';
import type { ExceptionId } from '@/domain/ids';
import type { DecisionProjection, ReviewDecision } from '@/domain/workflow';
import { EMPTY_PROJECTION } from '@/domain/workflow';
import type { Actor } from '@/domain/workflow';

/** Provenance for anything a human created inside the application. */
function applicationRef(decision: ReviewDecision, fields: string[]): SourceRef {
  return {
    system: 'APPLICATION',
    file: 'decision-ledger',
    recordId: decision.id,
    fields,
    method: 'human_decision',
  };
}

export function projectDecisions(
  model: CanonicalModel,
  decisions: readonly ReviewDecision[],
): DecisionProjection {
  if (decisions.length === 0) return EMPTY_PROJECTION;

  const acceptedRni = new Map<CommitmentId, Money>();
  const acceptedApUnposted = new Map<ApInvoiceId, Money>();
  const acceptedUnpostedLabor = new Map<LaborAggregateId, Money>();
  const forecastOverlay = new Map<string, ForecastSnapshot>();
  const sovOverlay = new Map<SovItemId, SovItem>();
  const linkOverlay = new Map<string, GraphLink>();
  const riskAcceptances = new Map<ExceptionId, { rationale: string; actor: Actor }>();

  for (const decision of decisions) {
    const payload = decision.payload;

    switch (payload.type) {
      case 'ACCEPT_ADJUSTMENT': {
        // Keyed by the subject, so a second acceptance of the same item overwrites rather than accumulates.
        switch (payload.adjustmentType) {
          case 'RNI':
            acceptedRni.set(payload.subjectId as CommitmentId, payload.amount);
            break;
          case 'AP_UNPOSTED':
            acceptedApUnposted.set(payload.subjectId as ApInvoiceId, payload.amount);
            break;
          case 'UNPOSTED_LABOR':
            acceptedUnpostedLabor.set(payload.subjectId as LaborAggregateId, payload.amount);
            break;
        }
        break;
      }

      case 'PM_FORECAST_UPDATE': {
        const projectId = decision.subject.projectId;
        if (!projectId) break;

        for (const line of payload.lines) {
          const code = costCodeId(projectId, line.costCode);
          // Dated with the decision's business effective date, not the wall clock. A snapshot dated after
          // the close would be filtered out by "latest on or before as-of" and the answer would silently
          // change nothing.
          const id = forecastSnapshotId(projectId, line.costCode, decision.effectiveDate);

          forecastOverlay.set(id, {
            id,
            projectId,
            costCodeId: code,
            costCode: line.costCode,
            asOfDate: decision.effectiveDate,
            pmRemainingUncommittedCost: line.remainingUncommittedCost,
            pmRemainingLaborHours: line.remainingLaborHours,
            // The comment is per line, because the missing-explanation rule is keyed on the cost code.
            comment: line.comment,
            authorId: decision.actor.personId,
            sourceRefs: [applicationRef(decision, ['lines', line.costCode])],
          });
        }
        break;
      }

      case 'RECORD_SOV_CORRECTION': {
        const projectId = decision.subject.projectId;
        if (!projectId) break;

        const changeOrder = model.index.changeOrderById.get(payload.changeOrderId);
        // Keyed on the change order it corrects, so recording the same correction twice collides on one key
        // instead of creating a second SOV line and doubling the reconciliation swing.
        const id = overlaySovItemId(payload.changeOrderId);

        const existingLines = model.sovItems.filter((item) => item.projectId === projectId);
        sovOverlay.set(id, {
          id,
          projectId,
          lineNumber: existingLines.length + 1,
          description: `Approved CO ${changeOrder?.description ?? payload.changeOrderId} (added during close)`,
          scheduledValue: payload.scheduledValue,
          retainagePct: payload.retainagePct,
          active: true,
          sourceRefs: [applicationRef(decision, ['changeOrderId', 'scheduledValue'])],
        });

        // The link is what makes the correction visible to CO_MISSING_SOV. Its id is derived from the edge,
        // so a human-created link and a later source-derived one for the same pair collide by design.
        const linkId = graphLinkId('MAPS_TO', payload.changeOrderId, id);
        linkOverlay.set(linkId, {
          id: linkId,
          type: 'MAPS_TO',
          fromId: payload.changeOrderId,
          toId: id,
          sourceRefs: [applicationRef(decision, ['changeOrderId'])],
          derivedBy: 'human_decision',
        });
        break;
      }

      case 'ACCEPT_RISK': {
        riskAcceptances.set(decision.exceptionId, {
          rationale: payload.rationale,
          actor: decision.actor,
        });
        break;
      }

      // Status-only decisions. They move the workflow but contribute nothing to the numbers.
      case 'PM_ANSWER':
      case 'REJECT_ADJUSTMENT':
      case 'ESCALATE':
      case 'CONTROLLER_APPROVE':
        break;
    }
  }

  return {
    adjustments: { acceptedRni, acceptedApUnposted, acceptedUnpostedLabor },
    forecastOverlay,
    sovOverlay,
    linkOverlay,
    riskAcceptances,
  };
}
