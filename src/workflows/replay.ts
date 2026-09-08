/**
 * The replay engine — the heart of the architecture.
 *
 * `replay(model, config, decisions)` is a pure function. It computes the agents' baseline run with no human
 * input, then applies each decision in turn, recomputing the entire derived picture after every one. What
 * comes out is not just the final state but the whole history: what each agent saw, what it opened, who it
 * asked, what the human said, and what changed as a result.
 *
 * Three properties this file is responsible for:
 *
 * 1. **It never throws.** The ledger is append-only and this runs on every render, so an unhandled decision
 *    would brick every screen permanently. Bad decisions are marked `ignored` and skipped.
 * 2. **History is honest.** The resolution index is scoped to the decision prefix, so step 0 shows tasks as
 *    open — not retroactively resolved by answers that had not happened yet.
 * 3. **It emits no agent actions of its own.** Agents observe and record; this orders the run.
 */

import type { V0Config } from '@/config/v0Config';
import type { CanonicalModel } from '@/domain/entities';
import type { ProjectId } from '@/domain/ids';
import type { ProjectMetrics } from '@/domain/metrics';
import type { ReconciledView } from '@/domain/reconciliation';
import { buildResolutionIndex, checkTransition, type RoutedException } from '@/domain/taskStatus';
import type {
  AgentAction, DecisionProjection, ExceptionRecord, ResolutionIndex, ReviewDecision, Task,
} from '@/domain/workflow';
import { EMPTY_PROJECTION, isSettled, waitingStateFor } from '@/domain/workflow';
import { computeAllProjectMetrics } from '@/calculations/projectMetrics';
import { detectExceptions } from '@/exceptions/engine';
import { ALL_RULES } from '@/exceptions/engine';
import { AGENTS } from '@/agents/agents';
import type { CloseReadiness, PortfolioReadiness, Snapshot } from '@/domain/engine';
import { projectDecisions } from './projectDecisions';
import { checkEligibility } from './eligibility';

export type EngineState = {
  /** Prior-period metrics, reconstructed with no current-close decisions. */
  prior: ReadonlyMap<ProjectId, ProjectMetrics>;
  /** One entry per step: index 0 is the baseline agent run, then one per decision. */
  snapshots: Snapshot[];
  current: Snapshot;
  /** Agent actions and human decisions interleaved in the order they happened. */
  activity: ActivityEntry[];
  /** Decisions the workflow refused to act on, with the reason. */
  ignored: { decision: ReviewDecision; reason: string }[];
  decisions: readonly ReviewDecision[];
  /**
   * The projection actually used to produce `current` — ignored decisions excluded.
   *
   * Exposed so nothing downstream has to re-derive it from the raw ledger. The graph explorer did, which
   * meant a decision the engine refused could still draw an SOV line and a MAPS_TO edge that contributed to
   * no number anywhere: the arithmetic and the picture disagreeing, which is the one thing this
   * architecture exists to prevent.
   */
  effectiveProjection: DecisionProjection;
};

export type ActivityEntry =
  | { kind: 'agent'; step: number; action: AgentAction }
  | { kind: 'decision'; step: number; decision: ReviewDecision };

type BuildViewFn = (model: CanonicalModel, projection: DecisionProjection) => ReconciledView;

function metricsByProject(metrics: ProjectMetrics[]): ReadonlyMap<ProjectId, ProjectMetrics> {
  return new Map(metrics.map((m) => [m.projectId, m]));
}

/**
 * Run one full pass: detect, then let each agent observe and act, in the contractual order.
 *
 * Detection happens once and is partitioned by rule ownership — the agents do not each re-run the rules.
 */
