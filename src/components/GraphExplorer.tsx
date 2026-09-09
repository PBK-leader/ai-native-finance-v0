'use client';

/**
 * The Client Operating Graph, drawn as lineage.
 *
 * Columns run left to right in the order the money moves: source records → the project structure they
 * reconcile to → the agent that looked → what it flagged → the task → the owner → the decision. Same-type
 * nodes are bundled, and a bundle bigger than a handful is one pill until you open it. Hover or select
 * anything and the chain it belongs to lights up while the rest fades.
 *
 * Cards are HTML so the text is real text; only the edges are SVG. Both sit in one transformed wrapper so
 * zoom and pan move them together. Filtering only changes what is drawn — it never touches domain state.
 */

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { GraphLink, GraphNode, NodeType } from '@/domain/graph';
import { measure } from './format';
import { CLOSE_STORY_DEPTH, FILTERABLE, TYPE_COLOR, edgeLabel, typeLabel } from './graphVocabulary';
import {
  CARD_W, COLUMN_HEADER_H, DEFAULT_COLLAPSE_AT, autoExpandFor, layoutLineage, type LaidEdge,
} from './lineageLayout';

const MIN_SCALE = 0.3;
const MAX_SCALE = 3;

type FocusLink = GraphLink & {
  otherId: string; otherLabel: string; otherType: NodeType; otherProjectId: string | null; direction: 'in' | 'out';
};
type SearchEntry = { id: string; label: string; type: NodeType; projectId: string | null };
type Camera = { scale: number; tx: number; ty: number };

