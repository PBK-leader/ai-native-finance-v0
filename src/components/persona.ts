/**
 * The persona cookie — how the browser says whose chair it is sitting in.
 *
 * The personas themselves are workflow data (`src/workflows/personas.ts`); this file only owns the cookie
 * that carries the choice. Not authentication.
 */

import { isPersonaId, type PersonaId } from '@/workflows/personas';

export { PERSONAS, isPersonaId } from '@/workflows/personas';
export type { Persona, PersonaId } from '@/workflows/personas';

export const PERSONA_COOKIE = 'mep-persona';

/** Fired on `window` whenever the cookie is written, so the switcher can follow a change it did not make. */
export const PERSONA_CHANGED_EVENT = 'mep-persona-changed';

export function readPersonaCookie(): PersonaId {
  if (typeof document === 'undefined') return 'accountant';
  const match = document.cookie.match(new RegExp(`${PERSONA_COOKIE}=([^;]+)`));
  const value = match?.[1];
  return value && isPersonaId(value) ? value : 'accountant';
}

export function writePersonaCookie(id: PersonaId): void {
  document.cookie = `${PERSONA_COOKIE}=${id}; path=/; max-age=86400; samesite=lax`;
  window.dispatchEvent(new Event(PERSONA_CHANGED_EVENT));
}
