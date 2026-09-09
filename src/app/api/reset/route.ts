/**
 * Clear the decision ledger, returning the portfolio to the state the agents found it in.
 *
 * Because every derived number is recomputed from the ledger and the canonical model is frozen, emptying the
 * ledger genuinely restores the baseline — there is no residue to clean up. That is what makes the demo
 * repeatable.
 */

import { withLedger } from '../ledgerResponse';

export async function POST() {
  return withLedger({ ok: true }, []);
}
