'use client';

/**
 * The guided walkthrough.
 *
 * The original demo control loaded a scenario and left you on whatever screen you happened to be on, with no
 * indication of what had changed or where to look. Someone who had not built the product could not run it.
 *
 * This panel does the driving: it loads the right ledger state, navigates to the right screen, tells you what
 * to say, and tells you what to point at. It persists across navigation because it lives in the app shell and
 * keeps its position in `localStorage`.
 */

import { usePathname, useRouter } from 'next/navigation';
import { useCallback, useEffect, useState, useTransition } from 'react';
import { GUIDE, GUIDE_LENGTH } from '@/workflows/demoScript';
import { writePersonaCookie } from './persona';

const STORAGE_KEY = 'mep-guide-step';

export function DemoGuide() {
  const router = useRouter();
  const pathname = usePathname();
  const [step, setStep] = useState<number | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [isPending, startTransition] = useTransition();

  // Restore position on mount, so navigating between screens does not lose your place.
  useEffect(() => {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored !== null) setStep(Number(stored));
  }, []);

  const goTo = useCallback(
    (index: number) => {
      const target = GUIDE[index];
      if (!target) return;

      setStep(index);
      window.localStorage.setItem(STORAGE_KEY, String(index));

      startTransition(async () => {
        // Sit in the right chair first — the home screen is cut per person.
        if (target.persona) writePersonaCookie(target.persona);
        // Put the ledger in the state this beat of the story needs, then go to the right screen.
        if (target.load === 'reset') {
          await fetch('/api/reset', { method: 'POST' });
        } else if (target.load) {
          await fetch('/api/demo', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ id: target.load }),
          });
        }

        if (target.href !== pathname + window.location.search) router.push(target.href);
        router.refresh();
      });
    },
    [pathname, router],
  );

  const exit = () => {
    setStep(null);
    window.localStorage.removeItem(STORAGE_KEY);
    startTransition(async () => {
      await fetch('/api/reset', { method: 'POST' });
      router.push('/');
      router.refresh();
    });
  };

  if (step === null) {
    return (
      <button
        type="button"
        onClick={() => goTo(0)}
        className="fixed bottom-5 right-5 z-40 rounded-full bg-[var(--color-accent)] px-5 py-3 text-sm font-medium text-white shadow-lg transition hover:brightness-110"
      >
        ▶ Start guided demo
      </button>
    );
  }

  const current = GUIDE[step]!;

  if (collapsed) {
    return (
      <button
        type="button"
        onClick={() => setCollapsed(false)}
        className="fixed bottom-5 right-5 z-40 rounded-full bg-[var(--color-accent)] px-5 py-3 text-sm font-medium text-white shadow-lg"
      >
        Step {step + 1} of {GUIDE_LENGTH} — {current.label} ▲
      </button>
    );
  }

  return (
    <aside className="fixed bottom-0 right-0 z-40 max-h-[85vh] w-full overflow-y-auto border-l border-t border-[var(--color-line)] bg-[var(--color-surface)] shadow-2xl sm:bottom-5 sm:right-5 sm:max-w-md sm:rounded-lg sm:border">
      <header className="sticky top-0 flex items-center justify-between gap-2 border-b border-[var(--color-line)] bg-[var(--color-accent)] px-4 py-2.5 text-white">
        <div>
          <div className="text-[11px] uppercase tracking-wide opacity-80">
            Guided demo · step {step + 1} of {GUIDE_LENGTH}
          </div>
          <div className="text-sm font-semibold">{current.label}</div>
        </div>
        <div className="flex gap-1">
          <button
            type="button"
            onClick={() => setCollapsed(true)}
            className="rounded px-2 py-1 text-xs hover:bg-white/20"
            aria-label="Minimise"
          >
            ▼
          </button>
          <button
            type="button"
            onClick={exit}
            className="rounded px-2 py-1 text-xs hover:bg-white/20"
          >
            Exit
          </button>
        </div>
      </header>

      {/* Progress rail, so you always know how far through the story you are. */}
      <div className="flex gap-1 px-4 pt-3">
        {GUIDE.map((s, i) => (
          <button
            key={s.label}
            type="button"
            onClick={() => goTo(i)}
            title={s.label}
            className={`h-1.5 flex-1 rounded-full transition ${
              i <= step ? 'bg-[var(--color-accent)]' : 'bg-[var(--color-line)]'
            }`}
          />
        ))}
      </div>

      <div className="space-y-4 px-4 py-4">
        <h2 className="text-base font-semibold leading-snug">{current.title}</h2>

        <div>
          <h3 className="text-[11px] font-medium uppercase tracking-wide text-[var(--color-muted)]">
            What to say
          </h3>
          <p className="mt-1 text-sm leading-relaxed">{current.say}</p>
        </div>

        <div className="rounded border border-[var(--color-line)] bg-[var(--color-canvas)] px-3 py-2.5">
          <h3 className="text-[11px] font-medium uppercase tracking-wide text-[var(--color-muted)]">
            Point at this
          </h3>
          <ul className="mt-1.5 space-y-1">
            {current.lookFor.map((item) => (
              <li key={item} className="flex gap-2 text-sm">
                <span className="text-[var(--color-accent)]">→</span>
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="rounded border-l-2 border-[var(--color-accent)] bg-blue-50/50 px-3 py-2">
          <h3 className="text-[11px] font-medium uppercase tracking-wide text-[var(--color-muted)]">
            Why it matters
          </h3>
          <p className="mt-0.5 text-sm leading-relaxed">{current.soWhat}</p>
        </div>

        <div className="flex items-center justify-between gap-2 pt-1">
          <button
            type="button"
            onClick={() => goTo(step - 1)}
            disabled={step === 0 || isPending}
            className="rounded border border-[var(--color-line)] px-3 py-1.5 text-xs transition disabled:opacity-30"
          >
            ← Back
          </button>

          {isPending && <span className="text-xs text-[var(--color-muted)]">Loading…</span>}

          {step < GUIDE_LENGTH - 1 ? (
            <button
              type="button"
              onClick={() => goTo(step + 1)}
              disabled={isPending}
              className="rounded bg-[var(--color-accent)] px-4 py-1.5 text-xs font-medium text-white transition disabled:opacity-40"
            >
              Next →
            </button>
          ) : (
            <button
              type="button"
              onClick={exit}
              className="rounded bg-[var(--color-ok)] px-4 py-1.5 text-xs font-medium text-white"
            >
              Finish
            </button>
          )}
        </div>
      </div>
    </aside>
  );
}
