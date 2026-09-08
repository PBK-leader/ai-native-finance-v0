/**
 * The cached, frozen canonical model.
 *
 * Built once from the raw CSVs and deep-frozen. Freezing is not decoration: the entire architecture rests on
 * the model being a pure function of the source files, so that `replay` is deterministic and a human decision
 * can only ever add an overlay rather than edit history. A stray write would break idempotency silently.
 */

import { loadRawSources } from '@/data/raw/loadRawSources';
import type { CanonicalModel } from '@/domain/entities';
import { normalize, type NormalizationResult } from './normalize';

/** Recursively freeze objects, arrays and maps. */
function deepFreeze<T>(value: T, seen = new WeakSet<object>()): T {
  if (value === null || typeof value !== 'object') return value;
  if (seen.has(value as object)) return value;
  seen.add(value as object);

  if (value instanceof Map) {
    for (const entry of value.values()) deepFreeze(entry, seen);
    // A frozen Map still allows set(); replace the mutators so a write fails loudly instead of silently.
    const map = value as unknown as Record<string, unknown>;
    map['set'] = () => {
      throw new Error('CanonicalModel is frozen: decisions must go through DecisionProjection overlays.');
    };
    map['delete'] = () => {
      throw new Error('CanonicalModel is frozen.');
    };
    map['clear'] = () => {
      throw new Error('CanonicalModel is frozen.');
    };
    return Object.freeze(value);
  }

  for (const key of Object.getOwnPropertyNames(value)) {
    deepFreeze((value as Record<string, unknown>)[key], seen);
  }
  return Object.freeze(value);
}

let cached: NormalizationResult | null = null;

/** Load, normalize, freeze and cache. Subsequent calls return the same instance. */
export function getNormalized(): NormalizationResult {
  if (!cached) {
    const result = normalize(loadRawSources());
    deepFreeze(result.model);
    cached = result;
  }
  return cached;
}

export function getCanonicalModel(): CanonicalModel {
  return getNormalized().model;
}

/** Test-only. */
export function resetModelCache(): void {
  cached = null;
}
