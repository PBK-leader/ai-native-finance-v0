/**
 * Client Operating Graph explorer.
 *
 * Deliberately project-centred and depth-limited. Rendering the whole client graph would be a hairball; the
 * useful question is "what is connected to this project, and what does that chain prove".
 *
 * Every edge drawn here is the same `GraphLink` object the rule engine consumed. The explorer cannot invent a
 * relationship the maths does not also see.
 */

import { canonical, currentGraph, engineState } from '@/workflows/engine';
import { topBlockingException } from '@/workflows/replay';
import { projectId as toProjectId } from '@/domain/ids';
import type { NodeType } from '@/domain/graph';
import { linksFor, neighbourhood, otherEnd } from '@/graph/core';
import { Card, Empty } from '@/components/ui';
import { GraphExplorer } from '@/components/GraphExplorer';
import { currentSessionId } from '@/components/sessionServer';
import {
  CLOSE_STORY_TYPES, DEFAULT_TYPES, FILTERABLE, PORTFOLIO_HUBS, isNodeType,
} from '@/components/graphVocabulary';

export const dynamic = 'force-dynamic';

export default async function GraphPage({
  searchParams,
}: {
  searchParams: Promise<{ project?: string; depth?: string; types?: string; focus?: string }>;
}) {
  const params = await searchParams;
  const state = engineState(await currentSessionId());
  const model = canonical();
  const graph = currentGraph(state);

  const rootId = params.project ?? model.projects[0]!.id;
  // URL parameters are untrusted: a non-numeric depth would otherwise become NaN and an unknown type
  // would reach the walk unfiltered.
  const requestedDepth = Number(params.depth);
  const depth = Number.isFinite(requestedDepth) ? Math.min(Math.max(requestedDepth, 1), 4) : 2;
  const requestedTypes = (params.types ?? '')
    .split(',')
    .filter((t): t is NodeType => isNodeType(t) && FILTERABLE.includes(t));
  const types: NodeType[] = requestedTypes.length > 0 ? requestedTypes : [...DEFAULT_TYPES];

  const view = neighbourhood(graph, rootId, {
    depth, nodeTypes: types, terminalTypes: PORTFOLIO_HUBS, maxNodes: 260,
  });

  // A first-time visitor should never land on an empty "select a node" sidebar. Absent an explicit choice,
  // point at the costliest thing actually blocking this project's close — and fall back to the project
  // itself if there is nothing blocking, so the sidebar always has something real to say.
  const defaultFocusId = topBlockingException(state, toProjectId(rootId))?.id ?? rootId;
  const focusNode = graph.nodes.get(params.focus || defaultFocusId);
  // A focus reached from the full graph (search, the relationships list) may sit outside this project's
  // walk or behind a type filter; the explorer says so rather than drawing nothing highlighted.
  const focusInView = !focusNode || view.nodes.some((n) => n.id === focusNode.id);

  // Lightweight index for the search box — every node in the whole graph, not just this neighbourhood, so
  // searching can jump to a record on a project you are not currently looking at.
  const searchIndex = Array.from(graph.nodes.values()).map((n) => ({
    id: n.id,
    label: n.label,
    type: n.type,
    projectId: n.projectId,
  }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Client Operating Graph</h1>
        <p className="mt-1 max-w-3xl text-sm">
          <span className="font-medium">What this answers:</span>{' '}
          <span className="text-[var(--color-muted)]">
            How is this contractor actually put together — which invoice paid which purchase order, which
            change order belongs to which billing line — and where did every number come from?
          </span>
        </p>
        <p className="mt-2 text-sm text-[var(--color-muted)]">
          {graph.nodes.size.toLocaleString('en-US')} objects and{' '}
          {graph.links.length.toLocaleString('en-US')} relationships across {model.company.name}. Every link
          shown here is the same object the exception rules and the financial calculations use.
        </p>
      </div>

      {view.nodes.length === 0 ? (
        <Empty>Nothing to show for this selection.</Empty>
      ) : (
        <GraphExplorer
          projects={model.projects.map((p) => ({ id: p.id, name: p.name }))}
          rootId={rootId}
          depth={depth}
          selectedTypes={types}
          closeStoryTypes={[...CLOSE_STORY_TYPES]}
          searchIndex={searchIndex}
          nodes={view.nodes}
          links={view.links}
          truncated={view.truncated}
          focusNode={focusNode ?? null}
          focusInView={focusInView}
          focusLinks={
            focusNode
              ? linksFor(graph, focusNode.id).flatMap((l) => {
                  const otherId = otherEnd(l, focusNode.id);
                  const other = graph.nodes.get(otherId);
                  if (!other) return [];
                  return [{
                    ...l,
                    otherId,
                    otherLabel: other.label,
                    otherType: other.type,
                    otherProjectId: other.projectId,
                    direction: l.fromId === focusNode.id ? ('out' as const) : ('in' as const),
                  }];
                })
              : []
          }
        />
      )}

      <Card title="How to read this" subtitle="The graph is operating context, not decoration">
        <ul className="space-y-1.5 text-sm text-[var(--color-muted)]">
          <li>
            <strong className="text-[var(--color-ink)]">Read it left to right.</strong> Raw records from the
            accounting, project and timekeeping systems on the left; the project structure they reconcile to;
            the agent that inspected them; what it flagged; the task it opened; the person on the hook; and
            finally what that person decided. A number&apos;s whole provenance is one horizontal chain.
          </li>
          <li>
            <strong className="text-[var(--color-ink)]">Dashed lines were matched by reconciliation</strong> —
            invoice to purchase order, receipt to purchase order, change order to schedule-of-values line.
            The same links drive remaining-commitment maths, duplicate detection and the received-not-invoiced
            calculation; the picture cannot show a match the numbers did not use.
          </li>
          <li>
            <strong className="text-[var(--color-ink)]">Green lines were created by a human decision.</strong>{' '}
            When an accountant records a missing schedule-of-values line, a new link appears here attributed to
            that decision, and the billing analysis downstream changes with it.
          </li>
          <li>
            <strong className="text-[var(--color-ink)]">Bundles</strong> (&quot;14 AP invoice records&quot;) hold
            same-type records that are not part of the current chain. Open one to see every record; hover any
            card to light up exactly what it touches.
          </li>
        </ul>
      </Card>
    </div>
  );
}
