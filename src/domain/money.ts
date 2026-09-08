/**
 * Money, percentages, and the denominator guards.
 *
 * Policy (design §4.8): `Money` is dollars as an IEEE double. **Intermediates are never rounded.** `round2`
 * is applied only at display and at oracle comparison, and rule thresholds compare unrounded values. That is
 * why the reference oracle ties within $0.02 rather than exactly.
 *
 * The guards exist because `V0_CONFIG.md` requires that no calculation ever returns `NaN` or `Infinity`.
 * Every ratio in this product goes through `safeDivide`.
 */

export type Money = number;

/** Percentage points, e.g. a margin of 11.86% is `11.86`. */
export type Percent = number;

/** Round to cents. Display and oracle comparison only — never inside a calculation chain. */
export function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/**
 * Division that cannot produce `NaN` or `Infinity`.
 *
 * Returns `null` when the denominator is zero, which callers must render as "not applicable" rather than
 * as zero — a project with no contract value has an undefined margin, not a 0% margin.
 */
export function safeDivide(numerator: number, denominator: number): number | null {
  if (denominator === 0 || !Number.isFinite(denominator) || !Number.isFinite(numerator)) return null;
  const result = numerator / denominator;
  return Number.isFinite(result) ? result : null;
}

/** A ratio as percentage points, or `null` when the denominator is zero. */
export function safePercent(numerator: number, denominator: number): Percent | null {
  const ratio = safeDivide(numerator, denominator);
  return ratio === null ? null : ratio * 100;
}

/** Clamp to an inclusive range. */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/** Sum, tolerant of an empty list. */
export function sum(values: readonly number[]): number {
  let total = 0;
  for (const value of values) total += value;
  return total;
}

/** Sum a projected field over a collection. */
export function sumBy<T>(items: readonly T[], project: (item: T) => number): number {
  let total = 0;
  for (const item of items) total += project(item);
  return total;
}

/** Parse a CSV numeric cell. Blank means zero; a malformed value is reported, not silently zeroed. */
export function parseMoney(raw: string): Money {
  if (raw === '') return 0;
  const value = Number(raw);
  if (!Number.isFinite(value)) {
    throw new Error(`Expected a numeric source value, received ${JSON.stringify(raw)}`);
  }
  return value;
}

/** Parse an optional numeric cell. Blank means "not supplied", which is different from zero. */
export function parseOptionalNumber(raw: string): number | null {
  if (raw === '') return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

/** Whether a monetary difference is within a tolerance, used for SOV and retainage reconciliation. */
export function withinTolerance(difference: number, tolerance: number): boolean {
  return Math.abs(difference) <= tolerance;
}
