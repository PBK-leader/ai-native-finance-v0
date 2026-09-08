'use client';

/**
 * Load a scripted demonstration, or clear the ledger.
 *
 * These are the same decision lists the workflow tests assert against, so the demo a customer watches is
 * exactly the behaviour that is under test. Reset genuinely restores the baseline because the canonical model
 * is frozen and every number is recomputed from the ledger.
 */

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { DEMOS, type DemoId } from '@/workflows/demos';

export function DemoBar({ hasDecisions }: { hasDecisions: boolean }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);

  const call = (path: string, body?: unknown) => {
    startTransition(async () => {
      await fetch(path, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
      });
      setOpen(false);
      router.refresh();
    });
  };

  return (
    <div className="relative flex items-center gap-2">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        disabled={isPending}
        className="rounded border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-1.5 text-xs font-medium transition hover:border-[var(--color-accent)] disabled:opacity-40"
      >
        Run a demo
      </button>

      {hasDecisions && (
        <button
          type="button"
          onClick={() => call('/api/reset')}
          disabled={isPending}
          className="rounded border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-1.5 text-xs text-[var(--color-muted)] transition hover:border-[var(--color-accent)] disabled:opacity-40"
        >
          Reset
        </button>
      )}

      {open && (
        <div className="absolute right-0 top-full z-20 mt-2 w-96 rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] p-2 shadow-lg">
          {Object.entries(DEMOS).map(([id, demo]) => (
            <button
              key={id}
              type="button"
              onClick={() => call('/api/demo', { id: id as DemoId })}
              className="block w-full rounded px-3 py-2 text-left transition hover:bg-[var(--color-canvas)]"
            >
              <div className="text-sm font-medium">{demo.name}</div>
              <div className="mt-0.5 text-xs text-[var(--color-muted)]">{demo.summary}</div>
            </button>
          ))}
          <p className="border-t border-[var(--color-line)] px-3 pb-1 pt-2 text-[11px] text-[var(--color-muted)]">
            Loading a demo replaces the current decision ledger.
          </p>
        </div>
      )}
    </div>
  );
}
