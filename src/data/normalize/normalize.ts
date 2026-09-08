/**
 * Normalization: raw source rows in, frozen canonical model out.
 *
 * This is the only module that sees both raw column names and canonical types, which is what keeps the
 * canonical layer ignorant of Sage/Procore schemas and makes a future ERP adapter a change in one place.
 *
 * Two rules it enforces on the way through:
 *
 * 1. **Nothing economically real is dropped because classification is unresolved.** A job-cost transaction on
 *    a cost code that is not in the project budget still belongs to the project — it gets an unmapped
 *    `CostCode` and lands in the project total under UNMAPPED. A source project with no canonical mapping
 *    becomes an `UnmappedSource` record rather than vanishing.
 * 2. **No reconciled counterparty ids on entities.** `commitment_id`, `source_doc_id`, `approved_co_id` and
 *    `sov_item_id` are read here only to be handed to `src/reconciliation`, which turns them into links.
 */

import { V0_CONFIG } from '@/config/v0Config';
import { parseDate } from '@/domain/dates';
import { parseMoney, parseOptionalNumber } from '@/domain/money';
import {
  apInvoiceId, billingId, budgetLineId, changeOrderId, commitmentId, companyId, costCodeId, divisionId,
  employeeId, forecastSnapshotId, jobCostTransactionId, laborAggregateId, materialReceiptId, personId,
  progressSnapshotId, projectId, sovItemId, vendorId,
} from '@/domain/ids';
import type {
  ApInvoice, ApprovalStatus, Billing, BudgetLine, CanonicalModel, ChangeOrder, ChangeOrderStatus, Commitment,
  Company, CostCode, CostType, Division, Employee, ForecastSnapshot, JobCostSourceType, JobCostTransaction,
  LaborAggregate, MaterialReceipt, Person, ProgressSnapshot, Project, Role, SourceRef, SovItem,
  UnmappedSource, Vendor,
} from '@/domain/entities';
import type { CostCodeId, EmployeeId, ProjectId } from '@/domain/ids';
import type { ReconciliationKeys } from '@/domain/reconciliation';
import { SOURCE_FILES, SOURCE_SYSTEMS, type RawSources } from '@/data/raw/rawTypes';

// ---------------------------------------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------------------------------------

type Collection = keyof RawSources;

function ref(collection: Collection, recordId: string, fields?: string[]): SourceRef {
  return {
    system: SOURCE_SYSTEMS[collection],
    file: SOURCE_FILES[collection],
    recordId,
    ...(fields ? { fields } : {}),
  };
}

const COST_TYPES = new Set<CostType>([
  'Labor', 'Material', 'Equipment', 'Subcontract', 'Labor/Material', 'Other',
]);

function costType(raw: string): CostType | null {
  return COST_TYPES.has(raw as CostType) ? (raw as CostType) : null;
}

function approvalStatus(raw: string): ApprovalStatus {
  return raw === 'approved' ? 'approved' : 'pending';
}

function bool(raw: string): boolean {
  return raw.toLowerCase() === 'true';
}

function requireDate(raw: string, context: string): string {
  const parsed = parseDate(raw);
  if (parsed === null) throw new Error(`${context}: expected a date, found blank`);
  return parsed;
}

const ROLES = new Set<Role>(['CFO', 'Controller', 'Project Accountant', 'Project Manager']);

function role(raw: string): Role {
  if (!ROLES.has(raw as Role)) throw new Error(`Unknown person role in master data: ${raw}`);
  return raw as Role;
}

// ---------------------------------------------------------------------------------------------------------
// Project mapping
// ---------------------------------------------------------------------------------------------------------

type ProjectMapping = {
  erpToProject: Map<string, ProjectId>;
  pmToProject: Map<string, ProjectId>;
  projectToErp: Map<ProjectId, string>;
  projectToPm: Map<ProjectId, string>;
  unmapped: UnmappedSource[];
};

