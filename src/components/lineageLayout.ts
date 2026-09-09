/**
 * Lineage layout for the Client Operating Graph.
 *
 * Nodes are placed in columns in the order the money moves — source records, the project structure they
 * reconcile to, the agent that looked, what it flagged, the task, the owner, the decision — so the picture
 * reads left to right like a sentence rather than as a cloud. Within a column, nodes of one type are
 * bundled; a bundle larger than `collapseAt` is drawn as a single pill until it is expanded, which is what
 * keeps a project with forty job-cost rows from becoming forty dots.
 *
 * Pure geometry over already-computed graph objects. No financial arithmetic lives here.
 */

import type { GraphLink, GraphNode, NodeType } from '@/domain/graph';

export type StageKey = 'sources' | 'structure' | 'agents' | 'exceptions' | 'tasks' | 'owners' | 'decisions';
export type Stage = { key: StageKey; title: string; hint: string; types: NodeType[] };

const STAGE_DEFS: readonly { key: StageKey; title: string; hint: string }[] = [
  { key: 'sources', title: 'Source records', hint: 'What the systems say' },
  { key: 'structure', title: 'Project structure', hint: 'What they reconcile to' },
  { key: 'agents', title: 'Agents', hint: 'Who looked' },
  { key: 'exceptions', title: 'Exceptions', hint: 'What was flagged' },
  { key: 'tasks', title: 'Tasks', hint: 'What needs a human' },
  { key: 'owners', title: 'Owners', hint: 'Who is on the hook' },
  { key: 'decisions', title: 'Decisions', hint: 'What humans decided' },
];

/**
 * Every node type's column. A `Record<NodeType, …>` so a new type cannot compile without being placed;
 * within a column, types are drawn in this declaration order.
 */
const STAGE_OF_TYPE: Record<NodeType, StageKey> = {
  AP_INVOICE: 'sources',
  MATERIAL_RECEIPT: 'sources',
  JOB_COST_TXN: 'sources',
  LABOR_AGGREGATE: 'sources',
  PROGRESS_SNAPSHOT: 'sources',
  FORECAST_SNAPSHOT: 'sources',
  BILLING: 'sources',
  VENDOR: 'sources',
  EMPLOYEE: 'sources',
  BUDGET_LINE: 'sources',
  UNMAPPED_SOURCE: 'sources',
  PROJECT: 'structure',
  COST_CODE: 'structure',
  COMMITMENT: 'structure',
  CHANGE_ORDER: 'structure',
  SOV_ITEM: 'structure',
  DIVISION: 'structure',
  COMPANY: 'structure',
  AGENT: 'agents',
  EXCEPTION: 'exceptions',
  TASK: 'tasks',
  PERSON: 'owners',
  REVIEW_DECISION: 'decisions',
  AGENT_ACTION: 'decisions',
};

export const STAGES: readonly Stage[] = STAGE_DEFS.map((def) => ({
  ...def,
  types: (Object.keys(STAGE_OF_TYPE) as NodeType[]).filter((type) => STAGE_OF_TYPE[type] === def.key),
}));

const STAGE_INDEX: Record<StageKey, number> = Object.fromEntries(
  STAGE_DEFS.map((def, index) => [def.key, index]),
) as Record<StageKey, number>;

export function stageOf(type: NodeType): number {
  return STAGE_INDEX[STAGE_OF_TYPE[type]];
}

/** Bundles bigger than this start collapsed. The explorer's "▾" affordance keys off the same number. */
export const DEFAULT_COLLAPSE_AT = 5;

export const CARD_W = 168;
export const CARD_H = 26;
export const PILL_H = 28;
export const GROUP_HEADER_H = 18;
export const COLUMN_HEADER_H = 44;
const GAP = 4;
const GROUP_GAP = 12;
const GUTTER = 56;
const PAD = 20;

export type Anchor = { id: string; stage: number; x: number; y: number; w: number; h: number };

