/**
 * The bounded walk that every graph screen depends on.
 *
 * Two properties matter beyond "depth-limited": a portfolio hub (an agent, a person) must be shown but never
 * walked *through*, or one project's view becomes the whole company; and a link between two nodes that are
 * both on screen must be drawn even if neither end was ever expanded — omission is a quieter lie than
 * invention.
 */

import { describe, expect, it } from 'vitest';
import { buildGraphIndex, neighbourhood } from '@/graph/core';
import type { GraphLink, GraphNode, NodeType } from '@/domain/graph';

function node(id: string, type: NodeType, projectId: string | null = null): GraphNode {
  return { id, type, label: id, projectId, props: {}, sourceRefs: [] };
}

function link(type: GraphLink['type'], fromId: string, toId: string): GraphLink {
  return {
    id: `${type}:${fromId}:${toId}` as GraphLink['id'], type, fromId, toId, sourceRefs: [], derivedBy: 'master_data',
  };
}

// P-1 has one exception found by an agent that also found an exception on P-2. The task for P-1's
// exception is assigned to the PM who manages P-1.
const index = buildGraphIndex(
  [
    node('P-1', 'PROJECT', 'P-1'),
    node('P-2', 'PROJECT', 'P-2'),
    node('EX-1', 'EXCEPTION', 'P-1'),
    node('EX-2', 'EXCEPTION', 'P-2'),
    node('AGENT', 'AGENT'),
    node('TASK-1', 'TASK', 'P-1'),
    node('PM', 'PERSON'),
  ],
  [
    link('BELONGS_TO', 'EX-1', 'P-1'),
    link('BELONGS_TO', 'EX-2', 'P-2'),
    link('CREATED', 'AGENT', 'EX-1'),
    link('CREATED', 'AGENT', 'EX-2'),
    link('RELATES_TO', 'TASK-1', 'EX-1'),
    link('MANAGED_BY', 'P-1', 'PM'),
    link('ASSIGNED_TO', 'TASK-1', 'PM'),
  ],
);

const ids = (nodes: GraphNode[]) => nodes.map((n) => n.id).sort();

describe('neighbourhood with terminal hub types', () => {
  it('shows a hub but never walks through it', () => {
    const view = neighbourhood(index, 'P-1', { depth: 3, terminalTypes: ['AGENT', 'PERSON'] });
    expect(ids(view.nodes)).toEqual(['AGENT', 'EX-1', 'P-1', 'PM', 'TASK-1']);
    // Without the terminal rule, three hops reaches the other project's exception through the agent.
    const leaky = neighbourhood(index, 'P-1', { depth: 3 });
    expect(ids(leaky.nodes)).toContain('EX-2');
  });

  it('still walks out from a root that is itself a hub type', () => {
    const view = neighbourhood(index, 'AGENT', { depth: 1, terminalTypes: ['AGENT'] });
    expect(ids(view.nodes)).toEqual(['AGENT', 'EX-1', 'EX-2']);
  });

  it('draws the link between two shown nodes even when neither end was expanded', () => {
    // PM is terminal and TASK-1 is at the last hop: neither expands, yet both are on screen and the
    // ASSIGNED_TO link between them is canonical. The closing pass must collect it.
    const view = neighbourhood(index, 'P-1', { depth: 2, terminalTypes: ['AGENT', 'PERSON'] });
    expect(ids(view.nodes)).toContain('TASK-1');
    expect(ids(view.nodes)).toContain('PM');
    expect(view.links.map((l) => l.id)).toContain('ASSIGNED_TO:TASK-1:PM');
  });

  it('never returns a link with an end outside the view', () => {
    const view = neighbourhood(index, 'P-1', { depth: 2, terminalTypes: ['AGENT', 'PERSON'] });
    const inView = new Set(view.nodes.map((n) => n.id));
    for (const l of view.links) {
      expect(inView.has(l.fromId) && inView.has(l.toId), l.id).toBe(true);
    }
    // Specifically: the agent is shown, but its edge to the other project's exception is not.
    expect(view.links.map((l) => l.id)).not.toContain('CREATED:AGENT:EX-2');
  });

  it('respects the link-type filter in the closing pass too', () => {
    const view = neighbourhood(index, 'P-1', {
      depth: 2, terminalTypes: ['AGENT', 'PERSON'], linkTypes: ['BELONGS_TO', 'RELATES_TO', 'MANAGED_BY'],
    });
    expect(view.links.map((l) => l.id)).not.toContain('ASSIGNED_TO:TASK-1:PM');
  });
});
