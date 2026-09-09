/**
 * Workflow type declarations: exceptions, tasks, decisions, agent actions — and the transition table.
 *
 * Task status is **derived**, not stored. There is no mutable task record that can fall out of sync with the
 * ledger: `taskStatusFor(exceptionId, decisions)` reduces the decisions attached to a deterministic
 * exception id. That is what makes "a resolved issue does not duplicate on rerun" true by construction
 * rather than by a check someone has to remember.
 */

import type { IsoDate } from './dates';
import type { Money } from './money';
import type { Role, SourceRef } from './entities';
import type { GraphLink } from './graph';
import type {
  ApInvoiceId, ChangeOrderId, CommitmentId, ExceptionId, LaborAggregateId, PersonId, ProjectId,
  SovItemId,
} from './ids';

// ---------------------------------------------------------------------------------------------------------
// Exceptions
// ---------------------------------------------------------------------------------------------------------

export type Workstream = 'Forecast' | 'AP' | 'Billing' | 'Change Orders' | 'Data Quality';

export type Severity = 'HIGH' | 'MEDIUM' | 'LOW';

export type RuleId =
  | 'DQ_PROJECT_MAP' | 'DQ_UNMAPPED_COST_CODE' | 'DQ_UNBUDGETED_COST'
  | 'AP_MISSING_POSTING' | 'LABOR_MISSING_POSTING' | 'FC_STALE'
  | 'AP_DUPLICATE' | 'AP_COMMITMENT_OVERRUN' | 'AP_COST_CODE_MISMATCH' | 'AP_RNI'
  | 'FC_MARGIN_FADE' | 'FC_EAC_DETERIORATION' | 'FC_COST_CODE_OVERRUN' | 'FC_LABOR_BURN'
  | 'FC_PM_CHANGE_NO_EXPLANATION' | 'FC_PROFIT_RISK_CONCENTRATION' | 'FC_COMPLETE_CODE_REMAINING'
  | 'CO_LARGE_AGING' | 'CO_UNAPPROVED_COST' | 'CO_MISSING_SOV' | 'CO_APPROVED_UNBILLED'
  | 'BILL_UNDERBILLING' | 'BILL_SOV_MISMATCH' | 'BILL_RETAINAGE'
  /** Reserved pseudo-rule owned by the Close Orchestrator. Excluded from oracle rule-count comparisons. */
  | 'CLOSE_CONTROLLER_REVIEW';

export type MeasureUnit = 'USD' | 'PCT' | 'PP' | 'DAYS' | 'HOURS' | 'COUNT';

export type Measured = { label: string; value: number | null; unit: MeasureUnit };

/**
 * A threshold that participated in the decision to fire.
 *
 * A list, not a single value, because six rules fire on two thresholds — `FC_COMPLETE_CODE_REMAINING`
 * (progress AND remaining), `BILL_UNDERBILLING` (dollars OR percent of contract), `FC_EAC_DETERIORATION`,
 * `CO_LARGE_AGING`, `FC_PM_CHANGE_NO_EXPLANATION`, and `AP_RNI`'s medium/high bands. A single field would
 * have forced the second threshold into narrative prose, putting a number outside the deterministic layer.
 */
export type ThresholdRef = {
  name: string;
  value: number;
  /** Must match the code exactly — a Controller reads this to verify the rule fired legitimately. */
  comparator: 'GT' | 'GTE' | 'LT' | 'LTE';
  met: boolean;
};

/** Everything needed to answer "what happened, why does it matter, and what proves it". */
export type Evidence = {
  /** Graph nodes for drill-down. */
  nodeIds: string[];
  /** The actual source records. Compared against the oracle's `source_record` in tests. */
  sourceRefs: SourceRef[];
  measured: Measured[];
  thresholds: ThresholdRef[];
};

