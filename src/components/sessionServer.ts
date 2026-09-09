/**
 * The session a server component or route handler is running for.
 *
 * The middleware assigns the cookie; this reads it. Pages pass the result into `engineState` rather than
 * letting the workflow layer reach for a request, which keeps that layer a pure function of its inputs.
 */

import { cookies } from 'next/headers';
import { FALLBACK_SESSION, SESSION_COOKIE } from './session';

export async function currentSessionId(): Promise<string> {
  return (await cookies()).get(SESSION_COOKIE)?.value ?? FALLBACK_SESSION;
}
