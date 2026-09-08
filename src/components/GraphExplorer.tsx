'use client';

/**
 * Project-centred subgraph rendering.
 *
 * A radial layout by hop distance: the project at the centre, its immediate structure in the first ring,
 * evidence records further out. Laid out deterministically from node ids so the picture does not reshuffle
 * on every render — a graph that moves when you click it is unreadable.
 *
 * Filtering only changes what is drawn. It never touches domain state.
 */

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useMemo, useState } from 'react';
import type { GraphLink, GraphNode, NodeType } from '@/domain/graph';
import { measure } from './format';

const TYPE_COLOR: Record<string, string> = {
  PROJECT: '#1d4ed8',
  COST_CODE: '#0f766e',
  COMMITMENT: '#7c3aed',
  AP_INVOICE: '#b45309',
  MATERIAL_RECEIPT: '#a16207',
  JOB_COST_TXN: '#475569',
  CHANGE_ORDER: '#be185d',
  SOV_ITEM: '#0369a1',
  BILLING: '#0891b2',
  EXCEPTION: '#b91c1c',
  TASK: '#c2410c',
  REVIEW_DECISION: '#15803d',
  LABOR_AGGREGATE: '#4d7c0f',
  FORECAST_SNAPSHOT: '#6d28d9',
  PROGRESS_SNAPSHOT: '#7e22ce',
  VENDOR: '#334155',
  PERSON: '#334155',
  AGENT: '#0f172a',
  UNMAPPED_SOURCE: '#dc2626',
};

const FILTERABLE: NodeType[] = [
  'PROJECT', 'COST_CODE', 'COMMITMENT', 'AP_INVOICE', 'MATERIAL_RECEIPT', 'JOB_COST_TXN',
  'LABOR_AGGREGATE', 'CHANGE_ORDER', 'SOV_ITEM', 'BILLING', 'FORECAST_SNAPSHOT', 'PROGRESS_SNAPSHOT',
  'EXCEPTION', 'TASK', 'REVIEW_DECISION', 'VENDOR', 'PERSON',
];

type FocusLink = GraphLink & { otherLabel: string; otherId: string; direction: 'in' | 'out' };

