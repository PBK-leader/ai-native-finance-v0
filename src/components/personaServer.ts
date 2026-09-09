/**
 * The persona a server component is rendering for.
 *
 * The switcher stores the choice in a cookie; pages read it here so the home screen, the header count and
 * the card wording can all be about the same person. Not authentication — see `persona.ts`.
 */

import { cookies } from 'next/headers';
import { PERSONAS, PERSONA_COOKIE, isPersonaId, type Persona, type PersonaId } from './persona';

export async function currentPersona(): Promise<{ id: PersonaId; persona: Persona }> {
  const value = (await cookies()).get(PERSONA_COOKIE)?.value;
  const id: PersonaId = value && isPersonaId(value) ? value : 'accountant';
  return { id, persona: PERSONAS[id] };
}