function buildProjectMapping(raw: RawSources): ProjectMapping {
  const erpToProject = new Map<string, ProjectId>();
  const pmToProject = new Map<string, ProjectId>();
  const projectToErp = new Map<ProjectId, string>();
  const projectToPm = new Map<ProjectId, string>();
  const unmapped: UnmappedSource[] = [];

  for (const row of raw.projectIdMap) {
    const confidence = parseOptionalNumber(row.mapping_confidence);

    if (row.canonical_project_id === '') {
      // A source project that cannot be mapped. Kept as evidence rather than dropped — this is the
      // DQ_PROJECT_MAP case, and the raw key is the only stable identifier such a record has.
      const sourceKey = row.pm_project_id || row.erp_job_id;
      unmapped.push({
        sourceKey,
        reason: 'Source project has no canonical mapping.',
        sourceRef: {
          ...ref('projectIdMap', sourceKey, ['canonical_project_id', 'mapping_confidence', 'mapping_method']),
          method: 'unmapped',
          ...(confidence === null ? {} : { confidence }),
        },
      });
      continue;
    }

    const canonical = projectId(row.canonical_project_id);
    if (row.erp_job_id !== '') {
      erpToProject.set(row.erp_job_id, canonical);
      projectToErp.set(canonical, row.erp_job_id);
    }
    if (row.pm_project_id !== '') {
      pmToProject.set(row.pm_project_id, canonical);
      projectToPm.set(canonical, row.pm_project_id);
    }
  }

  return { erpToProject, pmToProject, projectToErp, projectToPm, unmapped };
}

// ---------------------------------------------------------------------------------------------------------
// Cost codes
// ---------------------------------------------------------------------------------------------------------

/**
 * Cost codes come from the budget, but activity can reference codes the budget does not contain. Those get an
 * unmapped cost code so their cost stays in the project total; they are simply excluded from budget
 * comparisons, because a code with no budget cannot be "over budget".
 */
function buildCostCodes(
  raw: RawSources,
  mapping: ProjectMapping,
): { costCodes: CostCode[]; budgetLines: BudgetLine[] } {
  const costCodes = new Map<CostCodeId, CostCode>();
  const budgetLines: BudgetLine[] = [];

  const ensure = (
    project: ProjectId,
    code: string,
    description: string,
    type: CostType | null,
    mapped: boolean,
    sourceRef: SourceRef,
  ): CostCode => {
    const id = costCodeId(project, code);
    const existing = costCodes.get(id);
    if (existing) {
      if (mapped && !existing.mapped) {
        existing.mapped = true;
        existing.description = description;
        existing.costType = type;
      }
      existing.sourceRefs.push(sourceRef);
      return existing;
    }
    const created: CostCode = {
      id, projectId: project, code, description, costType: type, mapped, sourceRefs: [sourceRef],
    };
    costCodes.set(id, created);
    return created;
  };

  for (const row of raw.projectBudgets) {
    const project = mapping.pmToProject.get(row.pm_project_id);
    if (!project) continue;

    const budgetRef = ref('projectBudgets', `${row.pm_project_id}:${row.cost_code}`, [
      'original_budget', 'current_budget', 'budgeted_labor_hours',
    ]);
    const cc = ensure(project, row.cost_code, row.cost_description, costType(row.cost_type), true, budgetRef);

    budgetLines.push({
      id: budgetLineId(project, row.cost_code),
      projectId: project,
      costCodeId: cc.id,
      originalBudget: parseMoney(row.original_budget),
      currentBudget: parseMoney(row.current_budget),
      budgetedLaborHours: parseMoney(row.budgeted_labor_hours),
      budgetRevisionReason: row.budget_revision_reason === '' ? null : row.budget_revision_reason,
      linkedChangeOrderId:
        row.linked_change_order_id === '' ? null : changeOrderId(row.linked_change_order_id),
      sourceRefs: [budgetRef],
    });
  }

  // Codes referenced by activity but absent from the budget.
  for (const row of raw.jobCostTransactions) {
    const project = mapping.erpToProject.get(row.erp_job_id);
    if (!project) continue;
    ensure(
      project, row.cost_code, row.description, costType(row.cost_type), false,
      ref('jobCostTransactions', row.job_cost_txn_id, ['cost_code']),
    );
  }

  return { costCodes: [...costCodes.values()], budgetLines };
}

// ---------------------------------------------------------------------------------------------------------
// Labor aggregation
// ---------------------------------------------------------------------------------------------------------

/**
 * Collapse 22,593 time entries into one record per project and cost code.
 *
 * Two reasons. `replay` recomputes everything once per human decision, so re-scanning every row each pass
 * would be wasteful. And `LABOR_MISSING_POSTING` reasons at the cost-code level — the oracle expects one
 * exception covering 40 unposted rows, not 40 separate exceptions.
 *
 * Labor cost is `regular × rate + overtime × rate × 1.5`, with the multiplier from config.
 */