export type PlacedCard = Anchor & { kind: 'card'; node: GraphNode; groupKey: string };
export type PlacedPill = Anchor & { kind: 'pill'; type: NodeType; groupKey: string; members: GraphNode[] };
export type PlacedGroupHeader = Anchor & { kind: 'header'; type: NodeType; groupKey: string; count: number };
export type PlacedItem = PlacedCard | PlacedPill | PlacedGroupHeader;
export type EdgeAnchor = PlacedCard | PlacedPill;

export type LaidColumn = { stage: Stage; index: number; x: number; count: number };

export type LaidEdge = {
  id: string;
  type: GraphLink['type'];
  derivedBy: GraphLink['derivedBy'];
  from: EdgeAnchor;
  to: EdgeAnchor;
  /** How many canonical links this drawn edge stands for — several invoices into one collapsed pill. */
  count: number;
  sameColumn: boolean;
};

export type LineageLayout = {
  columns: LaidColumn[];
  items: PlacedItem[];
  edges: LaidEdge[];
  width: number;
  height: number;
  /** Where an edge touching this node should attach: its own card, or the pill its bundle collapsed into. */
  anchorFor: (nodeId: string) => EdgeAnchor | undefined;
  groupKeyFor: (nodeId: string) => string | undefined;
  groupSize: (groupKey: string) => number;
};

export function groupKey(stage: number, type: NodeType): string {
  return `${stage}:${type}`;
}

export function layoutLineage(
  nodes: readonly GraphNode[],
  links: readonly GraphLink[],
  options: { expanded: ReadonlySet<string>; collapseAt?: number },
): LineageLayout {
  const collapseAt = options.collapseAt ?? DEFAULT_COLLAPSE_AT;

  // --- Bundle by stage, then by type in the stage's declared order ----------------------------------------
  const byStage = new Map<number, Map<NodeType, GraphNode[]>>();
  for (const node of nodes) {
    const stage = stageOf(node.type);
    let groups = byStage.get(stage);
    if (!groups) {
      groups = new Map();
      byStage.set(stage, groups);
    }
    const list = groups.get(node.type);
    if (list) list.push(node);
    else groups.set(node.type, [node]);
  }

  const present = STAGES.map((stage, index) => ({ stage, index }))
    .filter(({ index }) => byStage.has(index));

  const columns: LaidColumn[] = [];
  const items: PlacedItem[] = [];
  const anchorByNode = new Map<string, EdgeAnchor>();
  const groupByNode = new Map<string, string>();
  const sizeByGroup = new Map<string, number>();

  // First pass: lay each column out from y = 0 so the tallest column is known before centring the others.
  const columnItems: PlacedItem[][] = [];
  const columnHeights: number[] = [];

  present.forEach(({ stage, index }, col) => {
    const x = PAD + col * (CARD_W + GUTTER);
    const groups = byStage.get(index)!;
    const placed: PlacedItem[] = [];
    let y = 0;
    let count = 0;

    for (const type of stage.types) {
      const members = groups.get(type);
      if (!members || members.length === 0) continue;
      const key = groupKey(index, type);
      const sorted = [...members].sort((a, b) => (a.label < b.label ? -1 : a.label > b.label ? 1 : 0));
      sizeByGroup.set(key, sorted.length);
      count += sorted.length;
      for (const node of sorted) groupByNode.set(node.id, key);

      if (y > 0) y += GROUP_GAP;

      const collapsed = sorted.length > collapseAt && !options.expanded.has(key);
      if (collapsed) {
        const pill: PlacedPill = {
          kind: 'pill', id: key, type, stage: index, groupKey: key, members: sorted,
          x, y, w: CARD_W, h: PILL_H,
        };
        placed.push(pill);
        for (const node of sorted) anchorByNode.set(node.id, pill);
        y += PILL_H;
        continue;
      }

      placed.push({
        kind: 'header', id: `${key}:header`, type, stage: index, groupKey: key, count: sorted.length,
        x, y, w: CARD_W, h: GROUP_HEADER_H,
      });
      y += GROUP_HEADER_H + GAP;

      sorted.forEach((node, i) => {
        const card: PlacedCard = {
          kind: 'card', id: node.id, node, stage: index, groupKey: key, x, y, w: CARD_W, h: CARD_H,
        };
        placed.push(card);
        anchorByNode.set(node.id, card);
        y += CARD_H + (i < sorted.length - 1 ? GAP : 0);
      });
    }

    columns.push({ stage, index, x, count });
    columnItems.push(placed);
    columnHeights.push(y);
  });

  const tallest = Math.max(0, ...columnHeights);

  // Second pass: centre each column vertically under the column headers.
  columnItems.forEach((placed, col) => {
    const offset = COLUMN_HEADER_H + PAD + (tallest - columnHeights[col]!) / 2;
    for (const item of placed) {
      item.y += offset;
      items.push(item);
    }
  });

  // --- Edges: one drawn edge per (left anchor, right anchor, link type), counting what it bundles ----------
  // A link between two members of the same collapsed bundle has nowhere to be drawn (both ends are the
  // pill) and is left out of `edges`; no canonical link type joins two nodes of one type today, and the
  // synthetic test pins that this is the documented behaviour rather than an accident.
  const edgeMap = new Map<string, LaidEdge>();
  for (const link of links) {
    const a = anchorByNode.get(link.fromId);
    const b = anchorByNode.get(link.toId);
    if (!a || !b || a.id === b.id) continue;

    // Always drawn left to right; for two anchors in the same column, top to bottom.
    const leftFirst = a.stage !== b.stage ? a.stage < b.stage : a.y <= b.y;
    const from = leftFirst ? a : b;
    const to = leftFirst ? b : a;

    const key = `${from.id}|${to.id}|${link.type}|${link.derivedBy}`;
    const existing = edgeMap.get(key);
    if (existing) {
      existing.count += 1;
    } else {
      edgeMap.set(key, {
        id: key, type: link.type, derivedBy: link.derivedBy, from, to, count: 1,
        sameColumn: a.stage === b.stage,
      });
    }
  }

  const ncols = columns.length;
  const width = ncols === 0 ? 0 : PAD * 2 + ncols * CARD_W + (ncols - 1) * GUTTER;
  const height = ncols === 0 ? 0 : COLUMN_HEADER_H + PAD * 2 + tallest;

  return {
    columns,
    items,
    edges: [...edgeMap.values()],
    width,
    height,
    anchorFor: (id) => anchorByNode.get(id),
    groupKeyFor: (id) => groupByNode.get(id),
    groupSize: (key) => sizeByGroup.get(key) ?? 0,
  };
}

