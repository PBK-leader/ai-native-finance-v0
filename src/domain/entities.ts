/**
 * Canonical entities — the normalized business objects the whole product reasons about.
 *
 * The rule that matters most here (design §4.3):
 *
 *   Containment and intra-source master-data keys live on entities.
 *   Cross-system reconciled matches live only as graph links.
 *
 * So there is deliberately no `ApInvoice.commitmentId`, no `JobCostTransaction.invoiceId`, no
 * `MaterialReceipt.commitmentId`, no `SovItem.changeOrderId` and no `Billing.sovItemId`. Those raw columns
 * are read only by `src/reconciliation`, which emits them as links, and everything downstream — EAC, the
 * rules, the graph explorer — reaches them through one `ReconciledView`. That is what stops the arithmetic
 * and the graph from disagreeing about which invoices count.
 *
 * `vendorId`, `employeeId`, `divisionId` and `personId` ARE fields, because they are fixed master-data
 * lookups that no reconciliation or human decision ever alters. The criterion is not "one source system" —
 * it is "can reconciliation derive it, or a human change it?"
 */

import type { IsoDate } from './dates';
import type { Money } from './money';
import type {
  ApInvoiceId, BillingId, BudgetLineId, ChangeOrderId, CommitmentId, CompanyId, CostCodeId, DivisionId,
  EmployeeId, ForecastSnapshotId, JobCostTransactionId, LaborAggregateId, MaterialReceiptId, PersonId,
  ProgressSnapshotId, ProjectId, SovItemId, VendorId,
} from './ids';

// ---------------------------------------------------------------------------------------------------------
// Source evidence
// ---------------------------------------------------------------------------------------------------------

export type SourceSystem = 'ERP' | 'PM' | 'TIMEKEEPING' | 'MASTER_DATA' | 'APPLICATION';

/** How a key was matched — distinct from `GraphLink.derivedBy`, which says which layer created a link. */
export type MappingMethod = 'seeded_master_mapping' | 'exact_key_match' | 'unmapped' | 'human_decision';

export type SourceRef = {
  system: SourceSystem;
  /** Repository-relative source file, e.g. `raw/erp/ap_invoices.csv`. */
  file: string;
  /** The raw record id within that file. */
  recordId: string;
  /** The fields actually used, so a reader can see why this record is evidence. */
  fields?: string[];
  method?: MappingMethod;
  /**
   * Mapping confidence where the source supplies one. Populated from `project_id_map.csv:mapping_confidence`;
   * `PC-UNKNOWN-88` carries 0.00, which is the evidence `DQ_PROJECT_MAP` cites.
   */
  confidence?: number;
};

/** Everything canonical carries its provenance. */
export type Sourced = { sourceRefs: SourceRef[] };

// ---------------------------------------------------------------------------------------------------------
// Organization and people
// ---------------------------------------------------------------------------------------------------------

export type Company = Sourced & {
  id: CompanyId;
  name: string;
  country: string;
  currency: string;
  closeCalendar: string;
};

export type Division = Sourced & {
  id: DivisionId;
  companyId: CompanyId;
  name: string;
};

export type Role = 'CFO' | 'Controller' | 'Project Accountant' | 'Project Manager';

export type Person = Sourced & {
  id: PersonId;
  name: string;
  role: Role;
  function: string;
  trade: string | null;
  email: string;
};

export type Employee = Sourced & {
  id: EmployeeId;
  name: string;
  trade: string;
  role: string;
  hourlyCostRate: Money;
  active: boolean;
};

export type Vendor = Sourced & {
  id: VendorId;
  name: string;
  category: string;
  tradeScope: string;
  active: boolean;
};

// ---------------------------------------------------------------------------------------------------------
// Project finance
// ---------------------------------------------------------------------------------------------------------

export type Project = Sourced & {
  id: ProjectId;
  divisionId: DivisionId;
  name: string;
  trade: string;
  customerName: string;
  projectManagerId: PersonId;
  originalContractValue: Money;
  /** The estimating baseline from the ERP project master. Basis for original margin (ASSUMPTIONS A-02). */
  originalBudgetCost: Money;
  startDate: IsoDate;
  expectedEndDate: IsoDate;
  status: string;
  /** Overall physical progress reported by the PM system. Management information, not accounting evidence. */
  overallProgressPct: number | null;
  lastProgressUpdate: IsoDate | null;
};

export type CostType = 'Labor' | 'Material' | 'Equipment' | 'Subcontract' | 'Labor/Material' | 'Other';

/**
 * A project-scoped cost code.
 *
 * `mapped: false` means the code appears in project activity but not in the project budget. Its cost stays in
 * the project total under UNMAPPED / NEEDS CLASSIFICATION and is excluded only from budget comparisons — a
 * code with no budget cannot be "over budget", so it raises `DQ_UNMAPPED_COST_CODE` instead.
 */