function buildLaborAggregates(
  raw: RawSources,
  mapping: ProjectMapping,
  employees: Map<EmployeeId, Employee>,
): LaborAggregate[] {
  const asOfDates = [V0_CONFIG.priorComparisonDate, V0_CONFIG.closeDate];
  const multiplier = V0_CONFIG.overtimeCostMultiplier;

  const aggregates = new Map<string, LaborAggregate>();

  for (const row of raw.laborEntries) {
    const project = mapping.pmToProject.get(row.pm_project_id);
    if (!project) continue;

    const code = costCodeId(project, row.cost_code);
    const id = laborAggregateId(project, row.cost_code);

    let aggregate = aggregates.get(id);
    if (!aggregate) {
      aggregate = {
        id,
        projectId: project,
        costCodeId: code,
        costCode: row.cost_code,
        byAsOf: Object.fromEntries(asOfDates.map((d) => [d, { approvedHours: 0, approvedCost: 0 }])),
        unposted: {
          entryCount: 0, hours: 0, cost: 0,
          earliestWorkDate: null, latestWorkDate: null,
          byWorkDate: {},
        },
        employeeIds: [],
        sourceRefs: [],
      };
      aggregates.set(id, aggregate);
    }

    const employee = employees.get(employeeId(row.employee_id));
    const rate = employee?.hourlyCostRate ?? 0;
    const regular = parseMoney(row.regular_hours);
    const overtime = parseMoney(row.overtime_hours);
    const hours = regular + overtime;
    const cost = regular * rate + overtime * rate * multiplier;

    const workDate = requireDate(row.work_date, `labor entry ${row.time_entry_id}`);
    const approved = approvalStatus(row.approval_status) === 'approved';

    if (approved) {
      for (const asOf of asOfDates) {
        if (workDate <= asOf) {
          const bucket = aggregate.byAsOf[asOf]!;
          bucket.approvedHours += hours;
          bucket.approvedCost += cost;
        }
      }
    }

    // Only entries on or before the close date. The source data happens to stop there, but relying on that
    // would make the aggregate wrong the moment the data set is extended.
    if (approved && !bool(row.posted_to_payroll) && workDate <= V0_CONFIG.closeDate) {
      const bucket = (aggregate.unposted.byWorkDate[workDate] ??= { entryCount: 0, hours: 0, cost: 0 });
      bucket.entryCount += 1;
      bucket.hours += hours;
      bucket.cost += cost;

      aggregate.unposted.entryCount += 1;
      aggregate.unposted.hours += hours;
      aggregate.unposted.cost += cost;
      aggregate.unposted.earliestWorkDate =
        aggregate.unposted.earliestWorkDate === null || workDate < aggregate.unposted.earliestWorkDate
          ? workDate
          : aggregate.unposted.earliestWorkDate;
      aggregate.unposted.latestWorkDate =
        aggregate.unposted.latestWorkDate === null || workDate > aggregate.unposted.latestWorkDate
          ? workDate
          : aggregate.unposted.latestWorkDate;
      // Only the exception-relevant rows are enumerated as evidence; enumerating all 22,593 would be noise.
      aggregate.sourceRefs.push(
        ref('laborEntries', row.time_entry_id, ['work_date', 'regular_hours', 'overtime_hours', 'posted_to_payroll']),
      );
    }

    const empId = employeeId(row.employee_id);
    if (!aggregate.employeeIds.includes(empId)) aggregate.employeeIds.push(empId);
  }

  return [...aggregates.values()];
}

// ---------------------------------------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------------------------------------

export type NormalizationResult = {
  model: CanonicalModel;
  /** Raw counterparty keys, handed to `src/reconciliation` and to nobody else. */
  reconciliationKeys: ReconciliationKeys;
};

