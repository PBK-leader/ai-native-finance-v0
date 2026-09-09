'use client';

/**
 * Who you are acting as.
 *
 * This is a **demo affordance, not authentication**. V0 has no auth by design, but the workflow genuinely
 * enforces role authority — only a Controller can accept a risk, only a PM can answer a forecast question —
 * so there has to be some way to say who is clicking. The choice is kept in a cookie and attached to every
 * decision as the actor.
 */

import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState, useTransition } from 'react';
import {
  PERSONAS, PERSONA_CHANGED_EVENT, type PersonaId, readPersonaCookie, writePersonaCookie,
} from './persona';

export function PersonaSwitcher() {
  const router = useRouter();
  const pathname = usePathname();
  const [personaId, setPersonaId] = useState<PersonaId>('accountant');
  const [, startTransition] = useTransition();

  // Follow the cookie on every route change, and whenever something else (the guided demo) rewrites it
  // without navigating.
  useEffect(() => {
    const sync = () => setPersonaId(readPersonaCookie());
    sync();
    window.addEventListener(PERSONA_CHANGED_EVENT, sync);
    return () => window.removeEventListener(PERSONA_CHANGED_EVENT, sync);
  }, [pathname]);

  const persona = PERSONAS[personaId];

  return (
    <label className="flex items-center gap-2 text-xs">
      <span className="text-[var(--color-muted)]">Acting as</span>
      <select
        value={personaId}
        onChange={(event) => {
          const next = event.target.value as PersonaId;
          setPersonaId(next);
          writePersonaCookie(next);
          startTransition(() => router.refresh());
        }}
        className="rounded border border-[var(--color-line)] bg-[var(--color-surface)] px-2 py-1 text-xs"
        aria-label="Demo persona"
      >
        {Object.entries(PERSONAS).map(([id, option]) => (
          <option key={id} value={id}>
            {option.name} — {option.role}
          </option>
        ))}
      </select>
      <span className="sr-only">{persona.role}</span>
    </label>
  );
}