export type CostCode = Sourced & {
  id: CostCodeId;
  projectId: ProjectId;
  code: string;
  description: string;
  costType: CostType | null;
  mapped: boolean;
};

export type BudgetLine = Sourced & {
  id: BudgetLineId;
  projectId: ProjectId;
  costCodeId: CostCodeId;
  /** Original estimating baseline. Basis for original margin. */
  originalBudget: Money;
  /** Includes approved budget revisions. Basis for cost-code overrun comparisons. */
  currentBudget: Money;
  budgetedLaborHours: number;
  budgetRevisionReason: string | null;
  linkedChangeOrderId: ChangeOrderId | null;
};

/**
 * A point-in-time PM forecast for one cost code. Append-only: a PM answer in the app creates a new snapshot
 * with `system: 'APPLICATION'`, it never edits a CSV-derived one.
 */
export type ForecastSnapshot = Sourced & {
  id: ForecastSnapshotId;
  projectId: ProjectId;
  costCodeId: CostCodeId;
  costCode: string;
  asOfDate: IsoDate;
  /** Expected future cost not yet incurred AND not already represented by a commitment. */
  pmRemainingUncommittedCost: Money;
  pmRemainingLaborHours: number | null;
  comment: string;
  authorId: PersonId | null;
};

export type ProgressSnapshot = Sourced & {
  id: ProgressSnapshotId;
  projectId: ProjectId;
  costCodeId: CostCodeId;
  costCode: string;
  asOfDate: IsoDate;
  physicalProgressPct: number;
  source: string;
  comment: string;
};

// ---------------------------------------------------------------------------------------------------------
// Procurement and AP
// ---------------------------------------------------------------------------------------------------------

export type Commitment = Sourced & {
  id: CommitmentId;
  projectId: ProjectId;
  costCodeId: CostCodeId;
  costCode: string;
  vendorId: VendorId;
  description: string;
  committedAmount: Money;
  /**
   * The ERP's own invoiced-to-date figure. Retained as evidence only — every calculation recomputes
   * cumulative invoicing from invoice detail, because that snapshot is exactly the kind of stale
   * cross-system number this product exists to reconcile.
   */
  erpInvoicedToDateSnapshot: Money;
  status: string;
  createdDate: IsoDate;
};

export type ApprovalStatus = 'approved' | 'pending';

export type ApInvoice = Sourced & {
  id: ApInvoiceId;
  projectId: ProjectId;
  costCodeId: CostCodeId;
  costCode: string;
  vendorId: VendorId;
  invoiceNumber: string;
  invoiceDate: IsoDate;
  approvedDate: IsoDate | null;
  amount: Money;
  approvalStatus: ApprovalStatus;
  postingStatus: string;
  description: string;
  // NOTE: no `commitmentId`. The invoice→PO match is a reconciliation link.
};

export type MaterialReceipt = Sourced & {
  id: MaterialReceiptId;
  projectId: ProjectId;
  receiptDate: IsoDate;
  receivedValue: Money;
  description: string;
  // NOTE: no `commitmentId`. The receipt→PO match is a reconciliation link.
};

export type JobCostSourceType = 'AP' | 'Payroll' | 'Other';

export type JobCostTransaction = Sourced & {
  id: JobCostTransactionId;
  projectId: ProjectId;
  costCodeId: CostCodeId;
  costCode: string;
  postingDate: IsoDate;
  accountingPeriod: string;
  /** Economic category. Never `AP` — that is a posting source, not a cost type. */
  costType: CostType;
  amount: Money;
  sourceType: JobCostSourceType;
  description: string;
  // NOTE: no `invoiceId`. The posting→invoice match is a reconciliation link.
};

// ---------------------------------------------------------------------------------------------------------
// Labor
// ---------------------------------------------------------------------------------------------------------

export type LaborEntry = Sourced & {
  id: string;
  projectId: ProjectId;
  costCodeId: CostCodeId;
  costCode: string;
  employeeId: EmployeeId;
  workDate: IsoDate;
  regularHours: number;
  overtimeHours: number;
  approvalStatus: ApprovalStatus;
  postedToPayroll: boolean;
};

/**
 * Labor pre-aggregated per project and cost code.
 *
 * Exists for two reasons. First, `replay` recomputes the whole derived picture once per human decision, and
 * re-scanning 22,593 time entries each pass would be wasteful. Second, `LABOR_MISSING_POSTING` reasons at the
 * cost-code level — the oracle expects one exception covering 40 rows, not 40 exceptions.
 */
