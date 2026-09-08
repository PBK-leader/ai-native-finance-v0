/**
 * Client Operating Graph type declarations.
 *
 * Declared here at layer 3, not in `src/graph/core`, because `ReconciledView.links` and
 * `DecisionProjection.linkOverlay` both name `GraphLink` — declaring it above `src/domain` created a
 * dependency cycle. A type is inert data; naming one creates no runtime dependency. Behaviour is what
 * layering orders, so the adjacency index and traversal live in `src/graph/core` and assembly lives in
 * `src/graph/build`.
 *
 * The graph is operating context, not decoration. Six of these link types are produced by the reconciliation
 * layer and consumed by both the rule engine and the graph explorer, so there is one representation of every
 * reconciled relationship rather than one for the maths and another for the picture.
 */

import type { SourceRef } from './entities';
import type { GraphLinkId } from './ids';

export type NodeType =
  | 'COMPANY' | 'DIVISION' | 'PROJECT' | 'PERSON' | 'EMPLOYEE' | 'VENDOR'
  | 'COST_CODE' | 'BUDGET_LINE' | 'COMMITMENT' | 'MATERIAL_RECEIPT' | 'AP_INVOICE'
  | 'JOB_COST_TXN' | 'LABOR_AGGREGATE' | 'PROGRESS_SNAPSHOT' | 'FORECAST_SNAPSHOT'
  | 'CHANGE_ORDER' | 'SOV_ITEM' | 'BILLING'
  | 'EXCEPTION' | 'TASK' | 'REVIEW_DECISION' | 'AGENT' | 'AGENT_ACTION'
  | 'UNMAPPED_SOURCE';

export type LinkType =
  // Master data / containment
  | 'HAS_DIVISION' | 'HAS_PROJECT' | 'MANAGED_BY' | 'HAS_COST_CODE' | 'BUDGETS'
  | 'ISSUES' | 'BELONGS_TO' | 'CODED_TO' | 'MODIFIES' | 'FORECASTS' | 'PROGRESSES' | 'WORKS_ON'
  // Reconciliation-derived (and, for MAPS_TO, human-created)
  | 'MATCHES' | 'POSTS_AS' | 'RECEIVED_AGAINST' | 'MAPS_TO' | 'BILLS'
  // Workflow
  | 'RELATES_TO' | 'CREATED' | 'ASSIGNED_TO' | 'RESOLVES' | 'TRIGGERED_BY';

/** Which layer created a link. Distinct from `SourceRef.method`, which says how a key was matched. */
export type LinkOrigin = 'master_data' | 'reconciliation' | 'human_decision';

export type GraphNode = {
  id: string;
  type: NodeType;
  label: string;
  /** Null for nodes that are not project-scoped, such as the company or an unmapped source record. */
  projectId: string | null;
  props: Record<string, string | number | boolean | null>;
  sourceRefs: SourceRef[];
};

export type GraphLink = {
  /** Always `<linkType>:<fromId>:<toId>` — a pure function of the edge, never a counter or decision id. */
  id: GraphLinkId;
  type: LinkType;
  fromId: string;
  toId: string;
  sourceRefs: SourceRef[];
  derivedBy: LinkOrigin;
};

/**
 * Master-data links (`ISSUES`, `MANAGED_BY`, `WORKS_ON`) are **projected from** the whitelisted entity field
 * and never independently reconciled, so the field and the link cannot diverge. Only the reconciliation links
 * (`MATCHES`, `POSTS_AS`, `RECEIVED_AGAINST`, `MAPS_TO`, `BILLS`) are derived by matching.
 */
export const RECONCILED_LINK_TYPES: readonly LinkType[] = [
  'MATCHES', 'POSTS_AS', 'RECEIVED_AGAINST', 'MAPS_TO', 'BILLS',
];
