/**
 * The agent contract.
 *
 * An agent here is a real object with a goal, a declared evidence scope, an enforced set of permitted
 * actions, and ownership of specific rules — not a function with an impressive name. The constraint that
 * makes it real is `allowedActions`: the emit helper rejects anything outside it, in every environment.
 *
 * Agents are the sole emitter of `AgentAction`. The replay engine orders the run and concatenates the
 * output; it never synthesises an action of its own. An audit trail reconstructed by diffing snapshots would
 * be weaker evidence than one recorded by the actor that took the decision.
 */

import type { IsoDate } from '@/domain/dates';
import type { Role } from '@/domain/entities';
import type { ExceptionId, ProjectId } from '@/domain/ids';
import type {
  AgentAction, AgentActionType, AgentId, ExceptionRecord, ReviewDecision, RuleId, Task, Workstream,
} from '@/domain/workflow';
import type { CloseReadiness, PortfolioReadiness, Snapshot } from '@/domain/engine';
import type { RuleContext } from '@/exceptions/types';
import type { DetectionResult } from '@/exceptions/engine';

// Snapshot and CloseReadiness are declared in `src/domain/engine.ts` so that lower layers — notably the
// graph projection — can name them without importing upward from this one. Re-exported here for convenience.
export type { CloseReadiness, PortfolioReadiness, Snapshot } from '@/domain/engine';

export type AgentRunContext = RuleContext & {
  /** Detection is run once centrally and partitioned by rule ownership, not re-run per agent. */
  detection: DetectionResult;
  previousSnapshot: Snapshot | null;
  triggeringDecision: ReviewDecision | null;
  step: number;
  /** Tasks created by agents that already ran this step — the orchestrator needs them. */
  tasksSoFar: Task[];
};

export type AgentRunResult = {
  exceptions: ExceptionRecord[];
  tasks: Task[];
  actions: AgentAction[];
  closeReadiness?: Map<ProjectId, CloseReadiness>;
  portfolioReadiness?: PortfolioReadiness;
};

export type Agent = {
  id: AgentId;
  name: string;
  /** What this agent is for, in the language a finance lead would use. */
  goal: string;
  workstream: Workstream | 'All';
  /** Named canonical collections this agent is entitled to inspect. */
  evidenceInspected: string[];
  /** Enforced at emit. An agent cannot record an action type it was not granted. */
  allowedActions: AgentActionType[];
  ownedRules: RuleId[];
  routesTo: Role[];
  run(ctx: AgentRunContext): AgentRunResult;
};

/** Raised when an agent tries to emit an action outside its declared set. */
export class DisallowedAgentActionError extends Error {
  constructor(agentId: AgentId, type: AgentActionType) {
    super(`Agent ${agentId} is not permitted to emit ${type}.`);
    this.name = 'DisallowedAgentActionError';
  }
}

/**
 * Builds an action emitter bound to one agent, enforcing `allowedActions`.
 *
 * Returns a typed error rather than throwing from a render path where possible; the throw here is a
 * programming-error guard, reached only if an agent's own code emits something it never declared.
 */
export function actionEmitter(agent: Agent, step: number, at: IsoDate) {
  const actions: AgentAction[] = [];
  let sequence = 0;

  return {
    actions,
    emit(input: {
      type: AgentActionType;
      summary: string;
      projectId?: ProjectId | null;
      exceptionId?: ExceptionId | null;
      triggeringDecisionId?: string | null;
    }): void {
      if (!agent.allowedActions.includes(input.type)) {
        throw new DisallowedAgentActionError(agent.id, input.type);
      }
      sequence += 1;
      actions.push({
        id: `${agent.id}-${step}-${sequence}`,
        agentId: agent.id,
        type: input.type,
        step,
        projectId: input.projectId ?? null,
        exceptionId: input.exceptionId ?? null,
        triggeringDecisionId: input.triggeringDecisionId ?? null,
        summary: input.summary,
        at,
      });
    },
  };
}
