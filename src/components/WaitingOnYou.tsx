/**
 * The header count — "3 waiting on you" — so nobody has to go looking for their work.
 *
 * Reads the same selector the desk uses, so the number here and the list on the desk cannot differ.
 */

import Link from 'next/link';
import { engineState } from '@/workflows/engine';
import { openTasksForPerson } from '@/workflows/replay';
import { currentPersona } from './personaServer';
import { currentSessionId } from './sessionServer';

export async function WaitingOnYou() {
  const { persona } = await currentPersona();
  const tasks = openTasksForPerson(engineState(await currentSessionId()), persona.personId);
  const blocking = tasks.filter((t) => t.blocking).length;

  if (tasks.length === 0) {
    return (
      <Link href="/" className="rounded-full bg-green-50 px-2.5 py-1 text-xs text-[var(--color-ok)] ring-1 ring-inset ring-green-200">
        Nothing waiting on you
      </Link>
    );
  }

  return (
    <Link
      href="/"
      className={`rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset ${
        blocking > 0
          ? 'bg-red-50 text-[var(--color-blocking)] ring-red-200'
          : 'bg-blue-50 text-[var(--color-accent)] ring-blue-200'
      }`}
      title={blocking > 0 ? `${blocking} of these are holding up a close` : undefined}
    >
      {tasks.length} waiting on you
    </Link>
  );
}
