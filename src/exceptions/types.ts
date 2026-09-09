/**
 * The exception rule engine contract.
 *
 * A rule reads canonical objects, a reconciled view, computed metrics and the config — never a raw CSV row
 * and never a hard-coded threshold. It returns detected exceptions with deterministic ids, so the same
 * condition always produces the same `exceptionId` and a human decision recorded against it survives every
 * recomputation.
 *
 * Rules are grouped into one file per workstream rather than one file per rule. The design called for
 * 24 files; five reads better at this size, each rule is still an independent exported object, and the
 * registry is a plain array literal with no loader or registry machinery.
 */

import type { V0Config } from '@/config/v0Config';
import type { IsoDate } from '@/domain/dates';
import type { CanonicalModel, Role } from '@/domain/entities';
import type { ProjectMetrics } from '@/domain/metrics';
import type { ProjectId } from '@/domain/ids';
import type { ReconciledView } from '@/domain/reconciliation';
import type {
  DecisionProjection, Evidence, ExceptionRecord, MeasureUnit, ResolutionIndex, RuleId, Severity, Workstream,
} from '@/domain/workflow';

export type RuleContext = {
  model: CanonicalModel;
  view: ReconciledView;
  projection: DecisionProjection;
  config: V0Config;
  /** Current-close metrics, by project. Computed once by the engine and shared by every rule. */
  metrics: ReadonlyMap<ProjectId, ProjectMetrics>;
  /** Prior-period metrics, reconstructed by the same code path with an empty projection. */
  priorMetrics: ReadonlyMap<ProjectId, ProjectMetrics>;
  /** Task status per exception, built from the decision ledger *before* detection runs. */
  resolutionIndex: ResolutionIndex;
  asOfDate: IsoDate;
};

/** What a rule returns. The engine adds identity, suppression state and ownership. */
export type DetectedException = {
  projectId: ProjectId | null;
  /** Canonical id of the object the rule reasons about — or a raw source key where none can exist. */
  subjectId: string;
  severity: Severity;
  title: string;
  explanation: string;
  impact: number | null;
  impactUnit: MeasureUnit | null;
  recommendedAction: string;
  evidence: Evidence;
  /** Overrides the rule's default owner, for rules that route differently case by case. */
  ownerRole?: Role;
};

export type Rule = {
  id: RuleId;
  workstream: Workstream;
  defaultOwnerRole: Role;
  blocking: boolean;
  blockingScope: 'CLOSE' | 'FORECAST_WIP';
  /** One-line statement of what the rule looks for, shown in the UI. */
  description: string;
  /**
   * How the finding is reached, one step per entry, for someone who will never read the code.
   *
   * It lives beside `evaluate` rather than in a table in the UI so the two cannot drift: a reviewer changing
   * what the rule tests has the sentence describing that test directly under their cursor. Steps describe
   * the actual sequence — which records are taken, what is compared, what makes it fire — because "show me
   * the evidence" is really the question "how did you get here", and a list of numbers does not answer it.
   */
  readonly method: readonly string[];
  evaluate(ctx: RuleContext): DetectedException[];
};

export type { ExceptionRecord };
