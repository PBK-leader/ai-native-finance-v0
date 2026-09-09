/**
 * The lineage layout is pure geometry, so its invariants can be checked exactly: every node gets a place,
 * nothing overlaps, bundles collapse and expand as declared, and no canonical link is dropped or invented.
 *
 * The last block runs against the real graph, because that is where the "why can't this close" preset
 * silently lost exceptions once: a type filter cut the only path from a project to its AP findings.
 */

import { describe, expect, it } from 'vitest';
import { V0_CONFIG } from '@/config/v0Config';
import { getNormalized } from '@/data/normalize/model';
import { buildReconciledView } from '@/reconciliation/buildReconciledView';
import { buildGraph } from '@/graph/build/buildGraph';
import { neighbourhood } from '@/graph/core';
import { AGENTS } from '@/agents/agents';
import { replay, topBlockingException } from '@/workflows/replay';
import { demoCloseP1004 } from '@/workflows/demos';
import { projectId } from '@/domain/ids';
import type { CanonicalModel } from '@/domain/entities';
import type { DecisionProjection } from '@/domain/workflow';
import type { GraphLink, GraphNode, NodeType } from '@/domain/graph';
import {
  STAGES, autoExpandFor, groupKey, layoutLineage, stageOf,
} from '@/components/lineageLayout';
import {
  CLOSE_STORY_DEPTH, CLOSE_STORY_TYPES, DEFAULT_TYPES, PORTFOLIO_HUBS,
} from '@/components/graphVocabulary';

function node(id: string, type: NodeType, label = id): GraphNode {
  return { id, type, label, projectId: null, props: {}, sourceRefs: [] };
}

function link(type: GraphLink['type'], fromId: string, toId: string): GraphLink {
  return {
    id: `${type}:${fromId}:${toId}` as GraphLink['id'], type, fromId, toId, sourceRefs: [], derivedBy: 'master_data',
  };
}