function runAgents(input: {
  model: CanonicalModel;
  view: ReconciledView;
  projection: DecisionProjection;
  config: V0Config;
  metrics: ReadonlyMap<ProjectId, ProjectMetrics>;
  priorMetrics: ReadonlyMap<ProjectId, ProjectMetrics>;
  resolutionIndex: ResolutionIndex;
  previousSnapshot: Snapshot | null;
  triggeringDecision: ReviewDecision | null;
  step: number;
}): Snapshot {
  const ruleContext = {
    model: input.model,
    view: input.view,
    projection: input.projection,
    config: input.config,
    metrics: input.metrics,
    priorMetrics: input.priorMetrics,
    resolutionIndex: input.resolutionIndex,
    asOfDate: input.config.closeDate,
  };

  const detection = detectExceptions(ruleContext);

  const exceptions: ExceptionRecord[] = [];
  const tasks: Task[] = [];
  const actions: AgentAction[] = [];
  let closeReadiness = new Map<ProjectId, CloseReadiness>();
  let portfolioReadiness: PortfolioReadiness = {
    ready: true,
    blockingTaskIds: [],
    heldByPortfolioIssue: [],
  };

  for (const agent of AGENTS) {
    const result = agent.run({
      ...ruleContext,
      detection,
      previousSnapshot: input.previousSnapshot,
      triggeringDecision: input.triggeringDecision,
      step: input.step,
      tasksSoFar: tasks,
    });

    exceptions.push(...result.exceptions);
    tasks.push(...result.tasks);
    actions.push(...result.actions);
    if (result.closeReadiness) closeReadiness = result.closeReadiness;
    if (result.portfolioReadiness) portfolioReadiness = result.portfolioReadiness;
  }

  // Retain exceptions a decision refers to, and ones that stopped triggering this run, so no decision is
  // orphaned and every cleared-event in the audit trail has a live target to link to.
  const present = new Set(exceptions.map((e) => e.id));
  const retained: ExceptionRecord[] = [];

  for (const previous of input.previousSnapshot?.exceptions ?? []) {
    if (present.has(previous.id)) continue;
    retained.push({ ...previous, currentlyTriggering: false, suppressedBy: previous.suppressedBy });
  }

  return {
    step: input.step,
    exceptions: [...exceptions, ...retained],
    tasks,
    actions,
    closeReadiness,
    portfolioReadiness,
    metricsByProject: input.metrics,
    triggeringDecisionId: input.triggeringDecision?.id ?? null,
  };
}

