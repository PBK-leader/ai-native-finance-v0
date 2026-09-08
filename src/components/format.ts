/**
 * Display formatting only.
 *
 * Every number reaching these helpers was already computed by `src/calculations`. Nothing here performs
 * financial arithmetic — that rule is enforced by a test, because a percentage recomputed in a component is
 * exactly how two screens start disagreeing.
 *
 * `null` means "not applicable" throughout the domain, and it is rendered as an em dash rather than as zero.
 * A project with no contract value has an undefined margin; showing 0% would be a lie.
 */

export function usd(value: number | null | undefined, options?: { compact?: boolean }): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  if (options?.compact && Math.abs(value) >= 1000) {
    const millions = value / 1_000_000;
    if (Math.abs(millions) >= 1) return `$${millions.toFixed(millions >= 10 ? 1 : 2)}M`;
    return `$${Math.round(value / 1000)}k`;
  }
  return value.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  });
}

export function signedUsd(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  const formatted = usd(Math.abs(value));
  return value < 0 ? `(${formatted})` : formatted;
}

export function pct(value: number | null | undefined, digits = 1): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return 'n/a';
  return `${value.toFixed(digits)}%`;
}

/** A ratio expressed as a fraction (0.211) rendered as a percentage. */
export function ratioPct(value: number | null | undefined, digits = 1): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return 'n/a';
  return `${(value * 100).toFixed(digits)}%`;
}

export function points(value: number | null | undefined, digits = 2): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return 'n/a';
  return `${value >= 0 ? '' : ''}${value.toFixed(digits)} pts`;
}

export function count(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return value.toLocaleString('en-US');
}

export function hours(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return `${value.toLocaleString('en-US', { maximumFractionDigits: 0 })} hrs`;
}

/** Render a measured evidence value in its declared unit. */
export function measure(value: number | null, unit: string): string {
  switch (unit) {
    case 'USD':
      return usd(value);
    case 'PCT':
      return pct(value);
    case 'PP':
      return points(value);
    case 'DAYS':
      return value === null ? '—' : `${count(value)} days`;
    case 'HOURS':
      return hours(value);
    case 'COUNT':
      return count(value);
    default:
      return value === null ? '—' : String(value);
  }
}

export function statusLabel(status: string): string {
  switch (status) {
    case 'WAITING_FOR_PM':
      return 'Waiting on PM';
    case 'WAITING_FOR_ACCOUNTANT':
      return 'Waiting on Accountant';
    case 'WAITING_FOR_CONTROLLER':
      return 'Waiting on Controller';
    case 'ACCEPTED_RISK':
      return 'Risk accepted';
    case 'RESOLVED':
      return 'Resolved';
    default:
      return status;
  }
}
