'use client';

/**
 * Where a human answers.
 *
 * The available actions depend on the task's state and the persona you are acting as, mirroring the same
 * transition table the server enforces. The server is the authority — it re-checks role authority, subject
 * eligibility and the effective date, and returns a readable reason on refusal — but showing only the
 * legitimate options avoids inviting a rejection.
 *
 * Forms are pre-filled with the agent's recommendation where there is one. The point of the product is that
 * the human confirms or overrides a proposal, not that they fill in a blank spreadsheet.
 */

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { roleForWaitingState } from '@/domain/workflow';
import type { ExceptionRecord, Task } from '@/domain/workflow';
import type { ForecastTarget } from '@/workflows/forecastTargets';
import { readPersonaCookie, type Persona } from './persona';

type Mode = 'accept' | 'reject' | 'forecast' | 'sov' | 'answer' | 'escalate' | 'risk' | 'approve';

function adjustmentTypeFor(ruleId: string): 'RNI' | 'AP_UNPOSTED' | 'UNPOSTED_LABOR' | null {
  if (ruleId === 'AP_RNI') return 'RNI';
  if (ruleId === 'AP_MISSING_POSTING') return 'AP_UNPOSTED';
  if (ruleId === 'LABOR_MISSING_POSTING') return 'UNPOSTED_LABOR';
  return null;
}

