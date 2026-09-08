/**
 * Load a scripted demonstration.
 *
 * A demo is literally a list of decisions, because all derived state is a pure function of the ledger. The
 * same lists drive the workflow tests, so what a customer sees on screen is exactly what the test suite
 * asserts.
 */

import { NextResponse } from 'next/server';
import { DEMOS, type DemoId } from '@/workflows/demos';
import { decisionStore } from '@/workflows/decisionStore';

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

  decisionStore().replaceAll(demo.decisions);
  return NextResponse.json({ ok: true, loaded: demo.decisions.length });
}
