/**
 * Agent Console — the agents as declared contracts, not as a black box.
 *
 * Everything on this page already exists in `src/agents`: a goal, a declared evidence scope, an enforced set
 * of permitted actions, and ownership of specific rules. The runtime action emitter (`src/agents/types.ts`)
 * throws if an agent emits an action outside `allowedActions` — this page reads that same declaration rather
 * than a separate description of it, so it cannot drift from what the code actually enforces.
 *
 * The action tally below each agent is not sample data: it is a live count from `state.activity`, the same
 * interleaved agent-action/decision log the Activity tab renders. Reset the demo and the counts reset with it.
 */

import { AGENTS } from '@/agents/agents';
import { CLOSE_CONTROLLER_REVIEW } from '@/domain/ids';
import type { AgentActionType } from '@/domain/workflow';
import { engineState } from '@/workflows/engine';
import { ruleDescription } from '@/workflows/replay';
import { Card } from '@/components/ui';
import { agentActionLabel, count } from '@/components/format';
import { currentSessionId } from '@/components/sessionServer';

export const dynamic = 'force-dynamic';

const LOOP_STAGES = [
  'Observe', 'Detect', 'Create evidence-backed task', 'Route to a person', 'Wait for human',
  'Incorporate response', 'Rerun affected analysis', 'Resolve or escalate',
];

function ruleLabel(ruleId: string): string {
  // The Controller review used to be special-cased here with a second, differently worded description. One
  // finding described two ways on two screens is the sort of thing a Controller notices and nobody can
  // resolve; `ruleDescription` now covers it from the same source as every other rule.
  return ruleDescription(ruleId) || ruleId;
}

export default async function AgentsPage() {
  const state = engineState(await currentSessionId());

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Agents</h1>
        <p className="mt-1 max-w-3xl text-sm">
          <span className="font-medium">What this answers:</span>{' '}
          <span className="text-[var(--color-muted)]">
            What is the system actually doing when a card says an item was &quot;detected&quot; or
            &quot;routed&quot; — and what, concretely, stops it from doing anything else?
          </span>
        </p>
      </div>

      <Card
        title="The loop every agent runs"
        subtitle="Deterministic in V0 — no agent decides an accounting outcome, only whether a human needs to"
      >
        <div className="flex flex-wrap items-center gap-2">
          {LOOP_STAGES.map((stage, i) => (
            <div key={stage} className="flex items-center gap-2">
              <span className="rounded-full border border-[var(--color-line)] bg-[var(--color-canvas)] px-3 py-1 text-xs font-medium">
                {stage}
              </span>
              {i < LOOP_STAGES.length - 1 && <span className="text-[var(--color-muted)]">→</span>}
            </div>
          ))}
        </div>
        <p className="mt-3 text-xs text-[var(--color-muted)]">
          &quot;Wait for human&quot; is a real pause, not a spinner: the ledger simply has no decision yet, so
          replay stops advancing that task until one arrives. Nothing times out or auto-resolves.
        </p>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        {AGENTS.map((agent) => {
          const actions = state.activity
            .filter((entry) => entry.kind === 'agent' && entry.action.agentId === agent.id)
            .map((entry) => (entry as { kind: 'agent'; action: { type: AgentActionType } }).action);

          const tally = new Map<AgentActionType, number>();
          for (const type of agent.allowedActions) tally.set(type, 0);
          for (const action of actions) tally.set(action.type, (tally.get(action.type) ?? 0) + 1);

          return (
            <Card
              key={agent.id}
              title={agent.name}
              subtitle={`Workstream: ${agent.workstream}`}
              actions={
                <span className="rounded bg-slate-50 px-2 py-0.5 text-[11px] font-medium text-[var(--color-muted)] ring-1 ring-inset ring-slate-200">
                  {count(actions.length)} actions logged this session
                </span>
              }
            >
              <div className="space-y-4">
                <p className="text-sm">{agent.goal}</p>

                <div>
                  <h3 className="text-[11px] font-medium uppercase tracking-wide text-[var(--color-muted)]">
                    Evidence it is entitled to inspect
                  </h3>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {agent.evidenceInspected.map((item) => (
                      <span
                        key={item}
                        className="rounded bg-slate-50 px-2 py-0.5 text-xs text-[var(--color-ink)] ring-1 ring-inset ring-slate-200"
                      >
                        {item}
                      </span>
                    ))}
                  </div>
                </div>

                <div>
                  <h3 className="text-[11px] font-medium uppercase tracking-wide text-[var(--color-muted)]">
                    Rules it owns ({agent.ownedRules.length})
                  </h3>
                  <ul className="mt-1.5 space-y-1">
                    {agent.ownedRules.map((ruleId) => (
                      <li key={ruleId} className="flex gap-2 text-xs">
                        <span className="text-[var(--color-muted)]">·</span>
                        <span>{ruleLabel(ruleId)}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                <div>
                  <h3 className="text-[11px] font-medium uppercase tracking-wide text-[var(--color-muted)]">
                    Actions it is allowed to emit — enforced, not documented
                  </h3>
                  <p className="mt-1 text-xs text-[var(--color-muted)]">
                    Every emitted action is checked against this exact list at runtime. An agent that tries to
                    record anything outside it fails immediately rather than being silently logged.
                  </p>
                  <ul className="mt-2 divide-y divide-[var(--color-line)] rounded border border-[var(--color-line)]">
                    {agent.allowedActions.map((type) => (
                      <li key={type} className="flex items-center justify-between px-2.5 py-1.5 text-xs">
                        <span>{agentActionLabel(type)}</span>
                        <span
                          className={`tabular font-medium ${
                            (tally.get(type) ?? 0) > 0
                              ? 'text-[var(--color-accent)]'
                              : 'text-[var(--color-muted)]'
                          }`}
                        >
                          {count(tally.get(type) ?? 0)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>

                <div>
                  <h3 className="text-[11px] font-medium uppercase tracking-wide text-[var(--color-muted)]">
                    Routes findings to
                  </h3>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {agent.routesTo.map((role) => (
                      <span
                        key={role}
                        className="rounded bg-blue-50 px-2 py-0.5 text-xs text-[var(--color-accent)] ring-1 ring-inset ring-blue-200"
                      >
                        {role}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            </Card>
          );
        })}
      </div>

      <Card title="Where this shows up elsewhere" subtitle="This page is a reading of code, not a separate model of it">
        <ul className="space-y-1.5 text-sm text-[var(--color-muted)]">
          <li>
            The <strong className="text-[var(--color-ink)]">Activity</strong> tab on any project renders these
            same actions in the order they happened, interleaved with the human decisions that answered them.
          </li>
          <li>
            The <strong className="text-[var(--color-ink)]">Operating Graph</strong> has an{' '}
            <strong className="text-[var(--color-ink)]">Agent</strong> node for each of these four, with a{' '}
            <code className="rounded bg-slate-50 px-1 py-0.5 text-xs">CREATED</code> link to every exception it
            detected — so &quot;which agent found this&quot; is a graph edge, not a caption.
          </li>
        </ul>
      </Card>
    </div>
  );
}
