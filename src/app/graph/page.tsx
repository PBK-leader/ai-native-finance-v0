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
import type { NodeType } from '@/domain/graph';
import { neighbourhood } from '@/graph/core';
import { Card, Empty } from '@/components/ui';
import { GraphExplorer } from '@/components/GraphExplorer';

export const dynamic = 'force-dynamic';

const DEFAULT_TYPES: NodeType[] = [
  'PROJECT', 'COST_CODE', 'COMMITMENT', 'AP_INVOICE', 'MATERIAL_RECEIPT', 'CHANGE_ORDER', 'SOV_ITEM',
  'EXCEPTION', 'TASK',
];

export default async function GraphPage({
  searchParams,
}: {
  searchParams: Promise<{ project?: string; depth?: string; types?: string; focus?: string }>;
}) {
  const params = await searchParams;
  const state = engineState();
  const model = canonical();
  const graph = currentGraph(state);

  const rootId = params.project ?? model.projects[0]!.id;
  const depth = Math.min(Math.max(Number(params.depth ?? 2), 1), 4);
  const types = params.types ? (params.types.split(',') as NodeType[]) : DEFAULT_TYPES;

  const view = neighbourhood(graph, rootId, { depth, nodeTypes: types, maxNodes: 260 });
  const focusNode = params.focus ? graph.nodes.get(params.focus) : undefined;

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
          nodes={view.nodes}
          links={view.links}
          depthByNode={Object.fromEntries(view.depthByNode)}
          truncated={view.truncated}
          focusNode={focusNode ?? null}
          focusLinks={
            focusNode
              ? graph.links
                  .filter((l) => l.fromId === focusNode.id || l.toId === focusNode.id)
                  .map((l) => ({
                    ...l,
                    otherLabel:
                      graph.nodes.get(l.fromId === focusNode.id ? l.toId : l.fromId)?.label ?? '',
                    otherId: l.fromId === focusNode.id ? l.toId : l.fromId,
                    direction: l.fromId === focusNode.id ? ('out' as const) : ('in' as const),
                  }))
              : []
          }
        />
      )}

      <Card title="How to read this" subtitle="The graph is operating context, not decoration">
        <ul className="space-y-1.5 text-sm text-[var(--color-muted)]">
          <li>
            <strong className="text-[var(--color-ink)]">MATCHES</strong>, {' '}
            <strong className="text-[var(--color-ink)]">POSTS_AS</strong> and{' '}
            <strong className="text-[var(--color-ink)]">RECEIVED_AGAINST</strong> are produced by the
            reconciliation layer. The same links drive remaining-commitment maths, duplicate detection and the
            received-not-invoiced calculation.
          </li>
          <li>
            <strong className="text-[var(--color-ink)]">MAPS_TO</strong> connects an approved change order to
            its schedule-of-values line. When an accountant records a missing line, a new one appears here
            marked as created by a human decision.
          </li>
          <li>
            <strong className="text-[var(--color-ink)]">RELATES_TO</strong> links an exception to every record
            it cited as evidence — so &quot;show me the proof&quot; and &quot;show me the subgraph&quot; are the same
            operation.
          </li>
        </ul>
      </Card>
    </div>
  );
}