export type ExceptionRecord = {
  id: ExceptionId;
  ruleId: RuleId;
  projectId: ProjectId | null;
  workstream: Workstream;
  severity: Severity;
  blocking: boolean;
  /** `FC_STALE` blocks the forecast/WIP workstream specifically; everything else blocks the close. */
  blockingScope: 'CLOSE' | 'FORECAST_WIP';
  title: string;
  explanation: string;
  /** Dollar or operational impact, where one is meaningful. */
  impact: Money | null;
  impactUnit: MeasureUnit | null;
  recommendedAction: string;
  ownerRole: Role;
  evidence: Evidence;
  /** The canonical id (or raw source key, for `DQ_PROJECT_MAP`) of the object the rule reasons about. */
  subjectId: string;
  /** Set when a higher-precedence rule suppressed this exception, so the UI can explain the absence. */
  suppressedBy: ExceptionId | null;
  /** False when the exception is retained only because a decision or a clear-event references it. */
  currentlyTriggering: boolean;
};

// ---------------------------------------------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------------------------------------------

export type TaskStatus =
  | 'OPEN'
  | 'WAITING_FOR_PM'
  | 'WAITING_FOR_ACCOUNTANT'
  | 'WAITING_FOR_CONTROLLER'
  | 'RESOLVED'
  | 'ACCEPTED_RISK';

export type Task = {
  id: string;
  exceptionId: ExceptionId;
  projectId: ProjectId | null;
  workstream: Workstream;
  ownerRole: Role;
  ownerPersonId: PersonId | null;
  blocking: boolean;
  status: TaskStatus;
  title: string;
  /** The specific input or action being requested — not a restatement of the problem. */
  requestedAction: string;
  evidence: Evidence;
  createdAt: IsoDate;
  updatedAt: IsoDate;
};

// ---------------------------------------------------------------------------------------------------------
// Decisions
// ---------------------------------------------------------------------------------------------------------

export type Actor = { personId: PersonId; role: Role };

export type AdjustmentType = 'RNI' | 'AP_UNPOSTED' | 'UNPOSTED_LABOR';

export type DecisionType =
  | 'PM_FORECAST_UPDATE'
  | 'PM_ANSWER'
  | 'ACCEPT_ADJUSTMENT'
  | 'REJECT_ADJUSTMENT'
  | 'RECORD_SOV_CORRECTION'
  | 'ESCALATE'
  | 'ACCEPT_RISK'
  | 'CONTROLLER_APPROVE';

/**
 * A single cost-code line of a PM forecast answer.
 *
 * The comment is per line, not per decision, because `FC_PM_CHANGE_NO_EXPLANATION` is keyed on the cost code.
 * A decision-level comment would let an explanation about one cost code clear the exception on nine others.
 */
export type ForecastLine = {
  costCode: string;
  remainingUncommittedCost: Money;
  remainingLaborHours: number | null;
  comment: string;
};

export type DecisionPayload =
  | { type: 'PM_FORECAST_UPDATE'; lines: ForecastLine[] }
  | { type: 'PM_ANSWER'; answer: string }
  | { type: 'ACCEPT_ADJUSTMENT'; adjustmentType: AdjustmentType; subjectId: string; amount: Money; note: string }
  | { type: 'REJECT_ADJUSTMENT'; reason: string }
  | { type: 'RECORD_SOV_CORRECTION'; changeOrderId: ChangeOrderId; scheduledValue: Money; retainagePct: number }
  | { type: 'ESCALATE'; reason: string }
  | { type: 'ACCEPT_RISK'; rationale: string }
  | { type: 'CONTROLLER_APPROVE'; note: string };

export type ReviewDecision = {
  id: string;
  exceptionId: ExceptionId;
  /**
   * Carried explicitly rather than parsed back out of `exceptionId`. Recovering a foreign key by splitting a
   * composite string is exactly the pattern this architecture bans elsewhere.
   */
  subject: { projectId: ProjectId | null; canonicalId: string };
  actor: Actor;
  /**
   * Business as-of date, defaulting to `config.closeDate` and never after it.
   *
   * Kept separate from `recordedAt` for a concrete reason: the close is 2026-07-31 but the demo runs later in
   * calendar time. An overlay forecast snapshot dated with the wall clock would fall after the as-of date, be
   * filtered out of "latest snapshot on or before asOf", and the PM's answer would silently fail to recompute
   * anything.
   */
  effectiveDate: IsoDate;
  /** Wall clock, stamped once in `src/app`. Display and ordering only. */
  recordedAt: string;
  payload: DecisionPayload;
};

