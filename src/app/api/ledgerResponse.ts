/**
 * Write a ledger back to the browser that owns it.
 *
 * The three write routes all do the same last step — encode the new ledger, check it still fits a cookie, and
 * set it — so it lives here rather than three times over.
 *
 * The size check refuses rather than truncates. Dropping the oldest decisions to make room would silently
 * un-answer a question a human already answered, and the numbers would move for no visible reason.
 */

import { NextResponse } from 'next/server';
import type { ReviewDecision } from '@/domain/workflow';
import { LEDGER_COOKIE, encodeLedger, fits } from '@/workflows/ledgerCodec';

export function withLedger(
  body: Record<string, unknown>,
  decisions: readonly ReviewDecision[],
): NextResponse {
  const encoded = encodeLedger(decisions);

  if (!fits(encoded)) {
    return NextResponse.json(
      {
        reason:
          'This demo has recorded as many answers as a browser cookie can hold. Reset the demo to carry on — '
          + 'the prototype keeps its ledger in your browser rather than a database.',
      },
      { status: 413 },
    );
  }

  const response = NextResponse.json(body);

  response.cookies.set(LEDGER_COOKIE, encoded, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 60 * 60 * 24,
  });

  return response;
}