export function ResolveForm({
  task, exception, forecastTargets = [], viewer,
}: {
  task: Task;
  exception: ExceptionRecord;
  /**
   * Who is acting, resolved on the server from the same cookie the API will check. Read as a prop rather
   * than from `document.cookie` during render, so the server-rendered and browser-rendered forms agree.
   */
  viewer: Persona;
  /**
   * The cost codes this question is actually about, resolved server-side from the canonical model.
   *
   * Previously the form recovered a cost code by splitting the exception's subject id on `-` and taking the
   * last segment. For a cost-code-subject rule that happened to work; for a project-subject rule like the
   * stale-forecast question it produced a cost code that does not exist, and the resulting forecast landed in
   * the project total but in no cost code's detail.
   */
  forecastTargets?: ForecastTarget[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [mode, setMode] = useState<Mode | null>(null);
  const [text, setText] = useState('');
  const [amount, setAmount] = useState(String(exception.impact ?? 0));
  const [lines, setLines] = useState<LineDraft[]>(() =>
    forecastTargets.map((target) => ({
      costCode: target.costCode,
      description: target.description,
      remainingUncommittedCost: String(target.remainingUncommittedCost),
      remainingLaborHours: target.remainingLaborHours === null ? '' : String(target.remainingLaborHours),
    })),
  );

  const adjustmentType = adjustmentTypeFor(exception.ruleId);

  const post = (payload: unknown) => {
    setError(null);
    startTransition(async () => {
      const response = await fetch('/api/decisions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          exceptionId: exception.id,
          projectId: exception.projectId,
          canonicalId: exception.subjectId,
          persona: readPersonaCookie(),
          payload,
        }),
      });

      if (!response.ok) {
        const body = (await response.json()) as { reason?: string };
        setError(body.reason ?? 'That decision was refused.');
        return;
      }

      setMode(null);
      setText('');
      setDone(true);
      router.refresh();
    });
  };

  const options = availableActions(
    task, viewer.role, adjustmentType !== null, exception.ruleId, forecastTargets.length > 0,
  );

  // Who can act follows the status, not the original routing: an escalated item waits on the Controller.
  const actingRole = roleForWaitingState(task.status) ?? task.ownerRole;
  const isMine = task.ownerPersonId === viewer.personId;

  if (options.length === 0) {
    return (
      <p className="mt-3 text-xs text-[var(--color-muted)]">
        Only the {actingRole.toLowerCase()} can act on this. In this demo, use &quot;Acting as&quot; at the top
        right to sit in their chair.
      </p>
    );
  }

  return (
    <div className="mt-3 space-y-3">
      {!isMine && (
        <p className="text-xs text-[var(--color-muted)]">
          This is waiting on the {actingRole.toLowerCase()}. As {viewer.role}, you can step in on their behalf;
          the question itself stays with them.
        </p>
      )}
      {done && (
        <p className="rounded border border-green-200 bg-green-50 px-3 py-2 text-xs text-[var(--color-ok)]">
          Recorded. Every number that depends on this has been recalculated.
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        {options.map((option) => (
          <button
            key={option.mode}
            type="button"
            onClick={() => setMode(mode === option.mode ? null : option.mode)}
            className={`rounded border px-2.5 py-1 text-xs transition ${
              mode === option.mode
                ? 'border-[var(--color-accent)] bg-blue-50 text-[var(--color-accent)]'
                : 'border-[var(--color-line)] bg-[var(--color-surface)] hover:border-[var(--color-accent)]'
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>

      {mode === 'forecast' && (
        <div className="space-y-2">
          {lines.map((line, index) => (
            <div key={line.costCode} className="grid gap-2 sm:grid-cols-[9rem_1fr_1fr]">
              <span className="self-center text-xs">
                <span className="tabular font-medium">{line.costCode}</span>
                <span className="block text-[var(--color-muted)]">{line.description}</span>
              </span>
              <label className="text-xs">
                <span className="text-[var(--color-muted)]">Remaining cost</span>
                <input
                  type="number"
                  value={line.remainingUncommittedCost}
                  onChange={(e) => updateLine(setLines, index, { remainingUncommittedCost: e.target.value })}
                  className="mt-0.5 w-full rounded border border-[var(--color-line)] px-2 py-1"
                />
              </label>
              <label className="text-xs">
                <span className="text-[var(--color-muted)]">Remaining hours</span>
                <input
                  type="number"
                  value={line.remainingLaborHours}
                  onChange={(e) => updateLine(setLines, index, { remainingLaborHours: e.target.value })}
                  className="mt-0.5 w-full rounded border border-[var(--color-line)] px-2 py-1"
                />
              </label>
            </div>
          ))}
          <Textarea
            label="What changed, and why?"
            value={text}
            onChange={setText}
            placeholder="Explain the movement — this is recorded against the cost code for the Controller review."
          />
          <Submit
            disabled={isPending || text.trim().length < 5}
            onClick={() =>
              post({
                type: 'PM_FORECAST_UPDATE',
                lines: lines.map((line) => ({
                  costCode: line.costCode,
                  remainingUncommittedCost: Number(line.remainingUncommittedCost),
                  remainingLaborHours:
                    line.remainingLaborHours === '' ? null : Number(line.remainingLaborHours),
                  comment: text,
                })),
              })
            }
          />
        </div>
      )}

      {mode === 'accept' && adjustmentType && (
        <div className="space-y-2">
          <label className="block text-xs">
            <span className="text-[var(--color-muted)]">Amount to accept into cost to date</span>
            <input
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="tabular mt-0.5 w-full rounded border border-[var(--color-line)] px-2 py-1 sm:w-56"
            />
          </label>
          <Textarea label="Note for the audit trail" value={text} onChange={setText} />
          <Submit
            disabled={isPending || text.trim().length < 3}
            onClick={() =>
              post({
                type: 'ACCEPT_ADJUSTMENT',
                adjustmentType,
                subjectId: exception.subjectId,
                amount: Number(amount),
                note: text,
              })
            }
          />
        </div>
      )}

      {mode === 'sov' && (
        <div className="space-y-2">
          <label className="block text-xs">
            <span className="text-[var(--color-muted)]">Scheduled value to add</span>
            <input
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="tabular mt-0.5 w-full rounded border border-[var(--color-line)] px-2 py-1 sm:w-56"
            />
          </label>
          <Submit
            disabled={isPending}
            label="Add to schedule of values"
            onClick={() =>
              post({
                type: 'RECORD_SOV_CORRECTION',
                changeOrderId: exception.subjectId,
                scheduledValue: Number(amount),
                retainagePct: 5,
              })
            }
          />
        </div>
      )}

      {mode === 'answer' && (
        <div className="space-y-2">
          <Textarea label="Your answer" value={text} onChange={setText} />
          <Submit
            disabled={isPending || text.trim().length < 5}
            onClick={() => post({ type: 'PM_ANSWER', answer: text })}
          />
        </div>
      )}

      {mode === 'reject' && (
        <div className="space-y-2">
          <Textarea label="Why is no adjustment needed?" value={text} onChange={setText} />
          <Submit
            disabled={isPending || text.trim().length < 5}
            onClick={() => post({ type: 'REJECT_ADJUSTMENT', reason: text })}
          />
        </div>
      )}

      {mode === 'escalate' && (
        <div className="space-y-2">
          <Textarea label="What does the Controller need to decide?" value={text} onChange={setText} />
          <Submit
            disabled={isPending || text.trim().length < 5}
            label="Escalate to Controller"
            onClick={() => post({ type: 'ESCALATE', reason: text })}
          />
        </div>
      )}

      {mode === 'risk' && (
        <div className="space-y-2">
          <Textarea
            label="Rationale for proceeding without resolving this"
            value={text}
            onChange={setText}
            placeholder="Required. This is preserved in the audit trail as an explicit Controller judgement."
          />
          <Submit
            disabled={isPending || text.trim().length < 5}
            label="Accept risk and proceed"
            onClick={() => post({ type: 'ACCEPT_RISK', rationale: text })}
          />
        </div>
      )}

      {mode === 'approve' && (
        <div className="space-y-2">
          <Textarea label="Approval note" value={text} onChange={setText} />
          <Submit
            disabled={isPending}
            label="Approve for close"
            onClick={() => post({ type: 'CONTROLLER_APPROVE', note: text })}
          />
        </div>
      )}

      {error && (
        <p className="rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-[var(--color-blocking)]">
          {error}
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------

function availableActions(
  task: Task,
  role: string,
  hasAdjustment: boolean,
  ruleId: string,
  hasForecastTargets: boolean,
): { mode: Mode; label: string }[] {
  const options: { mode: Mode; label: string }[] = [];

  if (task.status === 'WAITING_FOR_PM' && role === 'Project Manager') {
    // Offered only when there are real cost codes to update, so the form can never submit a phantom one.
    if (hasForecastTargets) {
      options.push({
        mode: 'forecast',
        label: ruleId === 'FC_STALE' ? 'Refresh forecast' : 'Update forecast',
      });
    }
    options.push({ mode: 'answer', label: 'Answer' });
    options.push({ mode: 'escalate', label: 'Escalate' });
  }

  if (task.status === 'WAITING_FOR_ACCOUNTANT' && role === 'Project Accountant') {
    if (hasAdjustment) {
      options.push({ mode: 'accept', label: 'Accept adjustment' });
      options.push({ mode: 'reject', label: 'No adjustment needed' });
    } else if (ruleId === 'CO_MISSING_SOV') {
      options.push({ mode: 'sov', label: 'Add SOV line' });
      options.push({ mode: 'reject', label: 'No correction needed' });
    } else {
      options.push({ mode: 'reject', label: 'Resolve with note' });
    }
    options.push({ mode: 'escalate', label: 'Escalate' });
  }

  if (role === 'Controller') {
    if (task.status === 'WAITING_FOR_CONTROLLER') {
      options.push({ mode: 'approve', label: 'Approve for close' });
    }
    options.push({ mode: 'risk', label: 'Accept risk' });
  }

  return options;
}

type LineDraft = {
  costCode: string;
  description: string;
  remainingUncommittedCost: string;
  remainingLaborHours: string;
};

function updateLine(
  setLines: React.Dispatch<React.SetStateAction<LineDraft[]>>,
  index: number,
  patch: Partial<LineDraft>,
) {
  setLines((current) => current.map((line, i) => (i === index ? { ...line, ...patch } : line)));
}

function Textarea({
  label, value, onChange, placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <label className="block text-xs">
      <span className="text-[var(--color-muted)]">{label}</span>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        rows={3}
        className="mt-0.5 w-full rounded border border-[var(--color-line)] px-2 py-1.5 text-sm"
      />
    </label>
  );
}

function Submit({
  disabled, onClick, label = 'Submit',
}: {
  disabled: boolean;
  onClick: () => void;
  label?: string;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="rounded bg-[var(--color-accent)] px-3 py-1.5 text-xs font-medium text-white transition disabled:opacity-40"
    >
      {label}
    </button>
  );
}
