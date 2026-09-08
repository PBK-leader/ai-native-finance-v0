/**
 * The rule engine: run all 24 rules, then apply precedence.
 *
 * Suppression exists because related problems on the same record should produce one task, not three. An
 * invoice that is a duplicate should not also be chased as a missing posting; a change order missing from the
 * schedule of values should not also be chased as unbilled, because it cannot be billed until the line
 * exists.
 *
 * Two properties matter here:
 *
 * - **Suppression is a single fixed pass**, not iterated to a fixpoint. Every precedence rule reads the
 *   resolution index, which was built from the ledger *before* detection ran, so nothing depends on the
 *   output of the same pass and there is no ordering hazard.
 * - **Suppressed exceptions are kept**, tagged with what suppressed them, so the UI can explain why no task
 *   exists rather than silently omitting one.
 *
 * The oracle in `expected_rule_counts.csv` counts the *unsuppressed* set at the zero-decision baseline.
 * `AP_MISSING_POSTING` is 1 there because of two separate effects: three invoices are approved-but-unposted,
 * one of them (`INV-00090`) is only two days past approval and so is not yet late, and of the two that are
 * late one is the suppressed duplicate. The overrun precedence below is therefore correct but unexercised on
 * this data set — it would bite if the close date moved later.
 */

import { exceptionId as makeExceptionId } from '@/domain/ids';
import { isResolved } from '@/domain/taskStatus';
import type { ExceptionId, ProjectId } from '@/domain/ids';
import type { ExceptionRecord, RuleId } from '@/domain/workflow';
import { dataQualityRules } from './rules/dataQuality';
import { apRules } from './rules/ap';
import { forecastRules } from './rules/forecast';
import { billingRules } from './rules/billing';
import type { Rule, RuleContext } from './types';

/** The registry. A plain array — no loader, no dependency injection, no dynamic discovery. */
export const ALL_RULES: readonly Rule[] = [
  ...dataQualityRules,
  ...apRules,
  ...forecastRules,
  ...billingRules,
];

export const RULE_BY_ID: ReadonlyMap<RuleId, Rule> = new Map(ALL_RULES.map((rule) => [rule.id, rule]));

export type DetectionResult = {
  /** Exceptions that survived precedence and will become tasks. */
  unsuppressed: ExceptionRecord[];
  /** Exceptions a higher-precedence rule silenced, retained so the UI can explain the absence. */
  suppressed: ExceptionRecord[];
  /** Everything detected this pass, suppressed or not. */
  all: ExceptionRecord[];
};

/** Run every rule and assemble exception records with deterministic identity. */
function detectAll(ctx: RuleContext): ExceptionRecord[] {
  const records: ExceptionRecord[] = [];

  for (const rule of ALL_RULES) {
    for (const detected of rule.evaluate(ctx)) {
      records.push({
        id: makeExceptionId(rule.id, detected.projectId, detected.subjectId),
        ruleId: rule.id,
        projectId: detected.projectId,
        workstream: rule.workstream,
        severity: detected.severity,
        blocking: rule.blocking,
        blockingScope: rule.blockingScope,
        title: detected.title,
        explanation: detected.explanation,
        impact: detected.impact,
        impactUnit: detected.impactUnit,
        recommendedAction: detected.recommendedAction,
        ownerRole: detected.ownerRole ?? rule.defaultOwnerRole,
        evidence: detected.evidence,
        subjectId: detected.subjectId,
        suppressedBy: null,
        currentlyTriggering: true,
      });
    }
  }

  return records;
}

/**
 * Apply the precedence table from `EXCEPTION_RULES_V0.md`.
 *
 * Rules 1, 2 and 4 are conditional on resolution state — "until the duplicate review is resolved", "while the
 * overrun remains unresolved". Once a human settles the higher-precedence problem, the suppressed exception
 * is released and becomes a task in its own right. That is deliberate: fixing the schedule of values on an
 * approved change order is exactly what reveals that it is also unbilled.
 */
