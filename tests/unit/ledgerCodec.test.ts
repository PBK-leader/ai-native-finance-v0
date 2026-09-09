/**
 * The ledger cookie is now the only mutable state in the deployed product, and it is the one input a visitor
 * can edit by hand. Two things have to hold: what we wrote comes back exactly, and what we did not write
 * cannot take the application down.
 *
 * The bug these tests exist because of: the ledger lived in a module-level variable, which worked on one
 * machine and could not work on a serverless host, where the request that records a decision and the request
 * that renders the next screen run in different processes. Every answer was accepted and silently lost.
 */

import { describe, expect, it } from 'vitest';
import { DEMOS } from '@/workflows/demos';
import { MAX_ENCODED_BYTES, decodeLedger, encodeLedger, fits } from '@/workflows/ledgerCodec';
import type { ReviewDecision } from '@/domain/workflow';

const everyDemoDecision = Object.values(DEMOS).flatMap((demo) => demo.decisions);

describe('the ledger survives the round trip through a cookie', () => {
  it('returns exactly what was written, for every scripted demo', () => {
    for (const [name, demo] of Object.entries(DEMOS)) {
      const decoded = decodeLedger(encodeLedger(demo.decisions));
      expect(decoded, name).toEqual(demo.decisions);
    }
  });

  it('preserves free text in a payload — the part that cannot be reconstructed', () => {
    const withProse = everyDemoDecision.find(
      (d) => d.payload.type === 'ACCEPT_ADJUSTMENT' || d.payload.type === 'PM_ANSWER',
    );
    expect(withProse).toBeDefined();

    const [decoded] = decodeLedger(encodeLedger([withProse!]));
    expect(decoded!.payload).toEqual(withProse!.payload);
  });

  it('treats an empty ledger as an empty cookie rather than a value to store', () => {
    expect(encodeLedger([])).toBe('');
    expect(decodeLedger('')).toEqual([]);
    expect(decodeLedger(undefined)).toEqual([]);
  });
});

describe('a hand-edited cookie cannot break every page', () => {
  // Each of these reaches `decodeLedger` from a visitor's browser. Throwing here would 500 the whole site
  // with no way for them to recover, so the contract is "empty ledger", never an exception.
  const HOSTILE = [
    'not base64 at all !!!',
    Buffer.from('{"not":"gzipped"}').toString('base64'),
    encodeLedger(everyDemoDecision).slice(0, 20),
    'AAAA',
    '',
  ];

  it.each(HOSTILE)('returns an empty ledger for %j', (value) => {
    expect(() => decodeLedger(value)).not.toThrow();
    expect(decodeLedger(value)).toEqual([]);
  });

  it('drops entries that are not shaped like a decision, keeping the ones that are', () => {
    const good = everyDemoDecision[0]!;
    const mixed = [good, { id: 'DEC-x' }, null, 'a string', { ...good, actor: undefined }];

    const decoded = decodeLedger(encodeLedger(mixed as unknown as ReviewDecision[]));

    expect(decoded).toEqual([good]);
  });
});

describe('the size limit is enforced where it can still be reported', () => {
  it('fits every scripted demo comfortably', () => {
    for (const [name, demo] of Object.entries(DEMOS)) {
      expect(fits(encodeLedger(demo.decisions)), name).toBe(true);
    }
  });

  it('leaves room for a full working session, not just the scripted ones', () => {
    // The queue opens with eleven items. Compressing prose is what buys the headroom, so this asserts the
    // real thing rather than a guess: a ledger of that size still has to fit.
    const many = Array.from({ length: 12 }, (_, i) => ({
      ...everyDemoDecision[i % everyDemoDecision.length]!,
      id: `DEC-synthetic-${i}`,
    }));

    expect(fits(encodeLedger(many))).toBe(true);
    expect(decodeLedger(encodeLedger(many))).toHaveLength(12);
  });

  it('reports a ledger that has outgrown a cookie instead of quietly truncating it', () => {
    const absurd = Array.from({ length: 4000 }, (_, i) => ({
      ...everyDemoDecision[0]!,
      id: `DEC-${i}`,
      payload: { type: 'PM_ANSWER' as const, answer: `unique prose ${i} ${Math.random()}` },
    }));

    const encoded = encodeLedger(absurd);
    expect(Buffer.byteLength(encoded)).toBeGreaterThan(MAX_ENCODED_BYTES);
    expect(fits(encoded)).toBe(false);
  });
});
