/**
 * Calendar dates as `YYYY-MM-DD` strings.
 *
 * Deliberately string-based. These are business dates from source systems, not instants: an invoice approved
 * on 2026-07-16 was approved on that day in whatever timezone the ERP runs in, and converting to a `Date`
 * would introduce a timezone hazard for no benefit. Lexicographic comparison of `YYYY-MM-DD` is chronological
 * comparison, which is all the as-of logic needs.
 *
 * `Date.now()` and `new Date()` are banned below `src/app` (design §4.7) so `replay` stays pure. This module
 * therefore has no concept of "today" — every as-of question is answered against `config.closeDate`.
 */

export type IsoDate = string;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function isIsoDate(value: string): value is IsoDate {
  return ISO_DATE.test(value);
}

/** Parse a source date cell. Blank is a legitimate "no date" (an unapproved invoice has no approval date). */
export function parseDate(raw: string): IsoDate | null {
  if (raw === '') return null;
  if (!ISO_DATE.test(raw)) {
    throw new Error(`Expected a YYYY-MM-DD source date, received ${JSON.stringify(raw)}`);
  }
  return raw;
}

/** True when `date` falls on or before `asOf`. A missing date is never on or before anything. */
export function onOrBefore(date: IsoDate | null, asOf: IsoDate): boolean {
  return date !== null && date <= asOf;
}

/** Whole days from `from` to `to`, negative if `to` precedes `from`. */
export function daysBetween(from: IsoDate, to: IsoDate): number {
  const MS_PER_DAY = 86_400_000;
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / MS_PER_DAY);
}

/** Age in days of `date` as at `asOf`. Used for posting lag, CO aging, and forecast staleness. */
export function ageInDays(date: IsoDate, asOf: IsoDate): number {
  return daysBetween(date, asOf);
}

/** The later of two dates, treating `null` as "no date at all". */
export function maxDate(a: IsoDate | null, b: IsoDate | null): IsoDate | null {
  if (a === null) return b;
  if (b === null) return a;
  return a >= b ? a : b;
}

/** The earlier of two dates, treating `null` as "no date at all". */
export function minDate(a: IsoDate | null, b: IsoDate | null): IsoDate | null {
  if (a === null) return b;
  if (b === null) return a;
  return a <= b ? a : b;
}
