/**
 * Typed shapes of the raw source files, exactly as the simulated client systems export them.
 *
 * These types deliberately mirror the CSV column names, including their inconsistencies across systems
 * (`erp_job_id` versus `pm_project_id`, `True`/`true` capitalisation, blank optional fields). Nothing above
 * `src/data/normalize` may import from this file — the canonical layer must stay ignorant of source schemas
 * so that swapping Sage or Procore for something else is a change in one place.
 *
 * Every field is `string` because that is what a CSV export actually is. Coercion happens during
 * normalization, where a bad value can be reported against a source record.
 */

export type RawCompany = {
  company_id: string;
  company_name: string;
  country: string;
  currency: string;
  close_calendar: string;
};

export type RawDivision = {
  division_id: string;
  division_name: string;
  company_id: string;
};

export type RawPerson = {
  person_id: string;
  person_name: string;
  role: string;
  function: string;
  trade: string;
  email: string;
};

export type RawEmployee = {
  employee_id: string;
  employee_name: string;
  trade: string;
  role: string;
  hourly_cost_rate: string;
  active: string;
};

export type RawVendor = {
  vendor_id: string;
  vendor_name: string;
  category: string;
  trade_scope: string;
  active: string;
};

/** Canonical ↔ ERP ↔ PM project mapping. One row intentionally has no canonical id. */
export type RawProjectIdMap = {
  canonical_project_id: string;
  erp_job_id: string;
  pm_project_id: string;
  mapping_confidence: string;
  mapping_method: string;
};

export type RawErpProject = {
  erp_job_id: string;
  division_id: string;
  job_name: string;
  trade: string;
  customer_name: string;
  project_manager_person_id: string;
  original_contract_value: string;
  original_budget_cost: string;
  start_date: string;
  expected_end_date: string;
  status: string;
};

export type RawPmProject = {
  pm_project_id: string;
  project_name: string;
  project_manager_person_id: string;
  overall_physical_progress_pct: string;
  last_progress_update: string;
  status: string;
};

export type RawCommitment = {
  commitment_id: string;
  erp_job_id: string;
  cost_code: string;
  vendor_id: string;
  description: string;
  committed_amount: string;
  /** ERP's own snapshot of invoicing. Reference only — we recompute from invoice detail. */
  erp_invoiced_to_date_snapshot: string;
  status: string;
  created_date: string;
};

export type RawApInvoice = {
  invoice_id: string;
  vendor_id: string;
  invoice_number: string;
  invoice_date: string;
  approved_date: string;
  erp_job_id: string;
  cost_code: string;
  commitment_id: string;
  invoice_amount: string;
  approval_status: string;
  posting_status: string;
  description: string;
};

export type RawMaterialReceipt = {
  receipt_id: string;
  commitment_id: string;
  erp_job_id: string;
  receipt_date: string;
  received_value: string;
  description: string;
};

export type RawJobCostTransaction = {
  job_cost_txn_id: string;
  erp_job_id: string;
  posting_date: string;
  accounting_period: string;
  cost_code: string;
  /** Economic category: Labor, Material, Equipment, Subcontract, Labor/Material, Other. Never `AP`. */
  cost_type: string;
  amount: string;
  /** Posting source: AP, Payroll, Other. */
  source_type: string;
  source_doc_id: string;
  description: string;
};

export type RawLaborEntry = {
  time_entry_id: string;
  employee_id: string;
  pm_project_id: string;
  work_date: string;
  cost_code: string;
  regular_hours: string;
  overtime_hours: string;
  approval_status: string;
  posted_to_payroll: string;
};

export type RawProjectBudget = {
  pm_project_id: string;
  cost_code: string;
  cost_description: string;
  cost_type: string;
  original_budget: string;
  current_budget: string;
  budgeted_labor_hours: string;
  budget_revision_reason: string;
  linked_change_order_id: string;
};

export type RawPmForecast = {
  forecast_snapshot_id: string;
  pm_project_id: string;
  as_of_date: string;
  cost_code: string;
  pm_remaining_uncommitted_cost: string;
  pm_remaining_labor_hours: string;
  comment: string;
  updated_by_person_id: string;
};

