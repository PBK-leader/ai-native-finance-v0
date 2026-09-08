/**
 * The application's single entry point into the engine.
 *
 * Every screen calls `engineState()`. Because the whole derived picture is recomputed from the ledger on each
 * call, no screen can show a stale number, and there is nothing to invalidate when a decision is recorded.
 *
 * Recomputation is cheap enough to do per request at this data size — labour is pre-aggregated during
 * normalization, so a replay step touches a few hundred records rather than 22,593.
 */

import { V0_CONFIG } from '@/config/v0Config';
import { getNormalized } from '@/data/normalize/model';
import { buildReconciledView } from '@/reconciliation/buildReconciledView';
import { buildGraph } from '@/graph/build/buildGraph';
import { AGENTS } from '@/agents/agents';
import type { GraphIndex } from '@/graph/core';
import type { CanonicalModel } from '@/domain/entities';
import type { DecisionProjection } from '@/domain/workflow';
import { decisionStore } from './decisionStore';
import { replay, type EngineState } from './replay';

export function buildView(model: CanonicalModel, projection: DecisionProjection) {
  return buildReconciledView(model, getNormalized().reconciliationKeys, projection);
}

/** The current engine state, derived from the canonical model and the decision ledger. */
export function engineState(): EngineState {
  const { model } = getNormalized();
  return replay(model, buildView, V0_CONFIG, decisionStore().all());
}

/** The Client Operating Graph for the current state. */
export function currentGraph(state: EngineState): GraphIndex {
  const { model } = getNormalized();
  // The projection the engine actually used, not a fresh one built from every ledger entry — otherwise a
  // decision the engine refused would still be drawn as a relationship.
  const ignored = new Set(state.ignored.map((entry) => entry.decision.id));
  const applied = state.decisions.filter((decision) => !ignored.has(decision.id));

  return buildGraph(
    model,
    buildView(model, state.effectiveProjection),
    state.current,
    applied,
    AGENTS,
  );
}

export function canonical(): CanonicalModel {
  return getNormalized().model;
}
