/**
 * The shared behaviour of the three detection agents.
 *
 * Cost Control, Forecast, and Billing & Change Order all follow the same loop over different rules and
 * different owners: observe what they are entitled to see, take the exceptions they own from the shared
 * detection pass, open a task for each one a human still needs to act on, route it to a named person, and
 * report anything that has stopped triggering since the previous step.
 *
 * Routing to a *person* rather than a role matters for the demo: "waiting on Alex Morgan" is a real
 * operational status; "waiting on PM" is a category.
 */

import type { Role } from '@/domain/entities';
import type { PersonId, ProjectId } from '@/domain/ids';
import { roleForWaitingState, waitingStateFor } from '@/domain/workflow';
import type { ExceptionRecord, Task, TaskStatus } from '@/domain/workflow';
import { actionEmitter, type Agent, type AgentRunContext, type AgentRunResult } from './types';

/**
 * Pick the person who should act.
 *
 * The project manager comes from the project record. Finance roles are assigned deterministically — the two
 * project accountants split the portfolio by project id so the work queue has a realistic split of owners,
 * and every run assigns the same way.
 */
export function resolveOwner(
  ctx: AgentRunContext,
  role: Role,
  projectId: ProjectId | null,
): PersonId | null {
  if (role === 'Project Manager' && projectId) {
    return ctx.view.managerForProject(projectId)?.id ?? null;
  }

  const byRole = ctx.model.people.filter((person) => person.role === role);
  if (byRole.length === 0) return null;
  if (byRole.length === 1 || !projectId) return byRole[0]!.id;

  // Stable split: same project always lands with the same accountant.
  const digits = projectId.replace(/\D/g, '');
  const index = Number(digits.slice(-1) || 0) % byRole.length;
  return byRole[index]!.id;
}

/**
 * Who a task belongs to, given where it has got to.
 *
 * The one place this rule is expressed. A task belongs to whoever it is waiting on *now* — the rule routed it
 * to a role, but an escalation hands it to the Controller, and it must then appear on the Controller's desk
 * and vanish from the escalator's. Once settled it keeps the role that held it at settlement, so the record
 * does not revert to the original routing; the exception still carries that, and the desk uses the difference
 * to spot a hand-up.
 */
export function ownerRoleFor(
  status: TaskStatus,
  resolution: { settledWaitingRole: Role | null } | undefined,
  routedTo: Role,
): Role {
  return roleForWaitingState(status) ?? resolution?.settledWaitingRole ?? routedTo;
}

/** Turn an exception into a task, carrying whatever status the ledger has already established. */
export function taskFor(ctx: AgentRunContext, exception: ExceptionRecord): Task {
  const resolution = ctx.resolutionIndex.get(exception.id);
  const status: TaskStatus = resolution?.status ?? waitingStateFor(exception.ownerRole);
  const ownerRole = ownerRoleFor(status, resolution, exception.ownerRole);

  return {
    id: `TASK-${exception.id}`,
    exceptionId: exception.id,
    projectId: exception.projectId,
    workstream: exception.workstream,
    ownerRole,
    ownerPersonId: resolveOwner(ctx, ownerRole, exception.projectId),
    blocking: exception.blocking,
    status,
    title: exception.title,
    requestedAction: exception.recommendedAction,
    evidence: exception.evidence,
    // Baseline artifacts are stamped from the close date; anything downstream inherits the decision's
    // effective date. No wall-clock reads below the app layer, so replay stays deterministic.
    createdAt: ctx.config.closeDate,
    updatedAt: resolution?.lastDecisionAt ?? ctx.config.closeDate,
  };
}

/** The observe → detect → create → route → report loop, shared by the three detection agents. */
export function runDetectionAgent(agent: Agent, ctx: AgentRunContext): AgentRunResult {
  const emitter = actionEmitter(agent, ctx.step, ctx.triggeringDecision?.effectiveDate ?? ctx.config.closeDate);
  const owned = new Set(agent.ownedRules);

  const mine = ctx.detection.all.filter((exception) => owned.has(exception.ruleId));
  const unsuppressed = mine.filter((exception) => exception.suppressedBy === null);

  emitter.emit({
    type: 'OBSERVED',
    summary:
      ctx.triggeringDecision === null
        ? `Reviewed ${agent.evidenceInspected.join(', ')} across ${ctx.metrics.size} projects as at ${ctx.asOfDate}.`
        : `Re-ran ${agent.name} analysis after a ${ctx.triggeringDecision.payload.type} decision.`,
    triggeringDecisionId: ctx.triggeringDecision?.id ?? null,
  });

  // Anything this agent reported last step that no longer triggers. Reported explicitly so the audit trail
  // shows the consequence of a human answer rather than leaving the reader to infer it from an absence.
  const previouslyTriggering = new Set(
    (ctx.previousSnapshot?.exceptions ?? [])
      .filter((e) => owned.has(e.ruleId) && e.currentlyTriggering)
      .map((e) => e.id),
  );
  const stillTriggering = new Set(mine.map((e) => e.id));
  const cleared = (ctx.previousSnapshot?.exceptions ?? []).filter(
    (e) => previouslyTriggering.has(e.id) && !stillTriggering.has(e.id),
  );

  for (const exception of cleared) {
    emitter.emit({
      type: 'EXCEPTION_CLEARED',
      summary: `No longer triggering after recomputation: ${exception.title}`,
      projectId: exception.projectId,
      exceptionId: exception.id,
      triggeringDecisionId: ctx.triggeringDecision?.id ?? null,
    });
  }

  const tasks: Task[] = [];

  for (const exception of unsuppressed) {
    const task = taskFor(ctx, exception);
    tasks.push(task);

    const wasKnown = previouslyTriggering.has(exception.id);

    if (!wasKnown) {
      emitter.emit({
        type: 'EXCEPTION_DETECTED',
        summary: exception.title,
        projectId: exception.projectId,
        exceptionId: exception.id,
        triggeringDecisionId: ctx.triggeringDecision?.id ?? null,
      });
      emitter.emit({
        type: 'TASK_CREATED',
        summary: `Opened: ${exception.recommendedAction}`,
        projectId: exception.projectId,
        exceptionId: exception.id,
      });
      emitter.emit({
        type: 'TASK_ROUTED',
        summary: `Routed to ${exception.ownerRole}${
          task.ownerPersonId ? ` (${ctx.model.index.personById.get(task.ownerPersonId)?.name ?? ''})` : ''
        }.`,
        projectId: exception.projectId,
        exceptionId: exception.id,
      });
    }
  }

  // A decision this step that landed on one of this agent's exceptions: acknowledge it and say the analysis
  // was re-run, which is the visible half of "incorporate response → recompute".
  const decision = ctx.triggeringDecision;
  if (decision && mine.some((e) => e.id === decision.exceptionId)) {
    emitter.emit({
      type: 'RESPONSE_INCORPORATED',
      summary: `Incorporated ${decision.payload.type} from ${decision.actor.role}.`,
      projectId: decision.subject.projectId,
      exceptionId: decision.exceptionId,
      triggeringDecisionId: decision.id,
    });
    emitter.emit({
      type: 'ANALYSIS_RERUN',
      summary: `Recomputed ${agent.workstream} analysis on the affected project.`,
      projectId: decision.subject.projectId,
      exceptionId: decision.exceptionId,
      triggeringDecisionId: decision.id,
    });
  }

  return { exceptions: mine, tasks, actions: emitter.actions };
}