export function normalize(raw: RawSources): NormalizationResult {
  const mapping = buildProjectMapping(raw);

  const companyRow = raw.company[0];
  if (!companyRow) throw new Error('company.csv contains no rows');
  const company: Company = {
    id: companyId(companyRow.company_id),
    name: companyRow.company_name,
    country: companyRow.country,
    currency: companyRow.currency,
    closeCalendar: companyRow.close_calendar,
    sourceRefs: [ref('company', companyRow.company_id)],
  };

  const divisions: Division[] = raw.divisions.map((r) => ({
    id: divisionId(r.division_id),
    companyId: companyId(r.company_id),
    name: r.division_name,
    sourceRefs: [ref('divisions', r.division_id)],
  }));

  const people: Person[] = raw.people.map((r) => ({
    id: personId(r.person_id),
    name: r.person_name,
    role: role(r.role),
    function: r.function,
    trade: r.trade === '' ? null : r.trade,
    email: r.email,
    sourceRefs: [ref('people', r.person_id)],
  }));

  const employees: Employee[] = raw.employees.map((r) => ({
    id: employeeId(r.employee_id),
    name: r.employee_name,
    trade: r.trade,
    role: r.role,
    hourlyCostRate: parseMoney(r.hourly_cost_rate),
    active: bool(r.active),
    sourceRefs: [ref('employees', r.employee_id, ['hourly_cost_rate'])],
  }));
  const employeeById = new Map(employees.map((e) => [e.id, e]));

  const vendors: Vendor[] = raw.vendors.map((r) => ({
    id: vendorId(r.vendor_id),
    name: r.vendor_name,
    category: r.category,
    tradeScope: r.trade_scope,
    active: bool(r.active),
    sourceRefs: [ref('vendors', r.vendor_id)],
  }));

  // Projects merge the ERP job master with the PM project master.
  const pmProjectByCanonical = new Map<ProjectId, (typeof raw.pmProjects)[number]>();
  for (const r of raw.pmProjects) {
    const canonical = mapping.pmToProject.get(r.pm_project_id);
    if (canonical) pmProjectByCanonical.set(canonical, r);
  }

  const projects: Project[] = raw.erpProjects.flatMap((r) => {
    const canonical = mapping.erpToProject.get(r.erp_job_id);
    if (!canonical) return [];
    const pm = pmProjectByCanonical.get(canonical);
    return [{
      id: canonical,
      divisionId: divisionId(r.division_id),
      name: r.job_name,
      trade: r.trade,
      customerName: r.customer_name,
      projectManagerId: personId(r.project_manager_person_id),
      originalContractValue: parseMoney(r.original_contract_value),
      originalBudgetCost: parseMoney(r.original_budget_cost),
      startDate: requireDate(r.start_date, `project ${r.erp_job_id}`),
      expectedEndDate: requireDate(r.expected_end_date, `project ${r.erp_job_id}`),
      status: r.status,
      overallProgressPct: pm ? parseOptionalNumber(pm.overall_physical_progress_pct) : null,
      lastProgressUpdate: pm ? parseDate(pm.last_progress_update) : null,
      sourceRefs: [
        ref('erpProjects', r.erp_job_id, ['original_contract_value', 'original_budget_cost']),
        ...(pm ? [ref('pmProjects', pm.pm_project_id, ['overall_physical_progress_pct'])] : []),
        {
          ...ref('projectIdMap', canonical, ['canonical_project_id', 'erp_job_id', 'pm_project_id']),
          method: 'seeded_master_mapping' as const,
          confidence: 1,
        },
      ],
    }];
  });

  const { costCodes, budgetLines } = buildCostCodes(raw, mapping);
  const costCodeById = new Map(costCodes.map((c) => [c.id, c]));

  // --- Procurement / AP -----------------------------------------------------------------------------------
  const invoiceToCommitment = new Map<string, string>();
  const apInvoices: ApInvoice[] = raw.apInvoices.flatMap((r) => {
    const project = mapping.erpToProject.get(r.erp_job_id);
    if (!project) return [];
    const id = apInvoiceId(r.invoice_id);
    if (r.commitment_id !== '') invoiceToCommitment.set(id, r.commitment_id);
    return [{
      id,
      projectId: project,
      costCodeId: costCodeId(project, r.cost_code),
      costCode: r.cost_code,
      vendorId: vendorId(r.vendor_id),
      invoiceNumber: r.invoice_number,
      invoiceDate: requireDate(r.invoice_date, `invoice ${r.invoice_id}`),
      approvedDate: parseDate(r.approved_date),
      amount: parseMoney(r.invoice_amount),
      approvalStatus: approvalStatus(r.approval_status),
      postingStatus: r.posting_status,
      description: r.description,
      sourceRefs: [ref('apInvoices', r.invoice_id, [
        'invoice_amount', 'approval_status', 'approved_date', 'posting_status', 'cost_code',
      ])],
    }];
  });

  const commitments: Commitment[] = raw.commitments.flatMap((r) => {
    const project = mapping.erpToProject.get(r.erp_job_id);
    if (!project) return [];
    return [{
      id: commitmentId(r.commitment_id),
      projectId: project,
      costCodeId: costCodeId(project, r.cost_code),
      costCode: r.cost_code,
      vendorId: vendorId(r.vendor_id),
      description: r.description,
      committedAmount: parseMoney(r.committed_amount),
      erpInvoicedToDateSnapshot: parseMoney(r.erp_invoiced_to_date_snapshot),
      status: r.status,
      createdDate: requireDate(r.created_date, `commitment ${r.commitment_id}`),
      sourceRefs: [ref('commitments', r.commitment_id, ['committed_amount', 'status', 'cost_code'])],
    }];
  });

  const receiptToCommitment = new Map<string, string>();
  const materialReceipts: MaterialReceipt[] = raw.materialReceipts.flatMap((r) => {
    const project = mapping.erpToProject.get(r.erp_job_id);
    if (!project) return [];
    const id = materialReceiptId(r.receipt_id);
    if (r.commitment_id !== '') receiptToCommitment.set(id, r.commitment_id);
    return [{
      id,
      projectId: project,
      receiptDate: requireDate(r.receipt_date, `receipt ${r.receipt_id}`),
      receivedValue: parseMoney(r.received_value),
      description: r.description,
      sourceRefs: [ref('materialReceipts', r.receipt_id, ['received_value', 'receipt_date'])],
    }];
  });

  const postingToInvoice = new Map<string, string>();
  const jobCostTransactions: JobCostTransaction[] = raw.jobCostTransactions.flatMap((r) => {
    const project = mapping.erpToProject.get(r.erp_job_id);
    if (!project) return [];
    const id = jobCostTransactionId(r.job_cost_txn_id);
    if (r.source_type === 'AP' && r.source_doc_id !== '') postingToInvoice.set(id, r.source_doc_id);
    const type = costType(r.cost_type);
    if (type === null) {
      throw new Error(`Job cost ${r.job_cost_txn_id} has unknown cost_type ${JSON.stringify(r.cost_type)}`);
    }
    return [{
      id,
      projectId: project,
      costCodeId: costCodeId(project, r.cost_code),
      costCode: r.cost_code,
      postingDate: requireDate(r.posting_date, `job cost ${r.job_cost_txn_id}`),
      accountingPeriod: r.accounting_period,
      costType: type,
      amount: parseMoney(r.amount),
      sourceType: (r.source_type as JobCostSourceType) ?? 'Other',
      description: r.description,
      sourceRefs: [ref('jobCostTransactions', r.job_cost_txn_id, ['amount', 'posting_date', 'cost_code'])],
    }];
  });

  // --- Forecast / progress --------------------------------------------------------------------------------
  const forecastSnapshots: ForecastSnapshot[] = raw.pmForecasts.flatMap((r) => {
    const project = mapping.pmToProject.get(r.pm_project_id);
    if (!project) return [];
    const asOf = requireDate(r.as_of_date, `forecast ${r.forecast_snapshot_id}`);
    return [{
      id: forecastSnapshotId(project, r.cost_code, asOf),
      projectId: project,
      costCodeId: costCodeId(project, r.cost_code),
      costCode: r.cost_code,
      asOfDate: asOf,
      pmRemainingUncommittedCost: parseMoney(r.pm_remaining_uncommitted_cost),
      pmRemainingLaborHours: parseOptionalNumber(r.pm_remaining_labor_hours),
      comment: r.comment,
      authorId: r.updated_by_person_id === '' ? null : personId(r.updated_by_person_id),
      sourceRefs: [ref('pmForecasts', r.forecast_snapshot_id, [
        'pm_remaining_uncommitted_cost', 'pm_remaining_labor_hours', 'comment', 'as_of_date',
      ])],
    }];
  });

  const progressSnapshots: ProgressSnapshot[] = raw.costCodeProgress.flatMap((r) => {
    const project = mapping.pmToProject.get(r.pm_project_id);
    if (!project) return [];
    const asOf = requireDate(r.as_of_date, `progress ${r.pm_project_id}:${r.cost_code}`);
    return [{
      id: progressSnapshotId(project, r.cost_code, asOf),
      projectId: project,
      costCodeId: costCodeId(project, r.cost_code),
      costCode: r.cost_code,
      asOfDate: asOf,
      physicalProgressPct: parseMoney(r.physical_progress_pct),
      source: r.source,
      comment: r.comment,
      sourceRefs: [ref('costCodeProgress', `${r.pm_project_id}:${r.cost_code}:${asOf}`, [
        'physical_progress_pct', 'as_of_date',
      ])],
    }];
  });

  // --- Revenue / billing ----------------------------------------------------------------------------------
  const changeOrders: ChangeOrder[] = raw.changeOrders.flatMap((r) => {
    const project = mapping.pmToProject.get(r.pm_project_id);
    if (!project) return [];
    return [{
      id: changeOrderId(r.change_order_id),
      projectId: project,
      description: r.description,
      status: r.status as ChangeOrderStatus,
      requestedValue: parseMoney(r.requested_value),
      approvedValue: parseMoney(r.approved_value),
      estimatedCost: parseMoney(r.estimated_cost),
      costIncurredToDate: parseMoney(r.cost_incurred_to_date),
      submittedDate: requireDate(r.submitted_date, `change order ${r.change_order_id}`),
      approvalDate: parseDate(r.approval_date),
      billingStatus: r.billing_status,
      sourceRefs: [ref('changeOrders', r.change_order_id, [
        'status', 'requested_value', 'approved_value', 'cost_incurred_to_date', 'approval_date',
      ])],
    }];
  });

  const sovToChangeOrder = new Map<string, string>();
  const sovItems: SovItem[] = raw.sovItems.flatMap((r) => {
    const project = mapping.pmToProject.get(r.pm_project_id);
    if (!project) return [];
    const id = sovItemId(r.sov_item_id);
    if (r.approved_co_id !== '') sovToChangeOrder.set(id, r.approved_co_id);
    return [{
      id,
      projectId: project,
      lineNumber: parseMoney(r.line_number),
      description: r.description,
      scheduledValue: parseMoney(r.scheduled_value),
      retainagePct: parseMoney(r.retainage_pct),
      active: bool(r.active),
      sourceRefs: [ref('sovItems', r.sov_item_id, ['scheduled_value', 'retainage_pct', 'approved_co_id'])],
    }];
  });

  const billingToSov = new Map<string, string>();
  const billings: Billing[] = raw.billings.flatMap((r) => {
    const project = mapping.pmToProject.get(r.pm_project_id);
    if (!project) return [];
    const id = billingId(r.billing_id);
    if (r.sov_item_id !== '') billingToSov.set(id, r.sov_item_id);
    return [{
      id,
      projectId: project,
      billingPeriod: r.billing_period,
      currentBilled: parseMoney(r.current_billed),
      billedToDate: parseMoney(r.billed_to_date),
      retainageHeld: parseMoney(r.retainage_held),
      status: r.status,
      sourceRefs: [ref('billings', r.billing_id, [
        'current_billed', 'billed_to_date', 'retainage_held', 'sov_item_id',
      ])],
    }];
  });

  const laborAggregates = buildLaborAggregates(raw, mapping, employeeById);

  const model: CanonicalModel = {
    company,
    divisions,
    people,
    employees,
    vendors,
    projects,
    costCodes,
    budgetLines,
    commitments,
    apInvoices,
    materialReceipts,
    jobCostTransactions,
    laborAggregates,
    forecastSnapshots,
    progressSnapshots,
    changeOrders,
    sovItems,
    billings,
    unmappedSources: mapping.unmapped,
    index: {
      projectById: new Map(projects.map((p) => [p.id, p])),
      costCodeById,
      budgetLineByCostCode: new Map(budgetLines.map((b) => [b.costCodeId, b])),
      personById: new Map(people.map((p) => [p.id, p])),
      employeeById,
      vendorById: new Map(vendors.map((v) => [v.id, v])),
      commitmentById: new Map(commitments.map((c) => [c.id, c])),
      apInvoiceById: new Map(apInvoices.map((i) => [i.id, i])),
      changeOrderById: new Map(changeOrders.map((c) => [c.id, c])),
      sovItemById: new Map(sovItems.map((s) => [s.id, s])),
      laborAggregateById: new Map(laborAggregates.map((l) => [l.id, l])),
    },
  };

  return {
    model,
    reconciliationKeys: {
      invoiceToCommitment,
      receiptToCommitment,
      postingToInvoice,
      sovToChangeOrder,
      billingToSov,
    },
  };
}