/**
 * Which bundles should start out open so the focused node and what it directly touches are readable
 * without a click. Large neighbouring bundles stay collapsed — expanding forty job-cost rows to show one
 * connection would bury the connection.
 */
export function autoExpandFor(
  nodes: readonly GraphNode[],
  links: readonly GraphLink[],
  focusId: string | null,
  options: { collapseAt?: number; maxAutoExpand?: number } = {},
): Set<string> {
  const expanded = new Set<string>();
  if (!focusId) return expanded;
  const maxAuto = options.maxAutoExpand ?? 20;

  const byId = new Map(nodes.map((n) => [n.id, n]));
  const sizeOf = new Map<string, number>();
  for (const node of nodes) {
    const key = groupKey(stageOf(node.type), node.type);
    sizeOf.set(key, (sizeOf.get(key) ?? 0) + 1);
  }
  const keyOf = (id: string) => {
    const node = byId.get(id);
    return node ? groupKey(stageOf(node.type), node.type) : null;
  };

  const focusKey = keyOf(focusId);
  if (focusKey) expanded.add(focusKey);

  for (const link of links) {
    const other = link.fromId === focusId ? link.toId : link.toId === focusId ? link.fromId : null;
    if (!other) continue;
    const key = keyOf(other);
    if (key && (sizeOf.get(key) ?? 0) <= maxAuto) expanded.add(key);
  }
  return expanded;
}
