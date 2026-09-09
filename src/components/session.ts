/**
 * The session cookie — how the server tells one browser's demo from another's.
 *
 * Not authentication, and nothing is protected by it. It exists because the decision ledger is the only
 * mutable state in the product, and on a shared link a single global ledger would mean one visitor's answers
 * rewriting everybody else's portfolio. See `src/workflows/decisionStore.ts`.
 */

export const SESSION_COOKIE = 'mep-session';

/**
 * The ledger used when no cookie is present.
 *
 * Reachable only if the middleware did not run — during a build-time render, or if the matcher is ever
 * narrowed past a route. It behaves exactly like the single global ledger this replaced, so the failure mode
 * is "visitors share a demo" rather than "answers vanish", which is the less confusing of the two.
 */
export const FALLBACK_SESSION = 'shared-no-cookie';
