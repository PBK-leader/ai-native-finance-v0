/**
 * The decision ledger for the browser making this request.
 *
 * Pages read it here and pass it into `engineState`; route handlers read it, append to it, and write it back.
 * Keeping the cookie access in this one file means the workflow layer stays a pure function of (model,
 * ledger) with no idea a request exists.
 */

import { cookies } from 'next/headers';
import type { ReviewDecision } from '@/domain/workflow';
import { LEDGER_COOKIE, decodeLedger } from '@/workflows/ledgerCodec';

export async function currentLedger(): Promise<ReviewDecision[]> {
  return decodeLedger((await cookies()).get(LEDGER_COOKIE)?.value);
}
