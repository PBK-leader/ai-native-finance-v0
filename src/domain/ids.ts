/**
 * Canonical identity.
 *
 * Raw source IDs never become canonical IDs. A canonical ID is `PREFIX-<raw source id>` with no stripping;
 * prefixes are chosen so the result is unambiguous. Entities that have no single raw row (cost codes, budget
 * lines, snapshots, labor aggregates) compose their key from canonical parts.
 *
 * `Project` is the one exception: `project_id_map.csv` already supplies a canonical id — that is the whole
 * purpose of the file — so `P-1002` is used directly.
 *
 * Why this matters: `exceptionId` subject keys are canonical IDs, and the decision ledger is permanent. If
 * subject keys were raw ERP ids, re-keying on a real integration would detach every historical human decision
 * from its exception.
 *
 * See `docs/decisions/V0_TECHNICAL_DESIGN.md` §4.1.
 */

// Branded ID types. The brand is compile-time only — these are plain strings at runtime.
declare const brand: unique symbol;
type Branded<T extends string> = string & { readonly [brand]: T };

export type CompanyId = Branded<'Company'>;
export type DivisionId = Branded<'Division'>;
export type ProjectId = Branded<'Project'>;
export type CostCodeId = Branded<'CostCode'>;
export type BudgetLineId = Branded<'BudgetLine'>;
export type CommitmentId = Branded<'Commitment'>;
export type ApInvoiceId = Branded<'ApInvoice'>;
export type MaterialReceiptId = Branded<'MaterialReceipt'>;
export type JobCostTransactionId = Branded<'JobCostTransaction'>;
export type ChangeOrderId = Branded<'ChangeOrder'>;
export type SovItemId = Branded<'SovItem'>;
export type BillingId = Branded<'Billing'>;
export type ForecastSnapshotId = Branded<'ForecastSnapshot'>;
export type ProgressSnapshotId = Branded<'ProgressSnapshot'>;
export type LaborAggregateId = Branded<'LaborAggregate'>;
export type PersonId = Branded<'Person'>;
export type EmployeeId = Branded<'Employee'>;
export type VendorId = Branded<'Vendor'>;
export type GraphLinkId = Branded<'GraphLink'>;
export type ExceptionId = Branded<'Exception'>;

/** Any canonical entity id, for graph nodes and evidence references. */
export type CanonicalId = string;

const id = <T>(value: string): T => value as unknown as T;

export const companyId = (raw: string): CompanyId => id(`CMP-${raw}`);
export const divisionId = (raw: string): DivisionId => id(`DIV-${raw}`);

/** The canonical project id comes straight from `project_id_map.csv`. */
export const projectId = (canonical: string): ProjectId => id(canonical);

export const costCodeId = (project: ProjectId, code: string): CostCodeId => id(`CC-${project}-${code}`);
export const budgetLineId = (project: ProjectId, code: string): BudgetLineId => id(`BL-${project}-${code}`);
export const commitmentId = (raw: string): CommitmentId => id(`CMT-${raw}`);
export const apInvoiceId = (raw: string): ApInvoiceId => id(`AP-${raw}`);
export const materialReceiptId = (raw: string): MaterialReceiptId => id(`RCP-${raw}`);
export const jobCostTransactionId = (raw: string): JobCostTransactionId => id(`JCT-${raw}`);
export const changeOrderId = (raw: string): ChangeOrderId => id(`CHG-${raw}`);
export const sovItemId = (raw: string): SovItemId => id(`SVI-${raw}`);
export const billingId = (raw: string): BillingId => id(`BIL-${raw}`);
export const personId = (raw: string): PersonId => id(`PER-${raw}`);
export const employeeId = (raw: string): EmployeeId => id(`EMP-${raw}`);
export const vendorId = (raw: string): VendorId => id(`VEN-${raw}`);

export const forecastSnapshotId = (project: ProjectId, code: string, asOf: string): ForecastSnapshotId =>
  id(`FCS-${project}-${code}-${asOf}`);

export const progressSnapshotId = (project: ProjectId, code: string, asOf: string): ProgressSnapshotId =>
  id(`PRG-${project}-${code}-${asOf}`);

export const laborAggregateId = (project: ProjectId, code: string): LaborAggregateId =>
  id(`LAB-${project}-${code}`);

/**
 * An SOV line created by a human decision rather than read from the PM system.
 *
 * Keyed on the change order it corrects, so recording the same correction twice collides on one key instead
 * of producing two SOV lines. Commitment P-1 of the Gate 1 review: without this, two identical corrections
 * would swing `BILL_SOV_MISMATCH` on P-1004 by twice $420,000 in the wrong direction.
 */
export const overlaySovItemId = (co: ChangeOrderId): SovItemId => id(`SVI-OVERLAY-${co}`);

/**
 * Graph link identity is derived from the edge itself, never from a counter or a decision id, so a link
 * produced by reconciliation and the same link produced by a human decision collide by design.
 */
export const graphLinkId = (linkType: string, fromId: string, toId: string): GraphLinkId =>
  id(`${linkType}:${fromId}:${toId}`);

/**
 * Deterministic exception identity: `ruleId:projectId:subject`.
 *
 * `projectId` is `GLOBAL` for exceptions that have no canonical project — which is only `DQ_PROJECT_MAP`,
 * whose entire subject is a source record that has no canonical form.
 */
export const exceptionId = (ruleId: string, project: ProjectId | null, subject: string): ExceptionId =>
  id(`${ruleId}:${project ?? 'GLOBAL'}:${subject}`);

/** The Close Orchestrator's reserved pseudo-rule, excluded from oracle rule-count comparisons. */
export const CLOSE_CONTROLLER_REVIEW = 'CLOSE_CONTROLLER_REVIEW';
