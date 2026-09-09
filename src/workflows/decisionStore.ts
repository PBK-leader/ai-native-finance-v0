/**
 * The decision ledger's home.
 *
 * This is the only mutable state in the application, and it is append-only. Everything financial is
 * recomputed from it, so there is no cached EAC to invalidate and no way for one screen to show a stale
 * number while another shows a fresh one.
 *
 * V0 keeps it in memory rather than in a database, which is a deliberate scope decision. Two consequences
 * follow from that and are worth stating plainly:
 *
 * 1. Ledgers are keyed by session, not global. On a single laptop that distinction is invisible; on a shared
 *    link it is the difference between a demo and a mess, because one visitor accepting a $47k adjustment
 *    would otherwise rewrite the portfolio underneath everyone else, and the next arrival would open a
 *    half-answered close instead of the baseline the agents actually found.
 * 2. Memory is not durable. A server restart empties every ledger and the portfolio returns to that baseline.
 *    For a prototype that is acceptable — the ledger is a demonstration of the replay architecture, not a
 *    system of record — but it is the reason nothing here should ever be described as saved.
 *
 * The store is *injected* into `replay` rather than imported by it, so tests can pass a plain array.
 */

import type { ReviewDecision } from '@/domain/workflow';

export interface DecisionStore {
  all(): readonly ReviewDecision[];
  append(decision: ReviewDecision): void;
  reset(): void;
  /** Replace the whole ledger — used to load a demo in one step. */
  replaceAll(decisions: readonly ReviewDecision[]): void;
}

class InMemoryDecisionStore implements DecisionStore {
  private decisions: ReviewDecision[] = [];

  all(): readonly ReviewDecision[] {
    // A copy, not the live array. `readonly` is erased at runtime, so returning the internal reference would
    // let any caller push onto the append-only ledger out from under the engine.
    return [...this.decisions];
  }

  append(decision: ReviewDecision): void {
    this.decisions.push(decision);
  }

  reset(): void {
    this.decisions = [];
  }

  replaceAll(decisions: readonly ReviewDecision[]): void {
    this.decisions = [...decisions];
  }
}

/**
 * How many sessions to keep before discarding the least recently used.
 *
 * A bound rather than unlimited growth: the map lives for the life of the process and a public link has no
 * way to know a visitor has gone. Eviction is by use order, deliberately not by elapsed time — reading a
 * clock here would put a wall-clock dependency underneath the derived pipeline, which `replay` is required
 * to be free of. An evicted visitor sees the baseline again, which is the same thing a restart does.
 */
const MAX_SESSIONS = 200;

const KEY = Symbol.for('mep-finance-v0.decision-stores');

type GlobalWithStores = typeof globalThis & { [KEY]?: Map<string, DecisionStore> };

/** Pinned to `globalThis` so it survives Next's hot module reloading in development. */
function stores(): Map<string, DecisionStore> {
  const scope = globalThis as GlobalWithStores;
  if (!scope[KEY]) scope[KEY] = new Map<string, DecisionStore>();
  return scope[KEY];
}

/**
 * The ledger for one session.
 *
 * `sessionId` comes from a cookie the middleware assigns. It identifies a browser, not a user — this is
 * demo isolation, not authentication, and nothing is protected by it.
 */
export function decisionStore(sessionId: string): DecisionStore {
  const map = stores();
  const existing = map.get(sessionId);

  if (existing) {
    // Re-insert so recency is the map's own ordering; `Map` iterates in insertion order.
    map.delete(sessionId);
    map.set(sessionId, existing);
    return existing;
  }

  const created = new InMemoryDecisionStore();
  map.set(sessionId, created);

  while (map.size > MAX_SESSIONS) {
    const oldest = map.keys().next();
    if (oldest.done) break;
    map.delete(oldest.value);
  }

  return created;
}
