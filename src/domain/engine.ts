/**
 * Engine-level type declarations: the per-step snapshot and close readiness.
 *
 * Declared here at layer 3 under the same rule as everything else — a type is inert data, so naming one
 * creates no runtime dependency, and behaviour is what layering has to order. Putting `Snapshot` in
 * `src/agents` forced `src/graph/build` to import upward from layer 8 to layer 10 just to name it, which the
 * architecture invariant test caught.
 *
 * The agents produce these; the graph projection and the UI consume them.
 */

import type { ProjectId } from './ids';
import type { ProjectMetrics } from './metrics';
import type { AgentAction, ExceptionRecord, Task, Workstream } from './workflow';

export type CloseReadiness = {
  projectId: ProjectId;
  ready: boolean;
  blockingTaskIds: string[];
  openTaskCount: number;
  /** Which workstreams are held up, so the UI can say what specifically is blocked. */
  blockedWorkstreams: Workstream[];
  /** True when this project's own items are clear but a portfolio-level problem still holds the close. */
  heldByPortfolioIssue: boolean;
};

/**
 * Portfolio-level close readiness.
 *
 * Some blocking problems belong to no project — an unmappable source project is the clearest case, because
 * "which project is it?" is precisely the unanswered question. Those tasks appeared in no project's blocking
 * set, so a HIGH exception marked `blocking: true` blocked nothing and every project could reach close-ready
 * with it wide open. Presenting a control that does not control anything is worse than not having it.
 */
export type PortfolioReadiness = {
  ready: boolean;
  blockingTaskIds: string[];
  /** Projects that are individually ready but held by a portfolio-level problem. */
  heldByPortfolioIssue: ProjectId[];
};

/** One pass of the agent run: everything true at that step. */
export type Snapshot = {
  /** Step 0 is the baseline run, before any human has answered anything. */
  step: number;
  /** Every exception visible this step, including ones retained for audit continuity. */
  exceptions: ExceptionRecord[];
  tasks: Task[];
  actions: AgentAction[];
  closeReadiness: Map<ProjectId, CloseReadiness>;
  portfolioReadiness: PortfolioReadiness;
  /**
   * Project economics as at this step. Carried on the snapshot so the Close Orchestrator can judge the effect
   * of one human answer against the step immediately before it, rather than against the original baseline.
   */
  metricsByProject: ReadonlyMap<ProjectId, ProjectMetrics>;
  triggeringDecisionId: string | null;
};

/**
 * The minimum an agent must expose for the graph to describe it.
 *
 * Passed into the graph projection rather than imported from `src/agents`, so the projection stays below the
 * agent layer and cannot accidentally depend on agent behaviour.
 */
export type AgentDescriptor = {
  id: string;
  name: string;
  goal: string;
  workstream: Workstream | 'All';
  ownedRules: readonly string[];
};