// ---------------------------------------------------------------------------------------------------------
// Decision projection
// ---------------------------------------------------------------------------------------------------------

/**
 * Accepted management adjustments, keyed so that accepting the same thing twice is impossible.
 *
 * Keeping the three types separate is what prevents double counting: an accepted RNI also reduces remaining
 * commitment on its PO, whereas an accepted AP-unposted adjustment must not, because the valid invoice
 * already reduced it.
 */
export type AdjustmentSet = {
  acceptedRni: ReadonlyMap<CommitmentId, Money>;
  acceptedApUnposted: ReadonlyMap<ApInvoiceId, Money>;
  acceptedUnpostedLabor: ReadonlyMap<LaborAggregateId, Money>;
};

/**
 * Everything human decisions contribute to the derived picture.
 *
 * Every overlay is a keyed map with last-write-wins over the decision prefix, for the same reason
 * `AdjustmentSet` is: answering the same question twice must not produce two records.
 */
export type DecisionProjection = {
  adjustments: AdjustmentSet;
  forecastOverlay: ReadonlyMap<string, import('./entities').ForecastSnapshot>;
  sovOverlay: ReadonlyMap<SovItemId, import('./entities').SovItem>;
  linkOverlay: ReadonlyMap<string, GraphLink>;
  riskAcceptances: ReadonlyMap<ExceptionId, { rationale: string; actor: Actor }>;
};

export const EMPTY_PROJECTION: DecisionProjection = {
  adjustments: {
    acceptedRni: new Map(),
    acceptedApUnposted: new Map(),
    acceptedUnpostedLabor: new Map(),
  },
  forecastOverlay: new Map(),
  sovOverlay: new Map(),
  linkOverlay: new Map(),
  riskAcceptances: new Map(),
};

// ---------------------------------------------------------------------------------------------------------
// Resolution index
// ---------------------------------------------------------------------------------------------------------

export type ResolutionEntry = {
  status: TaskStatus;
  /** Decisions the reducer or the eligibility check refused to act on. They must not move any number. */
  ignoredDecisionIds: string[];
  lastDecisionAt: IsoDate | null;
  /**
   * Who had **custody** of the task when it settled — the role it was waiting on immediately before the
   * settling decision — so a settled task stays with whoever actually held it rather than reverting to the
   * rule's original routing. Without it, an item an accountant escalated and a Controller then approved would
   * flip back to the accountant on settlement, and the task, the work queue's settled view and the graph's
   * `ASSIGNED_TO` edge would all contradict the ledger.
   *
   * Custody, not **authorship**. A Controller may settle a task still waiting on a PM (they can accept a risk
   * on anything), and this then records the PM. Who decided is the ledger's job: `ReviewDecision.actor`, which
   * the card and the activity trail both render. Null while the task is open — the status names the role.
   */
  settledWaitingRole: Role | null;
};

export type ResolutionIndex = ReadonlyMap<ExceptionId, ResolutionEntry>;

// ---------------------------------------------------------------------------------------------------------
// The transition table — one source of truth for validation and reduction
// ---------------------------------------------------------------------------------------------------------

export type Transition = { from: TaskStatus; decision: DecisionType; requiredRole: Role | null; to: TaskStatus };

