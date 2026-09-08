/**
 * Convenience wiring for building a reconciled view over the cached canonical model.
 *
 * Lives in `src/workflows` rather than `src/calculations` because its job is composition, not arithmetic:
 * it reaches into normalization and reconciliation, which the calculation layer is deliberately not granted.
 * Keeping it here is what lets the layering test forbid `src/calculations` from building its own index.
 *
 * `buildReconciledView` needs the raw counterparty keys that normalization extracted, and every caller would
 * otherwise have to thread them through by hand. Nothing here computes anything financial.
 */

import { getNormalized } from '@/data/normalize/model';
import { buildReconciledView as build } from '@/reconciliation/buildReconciledView';
import type { CanonicalModel } from '@/domain/entities';
import type { ReconciledView } from '@/domain/reconciliation';
import type { DecisionProjection } from '@/domain/workflow';

/** Build a reconciled view over the cached model for a given decision projection. */
export function reconciledViewFor(projection: DecisionProjection): ReconciledView {
  const { model, reconciliationKeys } = getNormalized();
  return build(model, reconciliationKeys, projection);
}

/** The frozen canonical model. */
export function canonicalModel(): CanonicalModel {
  return getNormalized().model;
}
