/**
 * Putting the decision ledger where a serverless host can actually find it: with the reader.
 *
 * The ledger used to live in a module-level variable. That works on one machine and cannot work on a
 * serverless host, because the request that records a decision and the request that renders the next screen
 * run in different processes with different memory. Locally every answer landed; deployed, every answer was
 * accepted, written into a process nothing would read again, and silently lost. The demo looked alive and did
 * nothing.
 *
 * So the ledger travels with the browser, in a cookie. That is not a workaround — it is what this design was
 * already claiming. The only mutable state is an append-only list of human decisions, and everything else is
 * recomputed from it, which means the server needs to remember nothing at all between requests. Each visitor
 * carries their own ledger, so a shared link gives everyone their own portfolio rather than one they fight
 * over.
 *
 * Gzipped because the payloads are prose — an accountant's note, a project manager's explanation — and prose
 * compresses. A six-decision demo is about 3KB of JSON, which does not fit a 4KB cookie once base64 has taken
 * its third; compressed it is closer to 900 bytes, which leaves room for a full working session.
 *
 * Nothing here trusts what it decodes. A cookie is client-controlled, so a malformed or hand-edited one is
 * treated as an empty ledger rather than allowed to throw — a decode that threw would make every page 500
 * with no way for the visitor to recover.
 */

import { gunzipSync, gzipSync } from 'node:zlib';
import type { ReviewDecision } from '@/domain/workflow';

export const LEDGER_COOKIE = 'mep-ledger';

/**
 * The most encoded bytes we will put in a cookie.
 *
 * Browsers cap a cookie near 4KB and hosts cap total request headers, so the honest failure is to refuse the
 * write and say so. Silently dropping the oldest decisions would quietly change answers a human already gave.
 */
export const MAX_ENCODED_BYTES = 3500;

/** Base64url, so the value needs no cookie escaping. */
function toBase64Url(buffer: Buffer): string {
  return buffer.toString('base64').replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

function fromBase64Url(value: string): Buffer {
  return Buffer.from(value.replaceAll('-', '+').replaceAll('_', '/'), 'base64');
}

export function encodeLedger(decisions: readonly ReviewDecision[]): string {
  if (decisions.length === 0) return '';
  return toBase64Url(gzipSync(Buffer.from(JSON.stringify(decisions), 'utf8')));
}

/**
 * Whether the encoded ledger still fits. Checked before writing, so the caller can refuse with a reason
 * rather than setting a cookie the browser will drop on the floor.
 */
export function fits(encoded: string): boolean {
  return Buffer.byteLength(encoded, 'utf8') <= MAX_ENCODED_BYTES;
}

/**
 * Decode a ledger cookie into decisions, or an empty ledger if it is anything other than what we wrote.
 *
 * Shape-checks each entry rather than trusting the JSON: `replay` is hardened against hostile ledgers, but it
 * expects objects with these fields, and a cookie is the one input a visitor can edit by hand.
 */
export function decodeLedger(value: string | undefined): ReviewDecision[] {
  if (!value) return [];

  try {
    const json = gunzipSync(fromBase64Url(value)).toString('utf8');
    const parsed: unknown = JSON.parse(json);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isDecisionShaped);
  } catch {
    return [];
  }
}

function isDecisionShaped(value: unknown): value is ReviewDecision {
  if (typeof value !== 'object' || value === null) return false;
  const d = value as Record<string, unknown>;

  return (
    typeof d.id === 'string'
    && typeof d.exceptionId === 'string'
    && typeof d.effectiveDate === 'string'
    && typeof d.recordedAt === 'string'
    && isRecord(d.subject)
    && isRecord(d.actor)
    && typeof (d.actor as Record<string, unknown>).personId === 'string'
    && typeof (d.actor as Record<string, unknown>).role === 'string'
    && isRecord(d.payload)
    && typeof (d.payload as Record<string, unknown>).type === 'string'
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
