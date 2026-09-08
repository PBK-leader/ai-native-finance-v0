/**
 * The decision ledger's home.
 *
 * This is the only mutable state in the application, and it is append-only. Everything financial is
 * recomputed from it, so there is no cached EAC to invalidate and no way for one screen to show a stale
 * number while another shows a fresh one.
 *
 * V0 keeps it in memory rather than in a database, which is a deliberate scope decision — but it is pinned to
 * `globalThis` so it survives Next's hot module reloading in development. Without that, editing any file
 * mid-demo would silently wipe the ledger and every task would spring back open.
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

const KEY = Symbol.for('mep-finance-v0.decision-store');

type GlobalWithStore = typeof globalThis & { [KEY]?: DecisionStore };

/** The process-wide store. Survives HMR because it hangs off `globalThis`. */
export function decisionStore(): DecisionStore {
  const scope = globalThis as GlobalWithStore;
  if (!scope[KEY]) scope[KEY] = new InMemoryDecisionStore();
  return scope[KEY];
}
