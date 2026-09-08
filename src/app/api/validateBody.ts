/**
 * Runtime validation for the decision endpoint.
 *
 * TypeScript's `as Body` cast is a compile-time assertion about data that arrives at runtime from outside the
 * program. It checks nothing. Without a real guard here, `{"amount": "120000"}` — a perfectly ordinary
 * mistake for a client to make — is accepted, and every `+=` downstream becomes string concatenation. The
 * resulting estimate at completion coerces back to a plausible number and the project reports a margin that
 * is simply wrong, with nothing flagged anywhere. For a finance product that is the worst available failure
 * mode: not a crash, but a believable lie.
 *
 * So the boundary narrows untrusted JSON into the domain's own types, and rejects anything else with a
 * reason the caller can read.
 */

import type { DecisionPayload, ForecastLine } from '@/domain/workflow';

export type ValidationResult<T> = { ok: true; value: T } | { ok: false; reason: string };

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** A finite number. Rejects strings, `NaN`, and the infinities. */
const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;

function validateForecastLines(value: unknown): ValidationResult<ForecastLine[]> {
  if (!Array.isArray(value) || value.length === 0) {
    return { ok: false, reason: 'A forecast update needs at least one cost-code line.' };
  }

  const lines: ForecastLine[] = [];

  for (const raw of value) {
    if (!isObject(raw)) return { ok: false, reason: 'Each forecast line must be an object.' };
    if (!isNonEmptyString(raw['costCode'])) {
      return { ok: false, reason: 'Each forecast line must name a cost code.' };
    }
    if (!isFiniteNumber(raw['remainingUncommittedCost'])) {
      return {
        ok: false,
        reason: `Remaining cost for ${raw['costCode']} must be a number, not text or a blank.`,
      };
    }

    const hours = raw['remainingLaborHours'];
    if (hours !== null && hours !== undefined && !isFiniteNumber(hours)) {
      return {
        ok: false,
        reason: `Remaining hours for ${raw['costCode']} must be a number, or left empty.`,
      };
    }

    lines.push({
      costCode: raw['costCode'],
      remainingUncommittedCost: raw['remainingUncommittedCost'],
      remainingLaborHours: isFiniteNumber(hours) ? hours : null,
      comment: typeof raw['comment'] === 'string' ? raw['comment'] : '',
    });
  }

  return { ok: true, value: lines };
}

export function validateDecisionPayload(value: unknown): ValidationResult<DecisionPayload> {
  if (!isObject(value)) return { ok: false, reason: 'Missing decision payload.' };

  const type = value['type'];

  switch (type) {
    case 'PM_FORECAST_UPDATE': {
      const lines = validateForecastLines(value['lines']);
      if (!lines.ok) return lines;
      return { ok: true, value: { type, lines: lines.value } };
    }

    case 'PM_ANSWER': {
      if (!isNonEmptyString(value['answer'])) return { ok: false, reason: 'An answer is required.' };
      return { ok: true, value: { type, answer: value['answer'] } };
    }

    case 'ACCEPT_ADJUSTMENT': {
      const adjustmentType = value['adjustmentType'];
      if (adjustmentType !== 'RNI' && adjustmentType !== 'AP_UNPOSTED' && adjustmentType !== 'UNPOSTED_LABOR') {
        return { ok: false, reason: 'Unknown adjustment type.' };
      }
      if (!isNonEmptyString(value['subjectId'])) {
        return { ok: false, reason: 'An adjustment must name what it applies to.' };
      }
      if (!isFiniteNumber(value['amount'])) {
        return { ok: false, reason: 'The amount must be a number, not text or a blank.' };
      }
      return {
        ok: true,
        value: {
          type,
          adjustmentType,
          subjectId: value['subjectId'],
          amount: value['amount'],
          note: typeof value['note'] === 'string' ? value['note'] : '',
        },
      };
    }

    case 'REJECT_ADJUSTMENT': {
      if (!isNonEmptyString(value['reason'])) return { ok: false, reason: 'A reason is required.' };
      return { ok: true, value: { type, reason: value['reason'] } };
    }

    case 'RECORD_SOV_CORRECTION': {
      if (!isNonEmptyString(value['changeOrderId'])) {
        return { ok: false, reason: 'A schedule-of-values correction must name a change order.' };
      }
      if (!isFiniteNumber(value['scheduledValue'])) {
        return { ok: false, reason: 'The scheduled value must be a number.' };
      }
      const retainage = value['retainagePct'];
      if (!isFiniteNumber(retainage)) {
        return { ok: false, reason: 'Retainage must be a number.' };
      }
      return {
        ok: true,
        value: {
          type,
          changeOrderId: value['changeOrderId'] as DecisionPayload extends { changeOrderId: infer T }
            ? T
            : never,
          scheduledValue: value['scheduledValue'],
          retainagePct: retainage,
        } as DecisionPayload,
      };
    }

    case 'ESCALATE': {
      if (!isNonEmptyString(value['reason'])) return { ok: false, reason: 'A reason is required.' };
      return { ok: true, value: { type, reason: value['reason'] } };
    }

    case 'ACCEPT_RISK': {
      if (!isNonEmptyString(value['rationale'])) {
        return { ok: false, reason: 'Accepting a risk requires a written rationale.' };
      }
      return { ok: true, value: { type, rationale: value['rationale'] } };
    }

    case 'CONTROLLER_APPROVE': {
      return {
        ok: true,
        value: { type, note: typeof value['note'] === 'string' ? value['note'] : '' },
      };
    }

    default:
      return { ok: false, reason: `Unknown decision type ${JSON.stringify(type)}.` };
  }
}