export function GraphExplorer({
  projects, rootId, depth, selectedTypes, nodes, links, depthByNode, truncated, focusNode, focusLinks,
}: {
  projects: { id: string; name: string }[];
  rootId: string;
  depth: number;
  selectedTypes: NodeType[];
  nodes: GraphNode[];
  links: GraphLink[];
  depthByNode: Record<string, number>;
  truncated: boolean;
  focusNode: GraphNode | null;
  focusLinks: FocusLink[];
}) {
  const router = useRouter();
  const search = useSearchParams();
  const [hovered, setHovered] = useState<string | null>(null);

  const positions = useMemo(() => layout(nodes, depthByNode, rootId), [nodes, depthByNode, rootId]);

  const update = (patch: Record<string, string>) => {
    const next = new URLSearchParams(search.toString());
    for (const [key, value] of Object.entries(patch)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    router.push(`/graph?${next.toString()}`);
  };

  const toggleType = (type: NodeType) => {
    const next = selectedTypes.includes(type)
      ? selectedTypes.filter((t) => t !== type)
      : [...selectedTypes, type];
    update({ types: next.join(','), focus: '' });
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] px-4 py-3">
          <label className="flex items-center gap-2 text-xs">
            <span className="text-[var(--color-muted)]">Project</span>
            <select
              value={rootId}
              onChange={(e) => update({ project: e.target.value, focus: '' })}
              className="rounded border border-[var(--color-line)] px-2 py-1 text-xs"
            >
              {projects.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </label>

          <label className="flex items-center gap-2 text-xs">
            <span className="text-[var(--color-muted)]">Depth</span>
            <select
              value={depth}
              onChange={(e) => update({ depth: e.target.value, focus: '' })}
              className="rounded border border-[var(--color-line)] px-2 py-1 text-xs"
            >
              {[1, 2, 3, 4].map((d) => (
                <option key={d} value={d}>{d} hop{d > 1 ? 's' : ''}</option>
              ))}
            </select>
          </label>

          <span className="text-xs text-[var(--color-muted)]">
            {nodes.length} objects · {links.length} relationships
            {truncated && ' · view truncated'}
          </span>
        </div>

        <div className="flex flex-wrap gap-1.5">
          {FILTERABLE.map((type) => {
            const active = selectedTypes.includes(type);
            return (
              <button
                key={type}
                type="button"
                onClick={() => toggleType(type)}
                className={`rounded border px-2 py-0.5 text-[11px] transition ${
                  active
                    ? 'border-transparent text-white'
                    : 'border-[var(--color-line)] text-[var(--color-muted)]'
                }`}
                style={active ? { backgroundColor: TYPE_COLOR[type] ?? '#334155' } : undefined}
              >
                {type.replaceAll('_', ' ').toLowerCase()}
              </button>
            );
          })}
        </div>

        <div className="overflow-hidden rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)]">
          <svg viewBox="0 0 900 700" className="h-[34rem] w-full">
            <g>
              {links.map((link) => {
                const from = positions[link.fromId];
                const to = positions[link.toId];
                if (!from || !to) return null;
                const active = hovered === link.fromId || hovered === link.toId;
                return (
                  <line
                    key={link.id}
                    x1={from.x} y1={from.y} x2={to.x} y2={to.y}
                    stroke={link.derivedBy === 'human_decision' ? '#15803d' : active ? '#1d4ed8' : '#cbd5e1'}
                    strokeWidth={active || link.derivedBy === 'human_decision' ? 1.8 : 0.7}
                    strokeDasharray={link.derivedBy === 'reconciliation' ? '4 3' : undefined}
                  />
                );
              })}
            </g>

            <g>
              {nodes.map((node) => {
                const position = positions[node.id];
                if (!position) return null;
                const isRoot = node.id === rootId;
                const radius = isRoot ? 13 : node.type === 'EXCEPTION' || node.type === 'TASK' ? 7 : 5.5;

                return (
                  <g
                    key={node.id}
                    transform={`translate(${position.x},${position.y})`}
                    onMouseEnter={() => setHovered(node.id)}
                    onMouseLeave={() => setHovered(null)}
                    onClick={() => update({ focus: node.id })}
                    className="cursor-pointer"
                  >
                    <circle
                      r={radius}
                      fill={TYPE_COLOR[node.type] ?? '#64748b'}
                      opacity={hovered === null || hovered === node.id ? 1 : 0.45}
                      stroke={focusNode?.id === node.id ? '#0f172a' : 'white'}
                      strokeWidth={focusNode?.id === node.id ? 2.5 : 1}
                    />
                    {(isRoot || hovered === node.id || node.type === 'EXCEPTION') && (
                      <text
                        y={-radius - 5}
                        textAnchor="middle"
                        className="pointer-events-none"
                        style={{ fontSize: isRoot ? 12 : 9, fontWeight: isRoot ? 600 : 400, fill: '#0f172a' }}
                      >
                        {node.label.length > 34 ? `${node.label.slice(0, 33)}…` : node.label}
                      </text>
                    )}
                  </g>
                );
              })}
            </g>
          </svg>
        </div>

        <p className="text-xs text-[var(--color-muted)]">
          Dashed edges were derived by reconciliation. Green edges were created by a human decision. Click any
          node for its properties and source records.
        </p>
      </div>

      <aside className="rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] p-4">
        {!focusNode ? (
          <p className="text-sm text-[var(--color-muted)]">
            Select a node to inspect its properties, its source records, and everything it connects to.
          </p>
        ) : (
          <div className="space-y-4">
            <div>
              <span
                className="rounded px-1.5 py-0.5 text-[11px] text-white"
                style={{ backgroundColor: TYPE_COLOR[focusNode.type] ?? '#334155' }}
              >
                {focusNode.type.replaceAll('_', ' ').toLowerCase()}
              </span>
              <h3 className="mt-2 text-sm font-semibold">{focusNode.label}</h3>
              <code className="text-[11px] text-[var(--color-muted)]">{focusNode.id}</code>
            </div>

            {focusNode.projectId && (
              <Link
                href={`/projects/${focusNode.projectId}`}
                className="block text-xs font-medium text-[var(--color-accent)] hover:underline"
              >
                Open project →
              </Link>
            )}

            {Object.keys(focusNode.props).length > 0 && (
              <div>
                <h4 className="text-xs font-medium text-[var(--color-muted)]">Properties</h4>
                <dl className="mt-1 space-y-1">
                  {Object.entries(focusNode.props).map(([key, value]) => (
                    <div key={key} className="flex justify-between gap-3 text-xs">
                      <dt className="text-[var(--color-muted)]">{key}</dt>
                      <dd className="tabular text-right">{renderValue(key, value)}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            )}

            {focusNode.sourceRefs.length > 0 && (
              <div>
                <h4 className="text-xs font-medium text-[var(--color-muted)]">
                  Source records ({focusNode.sourceRefs.length})
                </h4>
                <ul className="mt-1 max-h-40 space-y-1 overflow-y-auto text-[11px]">
                  {focusNode.sourceRefs.slice(0, 25).map((ref, i) => (
                    <li key={`${ref.recordId}-${i}`}>
                      <span className="rounded bg-[var(--color-canvas)] px-1 font-medium">{ref.recordId}</span>{' '}
                      <span className="text-[var(--color-muted)]">{ref.file}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div>
              <h4 className="text-xs font-medium text-[var(--color-muted)]">
                Relationships ({focusLinks.length})
              </h4>
              <ul className="mt-1 max-h-56 space-y-1 overflow-y-auto text-[11px]">
                {focusLinks.slice(0, 40).map((link) => (
                  <li key={link.id}>
                    <button
                      type="button"
                      onClick={() => update({ focus: link.otherId })}
                      className="text-left hover:underline"
                    >
                      <span className="font-medium">{link.direction === 'out' ? '→' : '←'} {link.type}</span>{' '}
                      <span className="text-[var(--color-muted)]">{link.otherLabel}</span>
                      {link.derivedBy === 'human_decision' && (
                        <span className="ml-1 text-[var(--color-ok)]">(human)</span>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}
      </aside>
    </div>
  );
}

function renderValue(key: string, value: string | number | boolean | null): string {
  if (value === null) return '—';
  if (typeof value === 'boolean') return value ? 'yes' : 'no';
  if (typeof value === 'number') {
    if (/cost|value|amount|budget|eac|contract|committed|billed|impact|retainage/i.test(key)) {
      return measure(value, 'USD');
    }
    if (/pct|margin|progress/i.test(key)) return measure(value, 'PCT');
    return value.toLocaleString('en-US');
  }
  return value.length > 60 ? `${value.slice(0, 59)}…` : value;
}

/**
 * Deterministic radial layout: ring by hop distance, angle from a hash of the node id.
 *
 * Hashing rather than indexing means a node keeps its position when filters change, so the picture stays
 * recognisable as you explore.
 */
function layout(
  nodes: GraphNode[],
  depthByNode: Record<string, number>,
  rootId: string,
): Record<string, { x: number; y: number }> {
  const centre = { x: 450, y: 350 };
  const byDepth = new Map<number, GraphNode[]>();

  for (const node of nodes) {
    const d = depthByNode[node.id] ?? 3;
    const list = byDepth.get(d);
    if (list) list.push(node);
    else byDepth.set(d, [node]);
  }

  const positions: Record<string, { x: number; y: number }> = { [rootId]: centre };

  for (const [d, ring] of byDepth) {
    if (d === 0) continue;
    const radius = 90 + d * 95;
    const sorted = [...ring].sort((a, b) => (a.id < b.id ? -1 : 1));

    sorted.forEach((node, index) => {
      // Even spacing with a per-ring offset, so rings do not line up into spokes.
      const angle = (index / sorted.length) * Math.PI * 2 + d * 0.7;
      positions[node.id] = {
        x: centre.x + Math.cos(angle) * radius,
        y: centre.y + Math.sin(angle) * radius * 0.72,
      };
    });
  }

  return positions;
}
