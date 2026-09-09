/**
 * Demo personas — the people whose chairs you can sit in.
 *
 * These map to real rows in `master_data/people.csv`, so a decision made as one of them is attributed to
 * someone who exists in the client's operating graph. This is the registry of who may act, which is why it
 * lives with the workflow rather than the UI: the decisions API and the demo script both need it, and the
 * screen that lets you pick one is just a consumer. Not authentication — V0 has none and does not pretend to.
 */

import type { Role } from '@/domain/entities';
import { personId, type PersonId } from '@/domain/ids';

export type PersonaId = 'pm-alex' | 'pm-morgan' | 'accountant' | 'accountant-2' | 'controller' | 'cfo';

export type Persona = { personId: PersonId; name: string; role: Role };

export const PERSONAS: Record<PersonaId, Persona> = {
  accountant: { personId: personId('PERS-PA1'), name: 'Jamie Nguyen', role: 'Project Accountant' },
  'accountant-2': { personId: personId('PERS-PA2'), name: 'Priya Shah', role: 'Project Accountant' },
  'pm-alex': { personId: personId('PERS-PM1'), name: 'Alex Morgan', role: 'Project Manager' },
  'pm-morgan': { personId: personId('PERS-PM4'), name: 'Morgan Chen', role: 'Project Manager' },
  controller: { personId: personId('PERS-CTRL'), name: 'Sam Carter', role: 'Controller' },
  cfo: { personId: personId('PERS-CFO'), name: 'Dana Ruiz', role: 'CFO' },
};

export function isPersonaId(value: string): value is PersonaId {
  return value in PERSONAS;
}