export const TRANSITIONS: readonly Transition[] = [
  { from: 'WAITING_FOR_PM', decision: 'PM_FORECAST_UPDATE', requiredRole: 'Project Manager', to: 'RESOLVED' },
  { from: 'WAITING_FOR_PM', decision: 'PM_ANSWER', requiredRole: 'Project Manager', to: 'RESOLVED' },

  { from: 'WAITING_FOR_ACCOUNTANT', decision: 'ACCEPT_ADJUSTMENT', requiredRole: 'Project Accountant', to: 'RESOLVED' },
  { from: 'WAITING_FOR_ACCOUNTANT', decision: 'REJECT_ADJUSTMENT', requiredRole: 'Project Accountant', to: 'RESOLVED' },
  { from: 'WAITING_FOR_ACCOUNTANT', decision: 'RECORD_SOV_CORRECTION', requiredRole: 'Project Accountant', to: 'RESOLVED' },

  { from: 'WAITING_FOR_PM', decision: 'ESCALATE', requiredRole: 'Project Manager', to: 'WAITING_FOR_CONTROLLER' },
  { from: 'WAITING_FOR_ACCOUNTANT', decision: 'ESCALATE', requiredRole: 'Project Accountant', to: 'WAITING_FOR_CONTROLLER' },

  { from: 'WAITING_FOR_PM', decision: 'ACCEPT_RISK', requiredRole: 'Controller', to: 'ACCEPTED_RISK' },
  { from: 'WAITING_FOR_ACCOUNTANT', decision: 'ACCEPT_RISK', requiredRole: 'Controller', to: 'ACCEPTED_RISK' },
  { from: 'WAITING_FOR_CONTROLLER', decision: 'ACCEPT_RISK', requiredRole: 'Controller', to: 'ACCEPTED_RISK' },

  { from: 'WAITING_FOR_CONTROLLER', decision: 'CONTROLLER_APPROVE', requiredRole: 'Controller', to: 'RESOLVED' },
];

/** Which waiting state a task enters when routed to a role. */
export function waitingStateFor(role: Role): TaskStatus {
  switch (role) {
    case 'Project Manager':
      return 'WAITING_FOR_PM';
    case 'Project Accountant':
      return 'WAITING_FOR_ACCOUNTANT';
    case 'Controller':
    case 'CFO':
      return 'WAITING_FOR_CONTROLLER';
  }
}

/**
 * The inverse of `waitingStateFor`: who a task in this state is waiting on. `null` once it is settled.
 * An escalation moves a task to `WAITING_FOR_CONTROLLER`; whoever it was routed to originally is no longer
 * the person it is waiting on, and every "on my desk" question must follow the status, not the routing.
 *
 * Lossy in one direction only: `waitingStateFor('CFO')` is `WAITING_FOR_CONTROLLER`, which comes back as
 * `Controller`. No rule routes to the CFO — the CFO consumes portfolio insight and holds no tasks — so the
 * collapse is correct rather than merely tolerable.
 */
export function roleForWaitingState(status: TaskStatus): Role | null {
  switch (status) {
    case 'WAITING_FOR_PM':
      return 'Project Manager';
    case 'WAITING_FOR_ACCOUNTANT':
      return 'Project Accountant';
    case 'WAITING_FOR_CONTROLLER':
      return 'Controller';
    default:
      return null;
  }
}

/** A task is off the board when a human has resolved it or explicitly accepted the risk. */
export function isSettled(status: TaskStatus): boolean {
  return status === 'RESOLVED' || status === 'ACCEPTED_RISK';
}

// ---------------------------------------------------------------------------------------------------------
// Agent actions
// ---------------------------------------------------------------------------------------------------------

export type AgentId = 'CLOSE_ORCHESTRATOR' | 'COST_CONTROL' | 'FORECAST' | 'BILLING_CO';

export type AgentActionType =
  | 'OBSERVED'
  | 'EXCEPTION_DETECTED'
  | 'TASK_CREATED'
  | 'TASK_ROUTED'
  | 'RESPONSE_INCORPORATED'
  | 'ANALYSIS_RERUN'
  | 'EXCEPTION_CLEARED'
  | 'ESCALATED'
  | 'CLOSE_STATUS_CHANGED';

export type AgentAction = {
  id: string;
  agentId: AgentId;
  type: AgentActionType;
  /** Replay step this action belongs to. Step 0 is the agents' baseline run. */
  step: number;
  projectId: ProjectId | null;
  exceptionId: ExceptionId | null;
  /** The decision that triggered this step, if any. */
  triggeringDecisionId: string | null;
  summary: string;
  at: IsoDate;
};
