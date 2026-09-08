/**
 * Demo personas — the people whose chairs you can sit in.
 *
 * These map to real rows in `master_data/people.csv`, so a decision made here is attributed to someone who
 * exists in the client's operating graph. Not authentication: V0 has no auth and does not pretend to.
 */

import type { Role } from '@/domain/entities';

export type PersonaId = 'pm-alex' | 'pm-morgan' | 'accountant' | 'accountant-2' | 'controller' | 'cfo';

export type Persona = { personId: string; name: string; role: Role };

export const PERSONAS: Record<PersonaId, Persona> = {
  accountant: { personId: 'PERS-PA1', name: 'Jamie Nguyen', role: 'Project Accountant' },
  'accountant-2': { personId: 'PERS-PA2', name: 'Priya Shah', role: 'Project Accountant' },
  'pm-alex': { personId: 'PERS-PM1', name: 'Alex Morgan', role: 'Project Manager' },
  'pm-morgan': { personId: 'PERS-PM4', name: 'Morgan Chen', role: 'Project Manager' },
  controller: { personId: 'PERS-CTRL', name: 'Sam Carter', role: 'Controller' },
  cfo: { personId: 'PERS-CFO', name: 'Dana Ruiz', role: 'CFO' },
};

export const PERSONA_COOKIE = 'mep-persona';

export function isPersonaId(value: string): value is PersonaId {
  return value in PERSONAS;
}

export function readPersonaCookie(): PersonaId {
  if (typeof document === 'undefined') return 'accountant';
  const match = document.cookie.match(new RegExp(`${PERSONA_COOKIE}=([^;]+)`));
  const value = match?.[1];
  return value && isPersonaId(value) ? value : 'accountant';
}

export function writePersonaCookie(id: PersonaId): void {
  document.cookie = `${PERSONA_COOKIE}=${id}; path=/; max-age=86400; samesite=lax`;
}
