/**
 * Give every browser its own demo.
 *
 * The decision ledger is the product's only mutable state, and it is held in memory. Keyed globally, a
 * shared link would let one visitor's accepted adjustment rewrite the numbers under everyone else, and the
 * next arrival would open a half-answered close rather than the baseline the agents found. A cookie assigned
 * here is what separates them.
 *
 * The id is set on the *request* as well as the response, so the server components rendering this very first
 * page already see it — otherwise the visitor's opening request would fall back to the shared ledger and
 * their first answer would appear to land somewhere else.
 *
 * This is not authentication. It identifies a browser, not a person, and guards nothing.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_COOKIE } from '@/components/session';

export function middleware(request: NextRequest) {
  if (request.cookies.get(SESSION_COOKIE)) return NextResponse.next();

  const id = crypto.randomUUID();
  request.cookies.set(SESSION_COOKIE, id);

  const response = NextResponse.next({ request });
  response.cookies.set(SESSION_COOKIE, id, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 60 * 60 * 24,
  });

  return response;
}

export const config = {
  // Everything the app serves, including the decision API. Static assets and image optimisation carry no
  // ledger, so exclude them rather than pay for a middleware invocation per file.
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
