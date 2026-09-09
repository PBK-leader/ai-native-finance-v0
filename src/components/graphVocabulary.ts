/**
 * The words and colours the graph explorer uses for node and link types.
 *
 * Typed as `Record<NodeType, …>` on purpose: adding a node type to the domain without giving it a name and a
 * colour is a compile error here, not a lowercase fallback discovered in a demo.
 */

import type { GraphLink, LinkType, NodeType } from '@/domain/graph';

export const TYPE_COLOR: Record<NodeType, string> = {
  COMPANY: '#1e293b',
  DIVISION: '#334155',
  PROJECT: '#1d4ed8',
  PERSON: '#334155',
  EMPLOYEE: '#475569',
  VENDOR: '#334155',
  COST_CODE: '#0f766e',
  BUDGET_LINE: '#0d9488',
  COMMITMENT: '#7c3aed',
  MATERIAL_RECEIPT: '#a16207',
  AP_INVOICE: '#b45309',
  JOB_COST_TXN: '#475569',
  LABOR_AGGREGATE: '#4d7c0f',
  PROGRESS_SNAPSHOT: '#7e22ce',
  FORECAST_SNAPSHOT: '#6d28d9',
  CHANGE_ORDER: '#be185d',
  SOV_ITEM: '#0369a1',
  BILLING: '#0891b2',
  EXCEPTION: '#b91c1c',
  TASK: '#c2410c',
  REVIEW_DECISION: '#15803d',
  AGENT: '#0f172a',
  AGENT_ACTION: '#1e293b',
  UNMAPPED_SOURCE: '#dc2626',
};

/** Plain-English names — the raw type codes read fine to whoever wrote the rule engine, not to a first-time viewer. */
export const TYPE_LABEL: Record<NodeType, string> = {
  COMPANY: 'Company',
  DIVISION: 'Division',
  PROJECT: 'Project',
  PERSON: 'Person',
  EMPLOYEE: 'Employee',
  VENDOR: 'Vendor',
  COST_CODE: 'Cost code',
  BUDGET_LINE: 'Budget line',
  COMMITMENT: 'Commitment (PO)',
  MATERIAL_RECEIPT: 'Material receipt',
  AP_INVOICE: 'AP invoice',
  JOB_COST_TXN: 'Job cost transaction',
  LABOR_AGGREGATE: 'Labor',
  PROGRESS_SNAPSHOT: 'Progress snapshot',
  FORECAST_SNAPSHOT: 'Forecast snapshot',
  CHANGE_ORDER: 'Change order',
  SOV_ITEM: 'Schedule-of-values line',
  BILLING: 'Billing',
  EXCEPTION: 'Exception',
  TASK: 'Task',
  REVIEW_DECISION: 'Human decision',
  AGENT: 'Agent',
  AGENT_ACTION: 'Agent action',
  UNMAPPED_SOURCE: 'Unmapped source record',
};

export function typeLabel(type: NodeType): string {
  return TYPE_LABEL[type];
}

/** The types a viewer can toggle. Anything not listed here is unreachable from the UI. */
export const FILTERABLE: readonly NodeType[] = [
  'PROJECT', 'COST_CODE', 'COMMITMENT', 'AP_INVOICE', 'MATERIAL_RECEIPT', 'JOB_COST_TXN',
  'LABOR_AGGREGATE', 'CHANGE_ORDER', 'SOV_ITEM', 'BILLING', 'FORECAST_SNAPSHOT', 'PROGRESS_SNAPSHOT',
  'EXCEPTION', 'TASK', 'REVIEW_DECISION', 'VENDOR', 'PERSON', 'AGENT',
];

export function isNodeType(value: string): value is NodeType {
  return value in TYPE_LABEL;
}

/** What a project view shows before any filter is chosen. */
export const DEFAULT_TYPES: readonly NodeType[] = [
  'PROJECT', 'COST_CODE', 'COMMITMENT', 'AP_INVOICE', 'MATERIAL_RECEIPT', 'CHANGE_ORDER', 'SOV_ITEM',
  'EXCEPTION', 'TASK', 'AGENT',
];

/**
 * The chain a controller actually needs to see to answer "why can't this close": the project, what is
 * blocking it, who found it, who is on the hook for it, and any decision already made. Everything else —
 * invoices, receipts, cost codes — is the evidence *behind* those, one click away, not part of the picture.
 */
export const CLOSE_STORY_TYPES: readonly NodeType[] = [
  'PROJECT', 'EXCEPTION', 'TASK', 'AGENT', 'PERSON', 'REVIEW_DECISION',
];

/** Three hops: project → exception → task → the person on the hook. Two would stop at the task. */
export const CLOSE_STORY_DEPTH = 3;

/**
 * Shared across every project, so a project-centred walk shows them but never continues past them —
 * otherwise three hops through the Billing agent is every billing exception in the company. Employees,
 * divisions and the company are listed for completeness even though the UI cannot select them today.
 */
export const PORTFOLIO_HUBS: readonly NodeType[] = [
  'AGENT', 'PERSON', 'VENDOR', 'EMPLOYEE', 'DIVISION', 'COMPANY',
];

const LINK_LABEL: Record<LinkType, string> = {
  HAS_DIVISION: 'has division',
  HAS_PROJECT: 'has project',
  MANAGED_BY: 'managed by',
  HAS_COST_CODE: 'has cost code',
  BUDGETS: 'budgets',
  ISSUES: 'issued',
  BELONGS_TO: 'belongs to',
  CODED_TO: 'coded to',
  MODIFIES: 'modifies contract',
  FORECASTS: 'forecasts',
  PROGRESSES: 'progress on',
  WORKS_ON: 'works on',
  MATCHES: 'matched to PO',
  POSTS_AS: 'posted as',
  RECEIVED_AGAINST: 'received against',
  MAPS_TO: 'maps to SOV line',
  BILLS: 'billed on',
  RELATES_TO: 'relates to',
  CREATED: 'detected',
  ASSIGNED_TO: 'assigned to',
  RESOLVES: 'resolves',
  TRIGGERED_BY: 'triggered by',
};

/**
 * The relationship in the words a finance lead would use. "Evidence" is reserved for links the rule engine
 * actually cited — `RELATES_TO` produced by reconciliation — so the picture never claims a record was
 * looked at when it was only related.
 */
export function edgeLabel(type: LinkType, derivedBy: GraphLink['derivedBy']): string {
  if (type === 'RELATES_TO' && derivedBy === 'reconciliation') return 'evidence';
  return LINK_LABEL[type];
}