export type LaborAggregate = Sourced & {
  id: LaborAggregateId;
  projectId: ProjectId;
  costCodeId: CostCodeId;
  costCode: string;
  /** Cumulative approved hours and cost through a given as-of date, keyed by that date. */
  byAsOf: Record<IsoDate, { approvedHours: Money; approvedCost: Money }>;
  /**
   * Approved but not posted to payroll/job cost, through the close date.
   *
   * Broken down by work date so a rule can select only the entries that are genuinely late. Judging the
   * whole group by its newest entry would let one recent timecard hide every stale one behind it.
   */
  unposted: {
    entryCount: number;
    hours: number;
    cost: Money;
    earliestWorkDate: IsoDate | null;
    latestWorkDate: IsoDate | null;
    byWorkDate: Record<IsoDate, { entryCount: number; hours: number; cost: Money }>;
  };
  employeeIds: EmployeeId[];
};

// ---------------------------------------------------------------------------------------------------------
// Revenue and billing
// ---------------------------------------------------------------------------------------------------------

export type ChangeOrderStatus = 'approved' | 'pending' | 'rejected';

export type ChangeOrder = Sourced & {
  id: ChangeOrderId;
  projectId: ProjectId;
  description: string;
  status: ChangeOrderStatus;
  requestedValue: Money;
  approvedValue: Money;
  estimatedCost: Money;
  /** Cost already spent on this change. For pending COs this is the real exposure (ASSUMPTIONS A-01). */
  costIncurredToDate: Money;
  submittedDate: IsoDate;
  approvalDate: IsoDate | null;
  billingStatus: string;
};

export type SovItem = Sourced & {
  id: SovItemId;
  projectId: ProjectId;
  lineNumber: number;
  description: string;
  scheduledValue: Money;
  retainagePct: number;
  active: boolean;
  // NOTE: no `changeOrderId`. CO→SOV is a link, precisely because a human can create it (Demo C).
};

export type Billing = Sourced & {
  id: BillingId;
  projectId: ProjectId;
  billingPeriod: string;
  currentBilled: Money;
  billedToDate: Money;
  retainageHeld: Money;
  status: string;
  // NOTE: no `sovItemId`. Billing→SOV is a reconciliation link.
};

// ---------------------------------------------------------------------------------------------------------
// Data quality
// ---------------------------------------------------------------------------------------------------------

/** A source record with no canonical home. Evidence for a `DQ_*` exception, not a first-class entity. */
export type UnmappedSource = {
  sourceRef: SourceRef;
  reason: string;
  /** The raw key, which is the only stable identifier such a record has. */
  sourceKey: string;
};

// ---------------------------------------------------------------------------------------------------------
// The model
// ---------------------------------------------------------------------------------------------------------

/**
 * The whole canonical model: a pure function of the raw CSV files, built once and deeply frozen.
 *
 * Declared here at layer 3 rather than in `src/data/normalize` because `buildReconciledView` (layer 6) and
 * `computeProjectMetrics` (layer 7) both need to name it, and neither is granted an import of layer 5.
 */
export type CanonicalModel = {
  company: Company;
  divisions: readonly Division[];
  people: readonly Person[];
  employees: readonly Employee[];
  vendors: readonly Vendor[];
  projects: readonly Project[];
  costCodes: readonly CostCode[];
  budgetLines: readonly BudgetLine[];
  commitments: readonly Commitment[];
  apInvoices: readonly ApInvoice[];
  materialReceipts: readonly MaterialReceipt[];
  jobCostTransactions: readonly JobCostTransaction[];
  laborAggregates: readonly LaborAggregate[];
  forecastSnapshots: readonly ForecastSnapshot[];
  progressSnapshots: readonly ProgressSnapshot[];
  changeOrders: readonly ChangeOrder[];
  sovItems: readonly SovItem[];
  billings: readonly Billing[];
  unmappedSources: readonly UnmappedSource[];
  /** Lookup indexes built once during normalization. */
  index: {
    projectById: ReadonlyMap<ProjectId, Project>;
    costCodeById: ReadonlyMap<CostCodeId, CostCode>;
    budgetLineByCostCode: ReadonlyMap<CostCodeId, BudgetLine>;
    personById: ReadonlyMap<PersonId, Person>;
    employeeById: ReadonlyMap<EmployeeId, Employee>;
    vendorById: ReadonlyMap<VendorId, Vendor>;
    commitmentById: ReadonlyMap<CommitmentId, Commitment>;
    apInvoiceById: ReadonlyMap<ApInvoiceId, ApInvoice>;
    changeOrderById: ReadonlyMap<ChangeOrderId, ChangeOrder>;
    sovItemById: ReadonlyMap<SovItemId, SovItem>;
    laborAggregateById: ReadonlyMap<LaborAggregateId, LaborAggregate>;
  };
};