describe('lineage layout on a synthetic graph', () => {
  const invoices = Array.from({ length: 8 }, (_, i) => node(`INV-${i}`, 'AP_INVOICE', `Invoice ${i}`));
  const nodes: GraphNode[] = [
    node('P-1', 'PROJECT', 'Project'),
    node('PO-1', 'COMMITMENT', 'PO'),
    node('AGENT', 'AGENT', 'Cost Control Agent'),
    node('EX-1', 'EXCEPTION', 'Duplicate invoice'),
    node('TASK-1', 'TASK', 'Fix it'),
    node('PERS-1', 'PERSON', 'Jamie'),
    ...invoices,
  ];
  const links: GraphLink[] = [
    ...invoices.map((inv) => link('MATCHES', inv.id, 'PO-1')),
    link('BELONGS_TO', 'PO-1', 'P-1'),
    link('CREATED', 'AGENT', 'EX-1'),
    link('RELATES_TO', 'EX-1', 'INV-0'),
    link('BELONGS_TO', 'EX-1', 'P-1'),
    link('RELATES_TO', 'TASK-1', 'EX-1'),
    link('ASSIGNED_TO', 'TASK-1', 'PERS-1'),
  ];

  it('places every node and keeps every column in stage order', () => {
    const layout = layoutLineage(nodes, links, { expanded: new Set() });
    for (const n of nodes) expect(layout.anchorFor(n.id), n.id).toBeDefined();

    const stageIndexes = layout.columns.map((c) => c.index);
    expect(stageIndexes).toEqual([...stageIndexes].sort((a, b) => a - b));
    // Nothing in the decisions stage, so it must not appear as an empty column.
    expect(layout.columns.some((c) => c.stage.key === 'decisions')).toBe(false);
    expect(layout.width).toBeGreaterThan(0);
    expect(layout.height).toBeGreaterThan(0);
  });

  it('never overlaps two items in the same column', () => {
    const layout = layoutLineage(nodes, links, { expanded: new Set() });
    const byColumn = new Map<number, typeof layout.items>();
    for (const item of layout.items) {
      const list = byColumn.get(item.x) ?? [];
      list.push(item);
      byColumn.set(item.x, list);
    }
    for (const items of byColumn.values()) {
      const sorted = [...items].sort((a, b) => a.y - b.y);
      for (let i = 1; i < sorted.length; i += 1) {
        expect(sorted[i]!.y).toBeGreaterThanOrEqual(sorted[i - 1]!.y + sorted[i - 1]!.h);
      }
    }
  });

  it('collapses a bundle above the threshold into one pill, and expands it on request', () => {
    const key = groupKey(stageOf('AP_INVOICE'), 'AP_INVOICE');

    const collapsed = layoutLineage(nodes, links, { expanded: new Set(), collapseAt: 5 });
    const pill = collapsed.items.find((i) => i.kind === 'pill');
    expect(pill?.id).toBe(key);
    expect(collapsed.items.filter((i) => i.kind === 'card' && i.node.type === 'AP_INVOICE')).toHaveLength(0);
    // Every invoice's edge attaches to the pill, and the eight MATCHES links collapse into one drawn edge.
    for (const inv of invoices) expect(collapsed.anchorFor(inv.id)?.id).toBe(key);
    const matches = collapsed.edges.filter((e) => e.type === 'MATCHES');
    expect(matches).toHaveLength(1);
    expect(matches[0]!.count).toBe(8);

    const expanded = layoutLineage(nodes, links, { expanded: new Set([key]), collapseAt: 5 });
    expect(expanded.items.filter((i) => i.kind === 'card' && i.node.type === 'AP_INVOICE')).toHaveLength(8);
    expect(expanded.edges.filter((e) => e.type === 'MATCHES')).toHaveLength(8);
  });

  it('draws exactly the canonical links — bundled, never invented, never dropped', () => {
    const layout = layoutLineage(nodes, links, { expanded: new Set() });
    const drawn = layout.edges.reduce((n, e) => n + e.count, 0);
    expect(drawn).toBe(links.length);
    for (const edge of layout.edges) {
      expect(stageIndexOfAnchor(edge.from.id, nodes)).toBeLessThanOrEqual(stageIndexOfAnchor(edge.to.id, nodes));
    }
  });

  it('auto-expands the focus bundle and small neighbouring bundles only', () => {
    const auto = autoExpandFor(nodes, links, 'EX-1', { maxAutoExpand: 5 });
    expect(auto.has(groupKey(stageOf('EXCEPTION'), 'EXCEPTION'))).toBe(true);
    expect(auto.has(groupKey(stageOf('PROJECT'), 'PROJECT'))).toBe(true);
    // Eight invoices exceed the auto-expand cap, so they stay a pill even though one is direct evidence.
    expect(auto.has(groupKey(stageOf('AP_INVOICE'), 'AP_INVOICE'))).toBe(false);
    expect(autoExpandFor(nodes, links, null).size).toBe(0);
  });

  it('gives every stage at least one type, and no type two stages', () => {
    // Exhaustiveness over `NodeType` is enforced by the compiler (`Record<NodeType, StageKey>`); this only
    // checks the derived stage lists are well-formed.
    const seen = new Set<NodeType>();
    for (const stage of STAGES) {
      expect(stage.types.length, stage.key).toBeGreaterThan(0);
      for (const type of stage.types) {
        expect(seen.has(type), type).toBe(false);
        seen.add(type);
      }
    }
  });

  it('leaves a link between two members of one collapsed bundle undrawn, and says so in the count', () => {
    // No canonical link type joins two nodes of the same type today, so the "bundled counts equal the links
    // passed in" invariant holds by data. If that ever changes, this pins the documented behaviour: such a
    // link has nowhere to be drawn and is excluded from `edges`.
    const twins = [node('PO-A', 'COMMITMENT'), node('PO-B', 'COMMITMENT'), ...invoices.slice(0, 6).map((i) => node(i.id, 'COMMITMENT'))];
    const inner = [link('RELATES_TO', 'PO-A', 'PO-B')];
    const layout = layoutLineage(twins, inner, { expanded: new Set(), collapseAt: 5 });
    expect(layout.items.filter((i) => i.kind === 'pill')).toHaveLength(1);
    expect(layout.edges).toHaveLength(0);
  });
});

function stageIndexOfAnchor(anchorId: string, nodes: GraphNode[]): number {
  const n = nodes.find((x) => x.id === anchorId);
  return n ? stageOf(n.type) : Number(anchorId.split(':')[0]);
}

