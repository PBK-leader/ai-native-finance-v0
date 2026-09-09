/**
 * The task-status reducer.
 *
 * Pure, total, and deliberately at the bottom of the stack. Suppression needs to know whether an exception is
 * still unresolved, and suppression runs in `src/exceptions` — two layers below the decision ledger. Putting
 * the reducer here breaks what would otherwise be a circular dependency: `replay` builds a `ResolutionIndex`
 * from the ledger before detection runs and injects it downward.
 *
 * **Totality matters.** Status is reduced on every render, and the ledger is append-only. If an unhandled
 * transition threw, one bad decision would make every screen throw forever, with no way to remove it short of
 * a reset. So the reducer never throws: an illegal or ineligible decision is marked `ignored` and leaves the
 * status untouched. Rejection happens on the write path, where the user can be told why.
 */

import { isSettled, roleForWaitingState, TRANSITIONS, waitingStateFor } from './workflow';
import type {
  ExceptionId, ProjectId,
} from './ids';
import type { Role } from './entities';
import type { IsoDate } from './dates';
import type {
  ResolutionEntry, ResolutionIndex, ReviewDecision, TaskStatus,
} from './workflow';

/** How a task was routed when it was created, needed to know its starting waiting state. */
export type RoutedException = {
  exceptionId: ExceptionId;
  projectId: ProjectId | null;
  ownerRole: Role;
  createdAt: IsoDate;
};

/** Why a decision was refused. Surfaced by the API on the write path; recorded as `ignored` on replay. */
export type DecisionRejection =
  | { kind: 'ILLEGAL_TRANSITION'; from: TaskStatus; reason: string }
  | { kind: 'WRONG_ROLE'; requiredRole: Role; actualRole: Role; reason: string }
  | { kind: 'INELIGIBLE_SUBJECT'; reason: string }
  | { kind: 'EFFECTIVE_DATE_AFTER_CLOSE'; reason: string };

/**
 * Decide whether a decision may be applied to a task in a given state.
 *
 * One predicate, used on both paths: `validateDecision` calls it to reject a bad POST with a reason, and
 * `buildResolutionIndex` calls it to mark a bad ledger entry `ignored`. Without the second use, a
 * hand-written test ledger — which is how the demos are written — could bypass validation entirely and inject
 * an adjustment that moves EAC.
 */
export function checkTransition(
  current: TaskStatus,
  decision: ReviewDecision,
  closeDate: IsoDate,
): DecisionRejection | null {
  if (decision.effectiveDate > closeDate) {
    return {
      kind: 'EFFECTIVE_DATE_AFTER_CLOSE',
      reason: `Effective date ${decision.effectiveDate} is after the close date ${closeDate}.`,
    };
  }

  const candidates = TRANSITIONS.filter(
    (t) => t.from === current && t.decision === decision.payload.type,
  );

  if (candidates.length === 0) {
    return {
      kind: 'ILLEGAL_TRANSITION',
      from: current,
      reason: `A ${decision.payload.type} decision is not available from ${current}.`,
    };
  }

  const roleMatch = candidates.find(
    (t) => t.requiredRole === null || t.requiredRole === decision.actor.role,
  );

  if (!roleMatch) {
    const required = candidates[0]!.requiredRole!;
    return {
      kind: 'WRONG_ROLE',
      requiredRole: required,
      actualRole: decision.actor.role,
      reason: `${decision.payload.type} requires the ${required} role; actor is ${decision.actor.role}.`,
    };
  }

  return null;
}

/** The state a decision moves a task to, assuming `checkTransition` allowed it. */
function nextStatus(current: TaskStatus, decision: ReviewDecision): TaskStatus {
  const match = TRANSITIONS.find(
    (t) =>
      t.from === current &&
      t.decision === decision.payload.type &&
      (t.requiredRole === null || t.requiredRole === decision.actor.role),
  );
  return match ? match.to : current;
}

/**
 * Reduce the decisions attached to one exception into its current status.
 *
 * An agent creates a task `OPEN` and routes it in the same run, so the starting state is the waiting state
 * for the owning role. `OPEN` is modelled only so the audit trail can show `TASK_CREATED` and `TASK_ROUTED`
 * as distinct steps; it is never a resting state.
 */
export function taskStatusFor(
  ownerRole: Role,
  decisions: readonly ReviewDecision[],
  closeDate: IsoDate,
  isEligible: (decision: ReviewDecision) => DecisionRejection | null = () => null,
): ResolutionEntry {
  let status: TaskStatus = waitingStateFor(ownerRole);
  const ignoredDecisionIds: string[] = [];
  let lastDecisionAt: IsoDate | null = null;
  let settledWaitingRole: Role | null = null;

  for (const decision of decisions) {
    const rejection = checkTransition(status, decision, closeDate) ?? isEligible(decision);
    if (rejection) {
      ignoredDecisionIds.push(decision.id);
      continue;
    }
    const before = status;
    status = nextStatus(status, decision);
    lastDecisionAt = decision.effectiveDate;
    // Remember who held it at the moment it settled, so a settled task is attributed to them rather than
    // reverting to whoever the rule originally routed it to.
    if (isSettled(status) && !isSettled(before)) settledWaitingRole = roleForWaitingState(before);
  }

  return { status, ignoredDecisionIds, lastDecisionAt, settledWaitingRole };
}

/**
 * Build the resolution index for a prefix of the ledger.
 *
 * Prefix-scoped on purpose: building it once from the whole ledger would show tasks as resolved at step 0,
 * before the resolving decision existed. Every final-state test would still pass while the replayed demo
 * timeline was quietly wrong.
 */
export function buildResolutionIndex(
  routed: readonly RoutedException[],
  decisions: readonly ReviewDecision[],
  closeDate: IsoDate,
  isEligible: (decision: ReviewDecision) => DecisionRejection | null = () => null,
): ResolutionIndex {
  const byException = new Map<ExceptionId, ReviewDecision[]>();
  for (const decision of decisions) {
    const list = byException.get(decision.exceptionId);
    if (list) list.push(decision);
    else byException.set(decision.exceptionId, [decision]);
  }

  const roleByException = new Map<ExceptionId, Role>();
  for (const r of routed) roleByException.set(r.exceptionId, r.ownerRole);

  const index = new Map<ExceptionId, ResolutionEntry>();
  for (const [exceptionId, exceptionDecisions] of byException) {
    // An exception the current detection pass did not produce can still carry decisions (it may have been
    // cleared by an earlier answer). Default to the role implied by the first decision's actor.
    const ownerRole = roleByException.get(exceptionId) ?? exceptionDecisions[0]!.actor.role;
    index.set(exceptionId, taskStatusFor(ownerRole, exceptionDecisions, closeDate, isEligible));
  }

  // Exceptions detected but never decided sit in their routed waiting state.
  for (const r of routed) {
    if (!index.has(r.exceptionId)) {
      index.set(r.exceptionId, {
        status: waitingStateFor(r.ownerRole),
        ignoredDecisionIds: [],
        lastDecisionAt: null,
        settledWaitingRole: null,
      });
    }
  }

  return index;
}

/** The set of decision ids that must not be projected into any number. */
export function ignoredDecisionIds(index: ResolutionIndex): ReadonlySet<string> {
  const ignored = new Set<string>();
  for (const entry of index.values()) {
    for (const id of entry.ignoredDecisionIds) ignored.add(id);
  }
  return ignored;
}

/** Whether an exception counts as resolved for suppression purposes. */
export function isResolved(index: ResolutionIndex, exceptionId: ExceptionId): boolean {
  const entry = index.get(exceptionId);
  return entry !== undefined && isSettled(entry.status);
}
