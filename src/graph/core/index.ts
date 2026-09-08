/**
 * Graph indexing and traversal.
 *
 * Generic: this module knows about nodes and edges, not about invoices. The types themselves live in
 * `src/domain/graph.ts` so that lower layers can name them without importing this one.
 *
 * Deliberately not a graph database. Adjacency is two `Map`s built once, and the only traversal the product
 * needs is a bounded breadth-first walk out from a project node. `CLIENT_OPERATING_GRAPH.md` is explicit that
 * V0 must not render the whole client graph at once, so depth-limited neighbourhoods are the requirement, not
 * a simplification.
 */

import type { GraphLink, GraphNode, LinkType, NodeType } from '@/domain/graph';

export type GraphIndex = {
  nodes: ReadonlyMap<string, GraphNode>;
  /** Links where the node is the `from` end. */
  outgoing: ReadonlyMap<string, readonly GraphLink[]>;
  /** Links where the node is the `to` end. */
  incoming: ReadonlyMap<string, readonly GraphLink[]>;
  links: readonly GraphLink[];
};

export function buildGraphIndex(nodes: readonly GraphNode[], links: readonly GraphLink[]): GraphIndex {
  const nodeMap = new Map<string, GraphNode>();
  for (const node of nodes) nodeMap.set(node.id, node);

  const outgoing = new Map<string, GraphLink[]>();
  const incoming = new Map<string, GraphLink[]>();

  for (const link of links) {
    const out = outgoing.get(link.fromId);
    if (out) out.push(link);
    else outgoing.set(link.fromId, [link]);

    const inc = incoming.get(link.toId);
    if (inc) inc.push(link);
    else incoming.set(link.toId, [link]);
  }

  return { nodes: nodeMap, outgoing, incoming, links };
}

/** Every link touching a node, in either direction. */
export function linksFor(index: GraphIndex, nodeId: string): GraphLink[] {
  return [...(index.outgoing.get(nodeId) ?? []), ...(index.incoming.get(nodeId) ?? [])];
}

/** The node at the other end of a link from `nodeId`. */
export function otherEnd(link: GraphLink, nodeId: string): string {
  return link.fromId === nodeId ? link.toId : link.fromId;
}

export type NeighbourhoodOptions = {
  depth: number;
  /** Restrict to these node types. Empty or absent means all types. */
  nodeTypes?: readonly NodeType[];
  /** Restrict to these link types. Empty or absent means all types. */
  linkTypes?: readonly LinkType[];
  /** Safety valve so a dense hub cannot produce an unreadable picture. */
  maxNodes?: number;
};

export type Neighbourhood = {
  nodes: GraphNode[];
  links: GraphLink[];
  /** How many hops from the root each node sits, for layout and for explaining the picture. */
  depthByNode: Map<string, number>;
  /** True when `maxNodes` cut the walk short, so the UI can say so rather than silently under-reporting. */
  truncated: boolean;
};

/**
 * Breadth-first walk out from a root node.
 *
 * Filtering happens during the walk, not after: a filtered-out node must not act as a bridge to nodes beyond
 * it, or the picture would imply relationships the canonical link set does not support.
 */
export function neighbourhood(
  index: GraphIndex,
  rootId: string,
  options: NeighbourhoodOptions,
): Neighbourhood {
  const { depth, nodeTypes, linkTypes, maxNodes = 400 } = options;

  const root = index.nodes.get(rootId);
  if (!root) return { nodes: [], links: [], depthByNode: new Map(), truncated: false };

  const allowNode = (node: GraphNode): boolean =>
    !nodeTypes || nodeTypes.length === 0 || nodeTypes.includes(node.type);
  const allowLink = (link: GraphLink): boolean =>
    !linkTypes || linkTypes.length === 0 || linkTypes.includes(link.type);

  const depthByNode = new Map<string, number>([[rootId, 0]]);
  const included = new Map<string, GraphNode>([[rootId, root]]);
  const collectedLinks = new Map<string, GraphLink>();
  let truncated = false;

  let frontier: string[] = [rootId];

  for (let d = 0; d < depth; d += 1) {
    const next: string[] = [];

    for (const nodeId of frontier) {
      for (const link of linksFor(index, nodeId)) {
        if (!allowLink(link)) continue;

        const neighbourId = otherEnd(link, nodeId);
        const neighbour = index.nodes.get(neighbourId);
        if (!neighbour || !allowNode(neighbour)) continue;

        if (!included.has(neighbourId)) {
          if (included.size >= maxNodes) {
            truncated = true;
            continue;
          }
          included.set(neighbourId, neighbour);
          depthByNode.set(neighbourId, d + 1);
          next.push(neighbourId);
        }
        collectedLinks.set(link.id, link);
      }
    }

    if (next.length === 0) break;
    frontier = next;
  }

  // Keep only links whose both ends survived filtering, so nothing implies an unsupported relationship.
  const links = [...collectedLinks.values()].filter(
    (l) => included.has(l.fromId) && included.has(l.toId),
  );

  return { nodes: [...included.values()], links, depthByNode, truncated };
}
