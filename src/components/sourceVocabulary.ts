/**
 * Plain-English names for the things a source record is made of.
 *
 * The evidence panel was showing a finance team a file path and a list of database column names. Both are
 * true and neither is readable: `raw/project_management/change_orders.csv (approved_value, approval_date)`
 * asks the reader to know how this application stores its data before they can judge whether the finding is
 * right. The same record described as "Change order CO-1004-A, from the project management system — read its
 * approved value and approval date" asks nothing of them.
 *
 * Nothing is hidden. The raw path and column names stay in the panel's audit line, where someone checking the
 * software rather than the finding can still find them.
 */

import type { SourceSystem } from '@/domain/entities';

const SYSTEM: Record<SourceSystem, string> = {
  ERP: 'the accounting system',
  PM: 'the project management system',
  TIMEKEEPING: 'the timekeeping system',
  MASTER_DATA: 'company master data',
  APPLICATION: 'this application',
};

export function systemLabel(system: SourceSystem): string {
  return SYSTEM[system];
}

/**
 * What kind of record this is, named the way the people who work with it name it.
 *
 * Keyed on the filename rather than the full path so a directory reshuffle cannot silently drop a label back
 * to the raw filename.
 */
const RECORD_KIND: Record<string, string> = {
  'ap_invoices.csv': 'Invoice',
  'commitments.csv': 'Purchase order',
  'job_cost_transactions.csv': 'Job cost posting',
  'material_receipts.csv': 'Material receipt',
  'projects.csv': 'Project',
  'company.csv': 'Company record',
  'divisions.csv': 'Division',
  'employees.csv': 'Employee',
  'people.csv': 'Person',
  'project_id_map.csv': 'Project mapping',
  'vendors.csv': 'Vendor',
  'billings.csv': 'Billing',
  'change_orders.csv': 'Change order',
  'cost_code_progress.csv': 'Progress report',
  'pm_forecasts.csv': 'Forecast',
  'project_budgets.csv': 'Budget line',
  'schedule_of_values.csv': 'Schedule of values line',
  'labor_entries.csv': 'Timecard',

  // Not source files. Evidence can cite something this application produced — most importantly a human's own
  // answer, which is the most consequential record in the trail and the one it would be worst to label
  // "Record". Overlaid forecast snapshots carry these refs, so they do reach the evidence panel.
  'decision-ledger': 'Decision',
  'src/agents/agents.ts': 'Agent',
};

/** Whether a record kind has a name. Used by the test that keeps this list exhaustive. */
export function hasRecordKind(file: string): boolean {
  return (file.split('/').at(-1) ?? file) in RECORD_KIND || file in RECORD_KIND;
}

/** "Change order", from `raw/project_management/change_orders.csv`. */
export function recordKind(file: string): string {
  return RECORD_KIND[file] ?? RECORD_KIND[file.split('/').at(-1) ?? file] ?? 'Record';
}

/**
 * Every column a rule can cite as evidence, in words, so the panel can say what was read.
 *
 * Exhaustive rather than a list of exceptions, and pinned by a test: a field with no entry falls back to its
 * raw name, which is the failure this file exists to prevent, and a silent fallback is one nobody notices
 * until a customer is looking at `overall_physical_progress_pct` on screen.
 *
 * Plain values are bare noun phrases and relationships are clauses, because both have to read as the object
 * of "we read …" — "we read received value and receipt date", "we read which purchase order it belongs to".
 */
const FIELD: Record<string, string> = {
  // Money and quantities.
  amount: 'the amount',
  approved_value: 'approved value',
  billed_to_date: 'billed to date',
  budgeted_labor_hours: 'budgeted hours',
  committed_amount: 'committed amount',
  cost_incurred_to_date: 'cost incurred so far',
  current_billed: 'billed this period',
  current_budget: 'current budget',
  hourly_cost_rate: 'the crew cost rate',
  invoice_amount: 'invoice amount',
  original_budget: 'original budget',
  original_budget_cost: 'original budget cost',
  original_contract_value: 'original contract value',
  overtime_hours: 'overtime hours',
  pm_remaining_labor_hours: 'the hours the project manager still expects to need',
  pm_remaining_uncommitted_cost: 'the cost the project manager still expects to spend',
  received_value: 'received value',
  regular_hours: 'regular hours',
  requested_value: 'requested value',
  retainage_held: 'retainage held',
  retainage_pct: 'retainage rate',
  scheduled_value: 'scheduled value',

  // Progress and classification.
  cost_code: 'cost code',
  overall_physical_progress_pct: 'overall progress',
  physical_progress_pct: 'physical progress',
  comment: 'the note left against it',
  status: 'status',
  approval_status: 'whether it is approved',
  posting_status: 'whether it reached the job-cost ledger',
  posted_to_payroll: 'whether it reached payroll',
  source_type: 'where the posting came from',

  // Dates.
  approval_date: 'the date it was approved',
  approved_date: 'the date it was approved',
  as_of_date: 'the date it was recorded',
  posting_date: 'the date it was posted',
  receipt_date: 'the date it was received',
  work_date: 'the date worked',

  // What a record says about its relationship to another. These are the keys the reconciliation layer joins
  // on, and naming them as joins is what makes an evidence trail checkable rather than decorative.
  approved_co_id: 'which change order it came from',
  canonical_project_id: 'which project it maps to',
  commitment_id: 'which purchase order it belongs to',
  erp_job_id: 'its job number in the accounting system',
  pm_project_id: 'its project number in the project management system',
  sov_item_id: 'which schedule of values line it bills against',
  source_doc_id: 'which document it was posted from',
  mapping_confidence: 'how confident that match is',
  mapping_method: 'how that match was made',

  // Values a human typed into this application, rather than anything a source system holds.
  changeOrderId: 'the change order it was recorded against',
  scheduledValue: 'the value entered',
  lines: 'the forecast lines entered',
};

/** Whether a cited field has a plain-English name. Used by the test that keeps this list exhaustive. */
export function hasFieldLabel(field: string): boolean {
  return field in FIELD;
}

/** "approved value" — what the rule actually read on that record. */
export function fieldLabel(field: string): string {
  return FIELD[field] ?? field.replaceAll('_', ' ');
}

/** "its approved value, approval date and status" — the fields as a readable list. */
export function fieldList(fields: readonly string[]): string {
  const labels = fields.map(fieldLabel);
  if (labels.length === 0) return '';
  if (labels.length === 1) return labels[0]!;
  return `${labels.slice(0, -1).join(', ')} and ${labels.at(-1)}`;
}