export function replay(
  model: CanonicalModel,
  buildView: BuildViewFn,
  config: V0Config,
  decisions: readonly ReviewDecision[],
): EngineState {
  // Prior period is invariant — it never sees current-close decisions — so it is computed once.
  const priorView = buildView(model, EMPTY_PROJECTION);
  const prior = metricsByProject(
    computeAllProjectMetrics(model, priorView, EMPTY_PROJECTION, config, config.priorComparisonDate),
  );

  const snapshots: Snapshot[] = [];
  const ignored: { decision: ReviewDecision; reason: string }[] = [];
  let effectiveProjection: DecisionProjection = EMPTY_PROJECTION;

  // Step 0: what the agents find before anyone has answered anything.
  const baseView = buildView(model, EMPTY_PROJECTION);
  const baseMetrics = metricsByProject(
    computeAllProjectMetrics(model, baseView, EMPTY_PROJECTION, config, config.closeDate),
  );

  let snapshot = runAgents({
    model,
    view: baseView,
    projection: EMPTY_PROJECTION,
    config,
    metrics: baseMetrics,
    priorMetrics: prior,
    resolutionIndex: new Map(),
    previousSnapshot: null,
    triggeringDecision: null,
    step: 0,
  });
  snapshots.push(snapshot);

  // Each decision is judged once, against the state that existed *before* it — never against a state that
  // already includes its own effect. Getting this wrong made a correction judge itself as "already applied"
  // and silently drop, so the rejections are accumulated in a single forward pass.
  const rejectionById = new Map<string, string>();
  const routedByException = new Map<string, RoutedException>();

  const recordRouting = (from: Snapshot): void => {
    for (const task of from.tasks) {
      if (!routedByException.has(task.exceptionId)) {
        routedByException.set(task.exceptionId, {
          exceptionId: task.exceptionId,
          projectId: task.projectId,
          ownerRole: task.ownerRole,
          createdAt: task.createdAt,
        });
      }
    }
  };
  recordRouting(snapshot);

  const lookupRejection = (decision: ReviewDecision) =>
    rejectionById.has(decision.id)
      ? ({ kind: 'INELIGIBLE_SUBJECT', reason: rejectionById.get(decision.id)! } as const)
      : null;

  for (let i = 0; i < decisions.length; i += 1) {
    const decision = decisions[i]!;
    const routed = [...routedByException.values()];

    // State before this decision: only the decisions that were actually acted on.
    const effectiveBefore = decisions.slice(0, i).filter((d) => !rejectionById.has(d.id));
    const viewBefore = buildView(model, projectDecisions(model, effectiveBefore));
    const indexBefore = buildResolutionIndex(routed, effectiveBefore, config.closeDate, lookupRejection);

    const ownerRole =
      routedByException.get(decision.exceptionId)?.ownerRole ?? decision.actor.role;
    const statusBefore = indexBefore.get(decision.exceptionId)?.status ?? waitingStateFor(ownerRole);

    // Both gates, from the same predicates the API uses on the write path.
    const rejection =
      checkTransition(statusBefore, decision, config.closeDate) ??
      checkEligibility({ model, view: viewBefore, config }, decision);

    if (rejection) {
      rejectionById.set(decision.id, rejection.reason);
      ignored.push({ decision, reason: rejection.reason });
    }

    const effective = decisions.slice(0, i + 1).filter((d) => !rejectionById.has(d.id));
    const resolutionIndex = buildResolutionIndex(routed, decisions.slice(0, i + 1), config.closeDate, lookupRejection);

    const projection = projectDecisions(model, effective);
    effectiveProjection = projection;
    const view = buildView(model, projection);
    const metrics = metricsByProject(
      computeAllProjectMetrics(model, view, projection, config, config.closeDate),
    );

    snapshot = runAgents({
      model,
      view,
      projection,
      config,
      metrics,
      priorMetrics: prior,
      resolutionIndex,
      previousSnapshot: snapshot,
      triggeringDecision: decision,
      step: i + 1,
    });
    snapshots.push(snapshot);
    recordRouting(snapshot);
  }

  const activity: ActivityEntry[] = [];
  for (const s of snapshots) {
    const decision = s.triggeringDecisionId
      ? decisions.find((d) => d.id === s.triggeringDecisionId)
      : undefined;
    // The human answer precedes the agent reaction it caused.
    if (decision) activity.push({ kind: 'decision', step: s.step, decision });
    for (const action of s.actions) activity.push({ kind: 'agent', step: s.step, action });
  }

  return { prior, snapshots, current: snapshot, activity, ignored, decisions, effectiveProjection };
}

// ---------------------------------------------------------------------------------------------------------
// Read helpers for the UI
// ---------------------------------------------------------------------------------------------------------

export function openTasks(state: EngineState): Task[] {
  return state.current.tasks.filter((task) => !isSettled(task.status));
}

export function tasksForProject(state: EngineState, projectId: ProjectId): Task[] {
  return state.current.tasks.filter((task) => task.projectId === projectId);
}

export function exceptionById(state: EngineState, id: string): ExceptionRecord | undefined {
  return state.current.exceptions.find((e) => e.id === id);
}

export function taskByExceptionId(state: EngineState, id: string): Task | undefined {
  return state.current.tasks.find((t) => t.exceptionId === id);
}

export function decisionsForException(state: EngineState, id: string): ReviewDecision[] {
  return state.decisions.filter((d) => d.exceptionId === id);
}

/** Rule metadata, for explaining in the UI what a rule looks for. */
export function ruleDescription(ruleId: string): string {
  return ALL_RULES.find((rule) => rule.id === ruleId)?.description ?? '';
}