export function GraphExplorer({
  projects, rootId, depth, selectedTypes, closeStoryTypes, searchIndex, nodes, links, truncated,
  focusNode, focusInView, focusLinks,
}: {
  projects: { id: string; name: string }[];
  rootId: string;
  depth: number;
  selectedTypes: NodeType[];
  /** The curated type set for "why can't this close" — passed from the page so the story stays in one place. */
  closeStoryTypes: NodeType[];
  searchIndex: SearchEntry[];
  nodes: GraphNode[];
  links: GraphLink[];
  truncated: boolean;
  focusNode: GraphNode | null;
  /** False when the focus exists in the graph but sits outside this walk or behind the type filter. */
  focusInView: boolean;
  focusLinks: FocusLink[];
}) {
  const router = useRouter();
  const search = useSearchParams();
  const [hovered, setHovered] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [camera, setCamera] = useState<Camera>({ scale: 1, tx: 0, ty: 0 });

  const containerRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  const suppressClickRef = useRef(false);

  const typesKey = selectedTypes.join(',');
  const focusId = focusNode?.id ?? null;

  // --- Which bundles are open --------------------------------------------------------------------------------
  // Reset to "the focus and what it touches" whenever the picture or the focus changes, adjusted during render
  // so the first paint of a new view is already right rather than flashing collapsed then opening.
  const viewKey = `${rootId}|${depth}|${typesKey}|${focusId}`;
  const [expandedFor, setExpandedFor] = useState(viewKey);
  const [expanded, setExpanded] = useState<Set<string>>(() => autoExpandFor(nodes, links, focusId));
  if (expandedFor !== viewKey) {
    setExpandedFor(viewKey);
    setExpanded(autoExpandFor(nodes, links, focusId));
    // The card under the pointer may be about to unmount (a bundle re-collapsing), and React fires no
    // `mouseleave` for an element that disappears — a dead hover id would dim the whole picture.
    setHovered(null);
  }

  const layout = useMemo(() => layoutLineage(nodes, links, { expanded }), [nodes, links, expanded]);

  const toggleGroup = (key: string) => {
    // Same reason as above: the pill being clicked is about to be replaced by cards.
    setHovered(null);
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };
  const allGroupKeys = useMemo(
    () => new Set(layout.items.map((i) => i.groupKey)),
    [layout],
  );

  // --- Camera ---------------------------------------------------------------------------------------------------
  const fit = () => {
    const el = containerRef.current;
    if (!el || layout.width === 0) return;
    const cw = el.clientWidth;
    const ch = el.clientHeight;
    // A hidden or not-yet-laid-out container measures 0×0; fitting to that would produce a negative scale.
    if (cw < 48 || ch < 48) return;
    const scale = Math.min(1, (cw - 24) / layout.width, (ch - 24) / layout.height);
    setCamera({
      scale,
      tx: (cw - layout.width * scale) / 2,
      ty: Math.max(12, (ch - layout.height * scale) / 2),
    });
  };
  const fitRef = useRef(fit);
  fitRef.current = fit;

  // A new project, depth or filter set is a new picture: start it fitted. Opening a bundle is not — keep the
  // reader's zoom where they put it.
  useLayoutEffect(() => {
    fitRef.current();
  }, [rootId, depth, typesKey]);

  // The container can be 0×0 at first paint (a hidden tab, a collapsed pane) and can change size later
  // (window resize). Refit whenever its box changes, so the picture is never stuck at a stale scale.
  useEffect(() => {
    const el = containerRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => fitRef.current());
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // A new focus is a new subject: if its card is off-screen — a search result, or a bundle that opened
  // above it and pushed it down — pan to it at the current zoom. Opening bundles by hand does not pan.
  const layoutRef = useRef(layout);
  layoutRef.current = layout;
  useLayoutEffect(() => {
    const el = containerRef.current;
    const anchor = focusId ? layoutRef.current.anchorFor(focusId) : undefined;
    if (!el || !anchor) return;
    setCamera((cam) => {
      const cx = anchor.x + anchor.w / 2;
      const cy = anchor.y + anchor.h / 2;
      const sx = cx * cam.scale + cam.tx;
      const sy = cy * cam.scale + cam.ty;
      const margin = 40;
      const inside =
        sx > margin && sx < el.clientWidth - margin && sy > margin && sy < el.clientHeight - margin;
      if (inside) return cam;
      return { ...cam, tx: el.clientWidth / 2 - cx * cam.scale, ty: el.clientHeight / 2 - cy * cam.scale };
    });
  }, [focusId, rootId]);

  const zoomAt = (clientX: number, clientY: number, factor: number) => {
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const px = clientX - rect.left;
    const py = clientY - rect.top;
    setCamera((cam) => {
      const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, cam.scale * factor));
      const worldX = (px - cam.tx) / cam.scale;
      const worldY = (py - cam.ty) / cam.scale;
      return { scale, tx: px - worldX * scale, ty: py - worldY * scale };
    });
  };
  const zoomAtRef = useRef(zoomAt);
  zoomAtRef.current = zoomAt;

  // React attaches `onWheel` as a passive listener, so `preventDefault()` in a JSX handler is silently
  // ignored and the page scrolls as well as zooming. A native, non-passive listener is the only fix.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onNativeWheel = (e: WheelEvent) => {
      e.preventDefault();
      zoomAtRef.current(e.clientX, e.clientY, e.deltaY > 0 ? 0.88 : 1 / 0.88);
    };
    el.addEventListener('wheel', onNativeWheel, { passive: false });
    return () => el.removeEventListener('wheel', onNativeWheel);
  }, []);

  const zoomAtCentre = (factor: number) => {
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    zoomAt(rect.left + rect.width / 2, rect.top + rect.height / 2, factor);
  };

  const onCanvasMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    dragRef.current = { x: e.clientX, y: e.clientY, moved: false };
  };
  const onCanvasMouseMove = (e: React.MouseEvent) => {
    const drag = dragRef.current;
    if (!drag) return;
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    if (Math.abs(dx) > 2 || Math.abs(dy) > 2) drag.moved = true;
    if (!drag.moved) return;
    setCamera((cam) => ({ ...cam, tx: cam.tx + dx, ty: cam.ty + dy }));
    dragRef.current = { x: e.clientX, y: e.clientY, moved: true };
  };
  const endDrag = () => {
    // `mouseup` finishes before the `click` for the same gesture is dispatched, so the flag has to outlive
    // `dragRef`; the timeout clears it right after that click so nothing later is swallowed.
    if (dragRef.current?.moved) {
      suppressClickRef.current = true;
      setTimeout(() => {
        suppressClickRef.current = false;
      }, 0);
    }
    dragRef.current = null;
  };

  // --- Navigation -----------------------------------------------------------------------------------------------
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

  // Jump to a node from anywhere in the graph: switch project if it lives on another one, and switch its
  // type on if the filter would otherwise hide it. Depth can still leave it out of reach — the page says so.
  const goToNode = (entry: { id: string; projectId: string | null; type: NodeType }) => {
    setQuery('');
    const patch: Record<string, string> = { focus: entry.id };
    if (entry.projectId && entry.projectId !== rootId) patch.project = entry.projectId;
    if (!selectedTypes.includes(entry.type)) patch.types = [...selectedTypes, entry.type].join(',');
    update(patch);
  };

  const selectNode = (id: string) => {
    if (suppressClickRef.current) return;
    update({ focus: id });
  };

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q.length < 2) return [];
    return searchIndex.filter((n) => n.label.toLowerCase().includes(q)).slice(0, 8);
  }, [query, searchIndex]);

  // --- Highlighting ---------------------------------------------------------------------------------------------
  // Only an id that is actually drawn may drive the highlight; anything else would dim everything.
  const drawnIds = useMemo(() => new Set(layout.items.map((i) => i.id)), [layout]);
  const hoveredDrawn = hovered !== null && drawnIds.has(hovered) ? hovered : null;
  const activeId = hoveredDrawn ?? (focusId ? layout.anchorFor(focusId)?.id ?? null : null);
  const connected = useMemo(() => {
    const set = new Set<string>();
    if (!activeId) return set;
    set.add(activeId);
    for (const edge of layout.edges) {
      if (edge.from.id === activeId) set.add(edge.to.id);
      else if (edge.to.id === activeId) set.add(edge.from.id);
    }
    return set;
  }, [activeId, layout]);
  const edgeIsActive = (edge: LaidEdge) =>
    activeId !== null && (edge.from.id === activeId || edge.to.id === activeId);

  return (
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

        <div className="relative">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && matches[0]) goToNode(matches[0]);
              if (e.key === 'Escape') setQuery('');
            }}
            placeholder="Find a record — amount, name, change order…"
            className="w-64 rounded border border-[var(--color-line)] px-2 py-1 text-xs"
          />
          {query.trim().length >= 2 && (
            <ul className="absolute z-20 mt-1 w-96 max-w-[24rem] rounded border border-[var(--color-line)] bg-[var(--color-surface)] shadow-lg">
              {matches.length === 0 && (
                <li className="px-2.5 py-1.5 text-xs text-[var(--color-muted)]">
                  No matches for &quot;{query.trim()}&quot;
                </li>
              )}
              {matches.map((m) => (
                <li key={m.id}>
                  <button
                    type="button"
                    onClick={() => goToNode(m)}
                    className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-xs hover:bg-[var(--color-canvas)]"
                  >
                    <span
                      className="shrink-0 rounded px-1.5 py-0.5 text-[10px] text-white"
                      style={{ backgroundColor: TYPE_COLOR[m.type] }}
                    >
                      {typeLabel(m.type)}
                    </span>
                    <span className="truncate">{m.label}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <span className="text-xs text-[var(--color-muted)]">
          {nodes.length} objects · {links.length} relationships
          {truncated && ' · view truncated'}
        </span>

        <div className="ml-auto flex gap-2">
          <button
            type="button"
            onClick={() =>
              update({ types: closeStoryTypes.join(','), depth: String(CLOSE_STORY_DEPTH), focus: '' })
            }
            className="rounded bg-[var(--color-accent)] px-2.5 py-1 text-xs font-medium text-white transition hover:brightness-110"
          >
            Why can&apos;t this close?
          </button>
          <button
            type="button"
            onClick={() => update({ types: '', depth: '', focus: '' })}
            className="rounded border border-[var(--color-line)] px-2.5 py-1 text-xs text-[var(--color-muted)] transition hover:bg-[var(--color-canvas)]"
            title="Back to the default set of record types at two hops"
          >
            Reset view
          </button>
        </div>
      </div>

      {focusNode && !focusInView && (
        <p className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-[var(--color-medium)]">
          <strong>{focusNode.label}</strong> is in the graph but not in this picture — it is more than {depth}{' '}
          hop{depth > 1 ? 's' : ''} from {projects.find((p) => p.id === rootId)?.name ?? 'this project'}. Its
          details are below; widen the depth to draw it.
        </p>
      )}

      <div className="flex flex-wrap gap-1.5">
        {FILTERABLE.map((type) => {
          const active = selectedTypes.includes(type);
          return (
            <button
              key={type}
              type="button"
              onClick={() => toggleType(type)}
              className={`rounded border px-2 py-0.5 text-[11px] transition ${
                active ? 'border-transparent text-white' : 'border-[var(--color-line)] text-[var(--color-muted)]'
              }`}
              style={active ? { backgroundColor: TYPE_COLOR[type] } : undefined}
            >
              {typeLabel(type)}
            </button>
          );
        })}
      </div>

      <div
        ref={containerRef}
        className="relative h-[36rem] overflow-hidden rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] cursor-grab active:cursor-grabbing select-none"
        onMouseDown={onCanvasMouseDown}
        onMouseMove={onCanvasMouseMove}
        onMouseUp={endDrag}
        onMouseLeave={endDrag}
      >
        <div
          className="absolute left-0 top-0"
          style={{
            width: layout.width,
            height: layout.height,
            transform: `translate(${camera.tx}px, ${camera.ty}px) scale(${camera.scale})`,
            transformOrigin: '0 0',
          }}
        >
          <svg
            width={layout.width}
            height={layout.height}
            className="pointer-events-none absolute left-0 top-0"
            aria-hidden="true"
          >
            {layout.edges.map((edge) => {
              const active = edgeIsActive(edge);
              const dimmed = activeId !== null && !active;
              const human = edge.derivedBy === 'human_decision';
              return (
                <path
                  key={edge.id}
                  d={edgePath(edge)}
                  fill="none"
                  stroke={human ? '#15803d' : active ? '#1d4ed8' : '#cbd5e1'}
                  strokeWidth={active || human ? 1.8 : Math.min(2.4, 0.8 + edge.count * 0.15)}
                  strokeDasharray={edge.derivedBy === 'reconciliation' ? '4 3' : undefined}
                  opacity={dimmed ? 0.12 : 1}
                />
              );
            })}
            {layout.edges.filter(edgeIsActive).map((edge) => {
              const [mx, my] = edgeMidpoint(edge);
              return (
                <text
                  key={`${edge.id}:label`}
                  x={mx}
                  y={my - 3}
                  textAnchor="middle"
                  style={{
                    fontSize: 9.5, fill: '#1d4ed8', paintOrder: 'stroke', stroke: '#ffffff', strokeWidth: 3,
                    strokeLinejoin: 'round',
                  }}
                >
                  {edgeLabel(edge.type, edge.derivedBy)}{edge.count > 1 ? ` ×${edge.count}` : ''}
                </text>
              );
            })}
          </svg>

          {layout.columns.map((column) => (
            <div
              key={column.stage.key}
              className="absolute"
              style={{ left: column.x, top: 20, width: CARD_W, height: COLUMN_HEADER_H }}
            >
              <div className="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-ink)]">
                {column.stage.title}
              </div>
              <div className="text-[10px] text-[var(--color-muted)]">
                {column.stage.hint} · {column.count}
              </div>
            </div>
          ))}

          {layout.items.map((item) => {
            if (item.kind === 'header') {
              const open = expanded.has(item.groupKey);
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    if (suppressClickRef.current) return;
                    toggleGroup(item.groupKey);
                  }}
                  className="absolute flex items-center gap-1 text-left text-[10px] font-medium uppercase tracking-wide text-[var(--color-muted)] hover:text-[var(--color-ink)]"
                  style={{ left: item.x, top: item.y, width: item.w, height: item.h }}
                  title={open && item.count > DEFAULT_COLLAPSE_AT ? 'Collapse' : undefined}
                >
                  <span
                    className="inline-block h-2 w-2 shrink-0 rounded-sm"
                    style={{ backgroundColor: TYPE_COLOR[item.type] }}
                  />
                  <span className="truncate">{typeLabel(item.type)} · {item.count}</span>
                  {item.count > DEFAULT_COLLAPSE_AT && <span className="ml-auto pr-1">▾</span>}
                </button>
              );
            }

            const isActive = connected.has(item.id);
            const dimmed = activeId !== null && !isActive;

            if (item.kind === 'pill') {
              return (
                <button
                  key={item.id}
                  type="button"
                  onMouseEnter={() => setHovered(item.id)}
                  onMouseLeave={() => setHovered(null)}
                  onClick={() => {
                    if (suppressClickRef.current) return;
                    toggleGroup(item.groupKey);
                  }}
                  className="absolute flex items-center gap-2 rounded-full border border-dashed border-[var(--color-line)] bg-[var(--color-canvas)] px-2.5 text-left text-[11px] transition hover:border-[var(--color-muted)]"
                  style={{ left: item.x, top: item.y, width: item.w, height: item.h, opacity: dimmed ? 0.4 : 1 }}
                  title={`${item.members.length} ${typeLabel(item.type).toLowerCase()} records — click to expand`}
                >
                  <span
                    className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: TYPE_COLOR[item.type] }}
                  />
                  <span className="truncate">
                    <span className="font-semibold tabular">{item.members.length}</span>{' '}
                    {typeLabel(item.type).toLowerCase()} records
                  </span>
                  <span className="ml-auto text-[var(--color-muted)]">▸</span>
                </button>
              );
            }

            const isFocus = item.node.id === focusId;
            const isRoot = item.node.id === rootId;
            return (
              <button
                key={item.id}
                type="button"
                onMouseEnter={() => setHovered(item.id)}
                onMouseLeave={() => setHovered(null)}
                onClick={() => selectNode(item.node.id)}
                title={item.node.label}
                className={`absolute flex items-center gap-2 rounded border bg-[var(--color-surface)] px-2 text-left text-[11px] leading-tight transition hover:shadow-md ${
                  isFocus
                    ? 'border-[var(--color-accent)] ring-2 ring-[var(--color-accent)]/30'
                    : 'border-[var(--color-line)]'
                } ${isRoot ? 'font-semibold' : ''}`}
                style={{
                  left: item.x, top: item.y, width: item.w, height: item.h,
                  borderLeftWidth: 3,
                  borderLeftColor: TYPE_COLOR[item.node.type],
                  opacity: dimmed ? 0.4 : 1,
                }}
              >
                <span className="truncate">{item.node.label}</span>
              </button>
            );
          })}
        </div>

        <div className="absolute bottom-3 right-3 flex flex-col gap-1">
          <button
            type="button"
            onClick={() => zoomAtCentre(1.3)}
            aria-label="Zoom in"
            className="h-7 w-7 rounded border border-[var(--color-line)] bg-[var(--color-surface)] text-sm shadow-sm hover:bg-[var(--color-canvas)]"
          >
            +
          </button>
          <button
            type="button"
            onClick={() => zoomAtCentre(1 / 1.3)}
            aria-label="Zoom out"
            className="h-7 w-7 rounded border border-[var(--color-line)] bg-[var(--color-surface)] text-sm shadow-sm hover:bg-[var(--color-canvas)]"
          >
            −
          </button>
          <button
            type="button"
            onClick={fit}
            aria-label="Fit to view"
            className="h-7 w-7 rounded border border-[var(--color-line)] bg-[var(--color-surface)] text-[10px] shadow-sm hover:bg-[var(--color-canvas)]"
          >
            Fit
          </button>
        </div>

        <div className="absolute bottom-3 left-3 flex flex-wrap items-center gap-x-4 gap-y-1 rounded bg-[var(--color-surface)]/90 px-2 py-1 text-[10px] text-[var(--color-muted)]">
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-0 w-5 border-t border-dashed border-[var(--color-muted)]" /> matched by reconciliation
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-0 w-5 border-t-2 border-[var(--color-ok)]" /> created by a human decision
          </span>
          <span>hover to trace · click to inspect · drag to pan · scroll to zoom</span>
          <button
            type="button"
            onClick={() => setExpanded(new Set(allGroupKeys))}
            className="underline-offset-2 hover:underline"
          >
            expand all
          </button>
          <button
            type="button"
            onClick={() => setExpanded(new Set())}
            className="underline-offset-2 hover:underline"
          >
            collapse all
          </button>
        </div>
      </div>

      <section className="rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] p-4">
        {!focusNode ? (
          <p className="text-sm text-[var(--color-muted)]">
            Select a card to inspect its properties, its source records, and everything it connects to.
          </p>
        ) : (
          <div className="grid gap-6 lg:grid-cols-3">
            <div className="space-y-3">
              <div>
                <span
                  className="rounded px-1.5 py-0.5 text-[11px] text-white"
                  style={{ backgroundColor: TYPE_COLOR[focusNode.type] }}
                >
                  {typeLabel(focusNode.type)}
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
            </div>

            <div>
              <h4 className="text-xs font-medium text-[var(--color-muted)]">
                Source records ({focusNode.sourceRefs.length})
              </h4>
              {focusNode.sourceRefs.length === 0 ? (
                <p className="mt-1 text-[11px] text-[var(--color-muted)]">
                  Derived by the application — no raw source row of its own.
                </p>
              ) : (
                <ul className="mt-1 max-h-56 space-y-1 overflow-y-auto text-[11px]">
                  {focusNode.sourceRefs.slice(0, 25).map((ref, i) => (
                    <li key={`${ref.recordId}-${i}`}>
                      <span className="rounded bg-[var(--color-canvas)] px-1 font-medium">{ref.recordId}</span>{' '}
                      <span className="text-[var(--color-muted)]">{ref.file}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div>
              <h4 className="text-xs font-medium text-[var(--color-muted)]">
                Relationships ({focusLinks.length})
              </h4>
              <ul className="mt-1 max-h-56 space-y-1 overflow-y-auto text-[11px]">
                {focusLinks.slice(0, 40).map((link) => (
                  <li key={link.id}>
                    <button
                      type="button"
                      onClick={() =>
                        goToNode({ id: link.otherId, projectId: link.otherProjectId, type: link.otherType })
                      }
                      className="text-left hover:underline"
                    >
                      <span className="font-medium">
                        {link.direction === 'out' ? '→' : '←'} {edgeLabel(link.type, link.derivedBy)}
                      </span>{' '}
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
      </section>
    </div>
  );
}

function edgePath(edge: LaidEdge): string {
  const y1 = edge.from.y + edge.from.h / 2;
  const y2 = edge.to.y + edge.to.h / 2;
  if (edge.sameColumn) {
    // Two things in the same column: bow out to the right of the column rather than crossing the cards.
    const x = edge.from.x + edge.from.w;
    const bow = x + 22;
    return `M${x},${y1} C${bow},${y1} ${bow},${y2} ${x},${y2}`;
  }
  const x1 = edge.from.x + edge.from.w;
  const x2 = edge.to.x;
  const mx = (x1 + x2) / 2;
  return `M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`;
}

/** The point at t = 0.5 on the same cubic `edgePath` draws — where its label sits. */
function edgeMidpoint(edge: LaidEdge): [number, number] {
  const y1 = edge.from.y + edge.from.h / 2;
  const y2 = edge.to.y + edge.to.h / 2;
  if (edge.sameColumn) {
    const x = edge.from.x + edge.from.w;
    return [x + 22 * 0.75, (y1 + y2) / 2];
  }
  const x1 = edge.from.x + edge.from.w;
  const x2 = edge.to.x;
  return [(x1 + x2) / 2, (y1 + y2) / 2];
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
