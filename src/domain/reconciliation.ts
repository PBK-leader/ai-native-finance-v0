/**
 * The `ReconciledView` interface — one way to reach every reconciled relationship.
 *
 * Declared here (layer 3) and implemented in `src/reconciliation` (layer 6) so that `src/calculations`
 * (layer 7) can name the type without importing the layer below it.
 *
 * This interface is the answer to the single worst failure mode this codebase could have: the same
 * relationship existing twice, once as a foreign key the arithmetic uses and once as a graph link the
 * explorer draws, quietly disagreeing about which invoices are valid. Canonical entities carry no
 * counterparty ids at all, so this is the only route.
 *
 * It takes the decision projection, not just the model, because a human decision can create a relationship:
 * recording a missing SOV line for an approved change order emits both an SOV item and a `MAPS_TO` link.
 * A view built from the frozen model alone would never see it, `CO_MISSING_SOV` could never clear, and the
 * change-order demo would resolve its task while the blocking exception kept firing.
 */

import type { IsoDate } from './dates';
import type {
  ApInvoice, Billing, CanonicalModel, Commitment, Employee, ForecastSnapshot, JobCostTransaction,
  MaterialReceipt, Person, SovItem, Vendor,
} from './entities';
import type { GraphLink } from './graph';
import type {
  ApInvoiceId, ChangeOrderId, CommitmentId, LaborAggregateId, ProjectId, SovItemId,
} from './ids';
import type { DecisionProjection } from './workflow';

/**
 * The raw counterparty keys normalization extracted, handed to reconciliation and to nobody else.
 *
 * Declared here rather than in `src/data/normalize` so `src/reconciliation` can name it without importing
 * a layer it is not granted — the same declare-the-type-low rule the rest of the domain follows.
 */
export type ReconciliationKeys = {
  invoiceToCommitment: Map<string, string>;
  receiptToCommitment: Map<string, string>;
  postingToInvoice: Map<string, string>;
  sovToChangeOrder: Map<string, string>;
  billingToSov: Map<string, string>;
};

export interface ReconciledView {
  /** Every link this view resolved, master-data and reconciled alike, including human-created ones. */
  readonly links: readonly GraphLink[];

  // --- Reconciled matches --------------------------------------------------------------------------------
  /** `MATCHES` — invoices linked to a purchase order. */
  invoicesForCommitment(commitmentId: CommitmentId): ApInvoice[];
  commitmentForInvoice(invoiceId: ApInvoiceId): Commitment | null;
  /** `POSTS_AS` — the job-cost transaction an invoice posted as, if it posted at all. */
  postingForInvoice(invoiceId: ApInvoiceId): JobCostTransaction | null;
  /** `RECEIVED_AGAINST` — receipts booked against a purchase order. */
  receiptsForCommitment(commitmentId: CommitmentId): MaterialReceipt[];
  /** `MAPS_TO` — the SOV line for an approved change order, whether from the PM system or a human. */
  sovItemForChangeOrder(changeOrderId: ChangeOrderId): SovItem | null;
  /** `BILLS` — billing rows against an SOV line. */
  billingsForSovItem(sovItemId: SovItemId): Billing[];

  // --- Projection-aware collections ----------------------------------------------------------------------
  /**
   * Billing rules MUST use these rather than reading `model.sovItems` directly. Otherwise a human's SOV
   * correction would be visible to `sovItemForChangeOrder` but invisible to `BILL_SOV_MISMATCH` — the same
   * two-paths-to-one-relationship defect, one level down.
   */
  sovItemsForProject(projectId: ProjectId): SovItem[];
  billingsForProject(projectId: ProjectId): Billing[];
  /**
   * Forecast snapshots including human-authored overlays. Pass `null` for every project.
   *
   * Projection-aware for the same reason SOV items are: a PM's answer creates a real forecast object, and
   * anything reading only the frozen model would not see it.
   */
  forecastSnapshotsForProject(projectId: ProjectId | null): ForecastSnapshot[];

  // --- Master-data neighbours ----------------------------------------------------------------------------
  /** `ISSUES`. Needed by duplicate detection, which groups by vendor and invoice number. */
  vendorForInvoice(invoiceId: ApInvoiceId): Vendor | null;
  /** `WORKS_ON`. Needed to drill from an unposted-labor exception down to the crew. */
  employeesForLaborAggregate(laborAggregateId: LaborAggregateId): Employee[];
  /** `MANAGED_BY`. Needed to route a task to a named person rather than an abstract role. */
  managerForProject(projectId: ProjectId): Person | null;

  // --- Source validity -----------------------------------------------------------------------------------
  /**
   * The single definition of AP validity: approved, approved on or before the as-of date, and not the
   * suppressed member of a duplicate pair. Parameterised by date so one view serves both the current close
   * and the prior-period reconstruction.
   */
  isValidInvoice(invoiceId: ApInvoiceId, asOf: IsoDate): boolean;
  /** Valid invoices linked to a PO as at a date, which is what cumulative commitment analysis needs. */
  validInvoicesForCommitment(commitmentId: CommitmentId, asOf: IsoDate): ApInvoice[];
  /**
   * Suppressed duplicates. Deliberately not parameterised by date: duplicate identity is a property of the
   * record pair, not of the analysis date. Two invoices are either the same document or they are not, and
   * that does not change because we look at an earlier close.
   */
  readonly suppressedDuplicateIds: ReadonlySet<ApInvoiceId>;
}

export type BuildReconciledView = (
  model: CanonicalModel,
  projection: DecisionProjection,
) => ReconciledView;
