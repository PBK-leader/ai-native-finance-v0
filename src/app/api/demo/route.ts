/**
 * Load a scripted demonstration.
 *
 * A demo is literally a list of decisions, because all derived state is a pure function of the ledger. The
 * same lists drive the workflow tests, so what a customer sees on screen is exactly what the test suite
 * asserts.
 */

import { NextResponse } from 'next/server';
import { DEMOS, type DemoId } from '@/workflows/demos';
import { withLedger } from '../ledgerResponse';

export async function POST(request: Request) {
  let id: DemoId;
  try {
    ({ id } = (await request.json()) as { id: DemoId });
  } catch {
    return NextResponse.json({ reason: 'Malformed request.' }, { status: 400 });
  }

  const demo = DEMOS[id];

  if (!demo) {
    return NextResponse.json({ reason: `Unknown demo ${id}.` }, { status: 400 });
  }

  // Replaces rather than appends: a demo is a scripted starting point, not something to stack on whatever
  // the visitor had already answered.
  return withLedger({ ok: true, loaded: demo.decisions.length }, demo.decisions);
}