function applySuppression(records: ExceptionRecord[], ctx: RuleContext): void {
  const byRule = new Map<RuleId, ExceptionRecord[]>();
  for (const record of records) {
    const list = byRule.get(record.ruleId);
    if (list) list.push(record);
    else byRule.set(record.ruleId, [record]);
  }

  const unresolved = (record: ExceptionRecord): boolean => !isResolved(ctx.resolutionIndex, record.id);
  const suppress = (record: ExceptionRecord, by: ExceptionId): void => {
    record.suppressedBy = by;
  };

  // 1. A duplicate invoice is not chased for a missing posting until the duplicate question is settled.
  const duplicates = byRule.get('AP_DUPLICATE') ?? [];
  const missingPostings = byRule.get('AP_MISSING_POSTING') ?? [];
  for (const duplicate of duplicates) {
    if (!unresolved(duplicate)) continue;
    for (const posting of missingPostings) {
      if (posting.subjectId === duplicate.subjectId) suppress(posting, duplicate.id);
    }
  }

  // 2. An invoice held because it breaches its purchase order is not also chased for posting, however old.
  //    Only the invoices that actually take cumulative invoicing past the committed amount are held — on a
  //    PO with a dozen invoices, silencing all of them would let one genuinely stale invoice hide behind an
  //    unrelated overrun, understating cost to date with no task anywhere to recover it.
  for (const overrun of byRule.get('AP_COMMITMENT_OVERRUN') ?? []) {
    if (!unresolved(overrun)) continue;

    const commitment = ctx.model.index.commitmentById.get(overrun.subjectId as never);
    if (!commitment) continue;

    // Walk the invoices in the order they were approved; everything past the commitment is what is held.
    const chronological = ctx.view
      .validInvoicesForCommitment(commitment.id, ctx.asOfDate)
      .slice()
      .sort((a, b) => {
        const left = a.approvedDate ?? a.invoiceDate;
        const right = b.approvedDate ?? b.invoiceDate;
        if (left !== right) return left < right ? -1 : 1;
        return a.id < b.id ? -1 : 1;
      });

    const heldInvoiceIds = new Set<string>();
    let cumulative = 0;
    for (const invoice of chronological) {
      cumulative += invoice.amount;
      if (cumulative > commitment.committedAmount) heldInvoiceIds.add(invoice.id);
    }

    for (const posting of missingPostings) {
      if (posting.suppressedBy === null && heldInvoiceIds.has(posting.subjectId)) {
        suppress(posting, overrun.id);
      }
    }
  }

  // 3. An unmapped cost code is a mapping problem, not a budgeting problem. Report it once.
  const unmappedCodes = byRule.get('DQ_UNMAPPED_COST_CODE') ?? [];
  for (const unmapped of unmappedCodes) {
    if (!unresolved(unmapped)) continue;
    for (const unbudgeted of byRule.get('DQ_UNBUDGETED_COST') ?? []) {
      if (unbudgeted.subjectId === unmapped.subjectId) suppress(unbudgeted, unmapped.id);
    }
  }

  // 4. A change order missing from the schedule of values cannot be billed, so do not also chase the billing.
  for (const missingSov of byRule.get('CO_MISSING_SOV') ?? []) {
    if (!unresolved(missingSov)) continue;
    for (const unbilled of byRule.get('CO_APPROVED_UNBILLED') ?? []) {
      if (unbilled.subjectId === missingSov.subjectId) suppress(unbilled, missingSov.id);
    }
  }

  // Rule 5 (pending invoices never reach AP_MISSING_POSTING) is enforced inside the rule itself, because a
  // pending invoice is not late — it has not been approved yet.
}

export function detectExceptions(ctx: RuleContext): DetectionResult {
  const all = detectAll(ctx);
  applySuppression(all, ctx);

  return {
    all,
    unsuppressed: all.filter((record) => record.suppressedBy === null),
    suppressed: all.filter((record) => record.suppressedBy !== null),
  };
}

/** Group exceptions by project, for portfolio and project screens. */
export function groupByProject(
  records: readonly ExceptionRecord[],
): Map<ProjectId | null, ExceptionRecord[]> {
  const grouped = new Map<ProjectId | null, ExceptionRecord[]>();
  for (const record of records) {
    const list = grouped.get(record.projectId);
    if (list) list.push(record);
    else grouped.set(record.projectId, [record]);
  }
  return grouped;
}