describe('lineage layout on the real graph', () => {
  const { model, reconciliationKeys } = getNormalized();
  const buildView = (m: CanonicalModel, projection: DecisionProjection) =>
    buildReconciledView(m, reconciliationKeys, projection);
  const state = replay(model, buildView, V0_CONFIG, []);
  const graph = buildGraph(model, buildView(model, state.effectiveProjection), state.current, [], AGENTS);

  const PROJECTS = ['P-1001', 'P-1002', 'P-1003', 'P-1004', 'P-1005', 'P-1006'];

  it.each(PROJECTS)(
    '"why can\'t this close" reaches every blocking exception on %s',
    (pid) => {
      // Exactly what the button requests. Agents and people are terminal, or the walk would continue
      // through the agent into every other project.
      const view = neighbourhood(graph, pid, {
        depth: CLOSE_STORY_DEPTH, nodeTypes: CLOSE_STORY_TYPES, terminalTypes: PORTFOLIO_HUBS, maxNodes: 260,
      });
      const layout = layoutLineage(view.nodes, view.links, { expanded: new Set() });

      // Stays about this project: no exception from another project bleeds in through a shared agent.
      for (const n of view.nodes) {
        if (n.type === 'EXCEPTION') expect(n.projectId, n.label).toBe(pid);
      }

      const blocking = state.current.exceptions.filter(
        (e) => e.projectId === pid && e.blocking && e.currentlyTriggering,
      );
      for (const exception of blocking) {
        expect(layout.anchorFor(exception.id), `${exception.ruleId} on ${pid}`).toBeDefined();
        // And the owner of its task is in the picture too — that is the point of the view.
        const task = state.current.tasks.find((t) => t.exceptionId === exception.id);
        if (task?.ownerPersonId) {
          expect(layout.anchorFor(task.ownerPersonId), `owner of ${exception.ruleId}`).toBeDefined();
        }
      }

      const top = topBlockingException(state, projectId(pid));
      if (top) expect(layout.anchorFor(top.id)).toBeDefined();
    },
  );

  it('lays out the default view of every project without overlap or dangling edges', () => {
    for (const project of model.projects) {
      // Exactly what the page requests before any filter is chosen.
      const view = neighbourhood(graph, project.id, {
        depth: 2, nodeTypes: DEFAULT_TYPES, terminalTypes: PORTFOLIO_HUBS, maxNodes: 260,
      });
      const focus = topBlockingException(state, project.id)?.id ?? project.id;
      const expanded = autoExpandFor(view.nodes, view.links, focus);
      const layout = layoutLineage(view.nodes, view.links, { expanded });

      for (const n of view.nodes) expect(layout.anchorFor(n.id)).toBeDefined();
      // The default focus is always drawn as its own card, never lost inside a bundle or out of view.
      expect(layout.anchorFor(focus)?.kind, project.id).toBe('card');
      expect(layout.edges.reduce((n, e) => n + e.count, 0)).toBe(view.links.length);

      for (const item of layout.items) {
        expect(item.x + item.w).toBeLessThanOrEqual(layout.width);
        expect(item.y + item.h).toBeLessThanOrEqual(layout.height);
      }
    }
  });

  it('shows a human decision and its green edge once one has been recorded', () => {
    const after = replay(model, buildView, V0_CONFIG, demoCloseP1004);
    const applied = after.decisions.filter((d) => !after.ignored.some((i) => i.decision.id === d.id));
    const g = buildGraph(model, buildView(model, after.effectiveProjection), after.current, applied, AGENTS);
    const view = neighbourhood(g, 'P-1004', {
      depth: CLOSE_STORY_DEPTH, nodeTypes: CLOSE_STORY_TYPES, terminalTypes: PORTFOLIO_HUBS, maxNodes: 260,
    });
    const layout = layoutLineage(view.nodes, view.links, { expanded: new Set() });

    expect(layout.columns.some((c) => c.stage.key === 'decisions')).toBe(true);
    const decisions = view.nodes.filter((n) => n.type === 'REVIEW_DECISION');
    expect(decisions.length).toBeGreaterThan(0);
    for (const d of decisions) expect(layout.anchorFor(d.id)).toBeDefined();
    expect(layout.edges.some((e) => e.derivedBy === 'human_decision' && e.type === 'RESOLVES')).toBe(true);
  });
});