export type RawCostCodeProgress = {
  pm_project_id: string;
  as_of_date: string;
  cost_code: string;
  physical_progress_pct: string;
  source: string;
  comment: string;
};

export type RawChangeOrder = {
  change_order_id: string;
  pm_project_id: string;
  description: string;
  status: string;
  requested_value: string;
  approved_value: string;
  estimated_cost: string;
  cost_incurred_to_date: string;
  submitted_date: string;
  days_open: string;
  approval_date: string;
  billing_status: string;
};

export type RawSovItem = {
  sov_item_id: string;
  pm_project_id: string;
  line_number: string;
  description: string;
  scheduled_value: string;
  approved_co_id: string;
  retainage_pct: string;
  active: string;
};

export type RawBilling = {
  billing_id: string;
  pm_project_id: string;
  billing_period: string;
  sov_item_id: string;
  current_billed: string;
  billed_to_date: string;
  retainage_held: string;
  status: string;
};

/** Everything loaded from disk, before any normalization. */
export type RawSources = {
  company: RawCompany[];
  divisions: RawDivision[];
  people: RawPerson[];
  employees: RawEmployee[];
  vendors: RawVendor[];
  projectIdMap: RawProjectIdMap[];
  erpProjects: RawErpProject[];
  pmProjects: RawPmProject[];
  commitments: RawCommitment[];
  apInvoices: RawApInvoice[];
  materialReceipts: RawMaterialReceipt[];
  jobCostTransactions: RawJobCostTransaction[];
  laborEntries: RawLaborEntry[];
  projectBudgets: RawProjectBudget[];
  pmForecasts: RawPmForecast[];
  costCodeProgress: RawCostCodeProgress[];
  changeOrders: RawChangeOrder[];
  sovItems: RawSovItem[];
  billings: RawBilling[];
};

/** Where each collection came from, for `SourceRef.file`. */
export const SOURCE_FILES = {
  company: 'raw/master_data/company.csv',
  divisions: 'raw/master_data/divisions.csv',
  people: 'raw/master_data/people.csv',
  employees: 'raw/master_data/employees.csv',
  vendors: 'raw/master_data/vendors.csv',
  projectIdMap: 'raw/master_data/project_id_map.csv',
  erpProjects: 'raw/erp/projects.csv',
  pmProjects: 'raw/project_management/projects.csv',
  commitments: 'raw/erp/commitments.csv',
  apInvoices: 'raw/erp/ap_invoices.csv',
  materialReceipts: 'raw/erp/material_receipts.csv',
  jobCostTransactions: 'raw/erp/job_cost_transactions.csv',
  laborEntries: 'raw/timekeeping/labor_entries.csv',
  projectBudgets: 'raw/project_management/project_budgets.csv',
  pmForecasts: 'raw/project_management/pm_forecasts.csv',
  costCodeProgress: 'raw/project_management/cost_code_progress.csv',
  changeOrders: 'raw/project_management/change_orders.csv',
  sovItems: 'raw/project_management/schedule_of_values.csv',
  billings: 'raw/project_management/billings.csv',
} as const satisfies Record<keyof RawSources, string>;

/** Which simulated system each collection represents. */
export const SOURCE_SYSTEMS = {
  company: 'MASTER_DATA',
  divisions: 'MASTER_DATA',
  people: 'MASTER_DATA',
  employees: 'MASTER_DATA',
  vendors: 'MASTER_DATA',
  projectIdMap: 'MASTER_DATA',
  erpProjects: 'ERP',
  pmProjects: 'PM',
  commitments: 'ERP',
  apInvoices: 'ERP',
  materialReceipts: 'ERP',
  jobCostTransactions: 'ERP',
  laborEntries: 'TIMEKEEPING',
  projectBudgets: 'PM',
  pmForecasts: 'PM',
  costCodeProgress: 'PM',
  changeOrders: 'PM',
  sovItems: 'PM',
  billings: 'PM',
} as const satisfies Record<keyof RawSources, 'ERP' | 'PM' | 'TIMEKEEPING' | 'MASTER_DATA'>;
