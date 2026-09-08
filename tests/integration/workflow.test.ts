/**
 * Workflow and agent-loop tests: the three required demos, plus the invariants that keep the numbers honest.
 *
 * Every test is `replay(model, buildView, config, [decisions])` and an assertion. There are no mocks and no
 * fixtures, because all derived state is a pure function of the decision ledger.
 */

import { describe, expect, it } from 'vitest';
import { V0_CONFIG } from '@/config/v0Config';
import { getNormalized } from '@/data/normalize/model';
import { buildReconciledView } from '@/reconciliation/buildReconciledView';
import type { CanonicalModel } from '@/domain/entities';
import type { DecisionProjection } from '@/domain/workflow';
import {
  changeOrderId, commitmentId, costCodeId, exceptionId, laborAggregateId, personId, projectId,
} from '@/domain/ids';
import type { ProjectId } from '@/domain/ids';
import { replay, type EngineState } from '@/workflows/replay';
import {
  demoChangeOrderBilling, demoCloseP1004, demoLaborDeterioration, demoReceivedNotInvoiced,
} from '@/workflows/demos';
import type { ReviewDecision } from '@/domain/workflow';

const { model, reconciliationKeys } = getNormalized();
const buildView = (m: CanonicalModel, projection: DecisionProjection) =>
  buildReconciledView(m, reconciliationKeys, projection);

const run = (decisions: readonly ReviewDecision[] = []): EngineState =>
  replay(model, buildView, V0_CONFIG, decisions);

const P1001 = projectId('P-1001');
const P1004 = projectId('P-1004');

const metrics = (state: EngineState, id: ProjectId) => state.current.metricsByProject.get(id)!;
const baseline = run();

// ---------------------------------------------------------------------------------------------------------

describe('the baseline agent run', () => {
  it('opens a task for every unsuppressed exception and routes each one to a person', () => {
    expect(baseline.current.tasks.length).toBeGreaterThan(0);

    for (const task of baseline.current.tasks) {
      expect(task.status).toMatch(/^WAITING_FOR_/);
      expect(task.requestedAction.length).toBeGreaterThan(10);
      // Portfolio-level data-quality items have no project, so no project manager to name.
      if (task.projectId !== null) expect(task.ownerPersonId).not.toBeNull();
    }
  });

  it('records the observe → detect → create → route loop in the activity trail', () => {
    const types = baseline.current.actions.map((a) => a.type);
    expect(types).toContain('OBSERVED');
    expect(types).toContain('EXCEPTION_DETECTED');
    expect(types).toContain('TASK_CREATED');
    expect(types).toContain('TASK_ROUTED');
  });

  it('runs the detection agents before the close orchestrator', () => {
    const agentOrder = [...new Set(baseline.current.actions.map((a) => a.agentId))];
    expect(agentOrder.at(-1)).toBe('CLOSE_ORCHESTRATOR');
  });

  it('holds every project with a blocking task out of close-ready', () => {
    const portfolioReady = baseline.current.portfolioReadiness.ready;

    for (const [id, readiness] of baseline.current.closeReadiness) {
      const blocking = baseline.current.tasks.filter(
        (t) => t.projectId === id && t.blocking && t.status.startsWith('WAITING'),
      );
      // A project is ready only when its own items are clear AND no portfolio-level problem holds the close.
      expect(readiness.ready).toBe(blocking.length === 0 && portfolioReady);
      expect(readiness.heldByPortfolioIssue).toBe(blocking.length === 0 && !portfolioReady);
    }
  });

  it('is deterministic — replaying the same ledger twice gives the same answer', () => {
    const a = run(demoLaborDeterioration);
    const b = run(demoLaborDeterioration);
    expect(a.current.tasks).toEqual(b.current.tasks);
    expect(a.current.actions).toEqual(b.current.actions);
    expect(metrics(a, P1001).eac).toBe(metrics(b, P1001).eac);
  });
});

// ---------------------------------------------------------------------------------------------------------

describe('Demo 1 — labour deterioration changes the forecast and reaches the Controller', () => {
  const after = run(demoLaborDeterioration);
  const before = metrics(baseline, P1001);
  const now = metrics(after, P1001);

  it('raises forecast final cost by the amount the PM added', () => {
    // Remaining uncommitted cost on 260200 moved from 320,000 to 445,000.
    expect(now.eac - before.eac).toBeCloseTo(125_000, 2);
    expect(now.pmRemainingUncommittedCost - before.pmRemainingUncommittedCost).toBeCloseTo(125_000, 2);
  });

  it('reduces projected profit and margin', () => {
    expect(now.projectedProfit).toBeLessThan(before.projectedProfit);
    expect(now.projectedMarginPct!).toBeLessThan(before.projectedMarginPct!);
  });

  it('records the response and the recomputation in the audit trail', () => {
    const types = after.current.actions.map((a) => a.type);
    expect(types).toContain('RESPONSE_INCORPORATED');
    expect(types).toContain('ANALYSIS_RERUN');
  });

  it('escalates to the Controller because the movement is material', () => {
    const review = after.current.tasks.find((t) => t.exceptionId.startsWith('CLOSE_CONTROLLER_REVIEW'));
    expect(review).toBeDefined();
    expect(review!.ownerRole).toBe('Controller');
    expect(review!.blocking).toBe(true);
    expect(after.current.actions.some((a) => a.type === 'ESCALATED')).toBe(true);
  });

  it('marks the labour-burn task resolved', () => {
    const task = after.current.tasks.find(
      (t) => t.exceptionId === exceptionId('FC_LABOR_BURN', P1001, costCodeId(P1001, '260200')),
    );
    expect(task?.status).toBe('RESOLVED');
  });
});

// ---------------------------------------------------------------------------------------------------------

describe('Demo 2 — received-not-invoiced moves timing, not the forecast', () => {
  const after = run(demoReceivedNotInvoiced);
  const before = metrics(baseline, P1001);
  const now = metrics(after, P1001);

  it('moves $120,000 from remaining commitment into cost to date', () => {
    expect(now.adjustedCostToDate - before.adjustedCostToDate).toBeCloseTo(120_000, 2);
    expect(before.remainingCommitment - now.remainingCommitment).toBeCloseTo(120_000, 2);
    expect(now.acceptedRni).toBeCloseTo(120_000, 2);
  });

  it('leaves forecast final cost unchanged — the RNI invariant', () => {
    // The whole point: the obligation was already inside the commitment, so recognising it earlier changes
    // when cost lands, not how much the job will finally cost.
    expect(now.eac).toBeCloseTo(before.eac, 2);
    expect(now.projectedProfit).toBeCloseTo(before.projectedProfit, 2);
  });

  it('does change percent complete, earned revenue and the billing position', () => {
    expect(now.percentCompletePct!).toBeGreaterThan(before.percentCompletePct!);
    expect(now.draftEarnedRevenue!).toBeGreaterThan(before.draftEarnedRevenue!);
    expect(now.billingPosition!).toBeLessThan(before.billingPosition!);
  });

  it('is idempotent — accepting the same adjustment twice is the same as accepting it once', () => {
    const twice = run([
      ...demoReceivedNotInvoiced,
      { ...demoReceivedNotInvoiced[0]!, id: 'DEC-DEMO2-RNI-REPEAT' },
    ]);
    expect(metrics(twice, P1001).acceptedRni).toBeCloseTo(120_000, 2);
    expect(metrics(twice, P1001).adjustedCostToDate).toBeCloseTo(now.adjustedCostToDate, 2);
  });

  it('refuses an adjustment larger than the received-not-invoiced gap', () => {
    const overreach = run([
      {
        ...demoReceivedNotInvoiced[0]!,
        id: 'DEC-OVERREACH',
        payload: {
          type: 'ACCEPT_ADJUSTMENT',
          adjustmentType: 'RNI',
          subjectId: commitmentId('PO-0004'),
          amount: 500_000,
          note: 'Too much.',
        },
      },
    ]);
    expect(overreach.ignored).toHaveLength(1);
    expect(metrics(overreach, P1001).acceptedRni).toBe(0);
  });
});

// ---------------------------------------------------------------------------------------------------------

describe('Demo 3 — recording the missing SOV line clears the blocking billing exceptions', () => {
  const after = run(demoChangeOrderBilling);
  const before = metrics(baseline, P1004);
  const now = metrics(after, P1004);

  it('starts with the schedule of values $420,000 short of the revised contract', () => {
    expect(before.sovVarianceToRevisedContract).toBeCloseTo(-420_000, 2);
  });

  it('reconciles the schedule of values after the correction', () => {
    expect(now.sovVarianceToRevisedContract).toBeCloseTo(0, 2);
    expect(now.sovTotal).toBeCloseTo(now.revisedContractValue, 2);
  });

  it('clears both the missing-SOV and SOV-mismatch exceptions', () => {
    const stillTriggering = after.current.exceptions.filter((e) => e.currentlyTriggering);
    expect(stillTriggering.some((e) => e.ruleId === 'CO_MISSING_SOV' && e.projectId === P1004)).toBe(false);
    expect(stillTriggering.some((e) => e.ruleId === 'BILL_SOV_MISMATCH' && e.projectId === P1004)).toBe(false);
  });

  it('reports the clearance in the audit trail rather than leaving it to be inferred', () => {
    const cleared = after.current.actions.filter((a) => a.type === 'EXCEPTION_CLEARED');
    expect(cleared.length).toBeGreaterThan(0);
  });

  it('reveals the previously suppressed unbilled change order', () => {
    // Fixing the data problem surfaces $420,000 of approved work that was never billed. This is the intended
    // cascade, not a regression: the suppression that hid it is lifted once the SOV line exists.
    const unbilled = after.current.exceptions.find(
      (e) =>
        e.ruleId === 'CO_APPROVED_UNBILLED' &&
        e.subjectId === changeOrderId('CO-1004-A') &&
        e.currentlyTriggering,
    );
    expect(unbilled).toBeDefined();
    expect(unbilled!.suppressedBy).toBeNull();
    expect(unbilled!.blocking).toBe(false);
  });

  it('does not make the project close-ready on its own — other blocking items remain', () => {
    expect(after.current.closeReadiness.get(P1004)!.ready).toBe(false);
  });

  it('is idempotent — recording the same correction twice adds one SOV line, not two', () => {
    const twice = run([
      ...demoChangeOrderBilling,
      { ...demoChangeOrderBilling[0]!, id: 'DEC-DEMO3-SOV-REPEAT' },
    ]);
    expect(metrics(twice, P1004).sovVarianceToRevisedContract).toBeCloseTo(0, 2);
  });
});

// ---------------------------------------------------------------------------------------------------------

describe('the full close walkthrough reaches close-ready', () => {
  const after = run(demoCloseP1004);

  it('holds every project out of close-ready while the unmapped source project is open', () => {
    // Before the walkthrough, DQ_PROJECT_MAP has no canonical project — so it belongs to no project's
    // blocking set. It must still hold the close, or a HIGH exception marked "blocking" would block nothing.
    expect(baseline.current.portfolioReadiness.ready).toBe(false);
    for (const readiness of baseline.current.closeReadiness.values()) {
      expect(readiness.ready).toBe(false);
    }
    // P-1003 and P-1006 have no blocking items of their own — they are held only by the portfolio issue.
    expect(baseline.current.closeReadiness.get(projectId('P-1003'))!.heldByPortfolioIssue).toBe(true);
    expect(baseline.current.closeReadiness.get(projectId('P-1006'))!.heldByPortfolioIssue).toBe(true);
  });

  it('resolves or explicitly accepts every blocking item on P-1004', () => {
    const blocking = after.current.tasks.filter((t) => t.projectId === P1004 && t.blocking);
    const unsettled = blocking.filter((t) => t.status.startsWith('WAITING'));
    expect(
      unsettled.map((t) => `${t.exceptionId} (${t.status})`),
      'still blocking',
    ).toEqual([]);
  });

  it('marks the project ready to close', () => {
    expect(after.current.closeReadiness.get(P1004)!.ready).toBe(true);
  });

  it('preserves the Controller risk acceptance with its rationale', () => {
    const accepted = after.current.tasks.find(
      (t) => t.exceptionId === exceptionId('AP_COMMITMENT_OVERRUN', P1004, commitmentId('PO-0023')),
    );
    expect(accepted?.status).toBe('ACCEPTED_RISK');

    const decision = after.decisions.find((d) => d.payload.type === 'ACCEPT_RISK');
    expect(decision).toBeDefined();
    expect(decision!.actor.role).toBe('Controller');
  });

  it('routes an escalation through the Controller rather than resolving it directly', () => {
    const escalate = after.decisions.find((d) => d.payload.type === 'ESCALATE')!;
    const step = after.snapshots.find((s) => s.triggeringDecisionId === escalate.id)!;
    const task = step.tasks.find((t) => t.exceptionId === escalate.exceptionId);
    expect(task?.status).toBe('WAITING_FOR_CONTROLLER');
  });

  it('reports the close-status change', () => {
    const changed = after.current.actions.filter((a) => a.type === 'CLOSE_STATUS_CHANGED');
    expect(changed.some((a) => a.projectId === P1004)).toBe(true);
  });

  it('records unposted labour without touching commitments', () => {
    const before = metrics(baseline, P1004);
    const now = metrics(after, P1004);
    expect(now.acceptedUnpostedLabor).toBeCloseTo(17_752, 2);
    // Labour is not a commitment, so accepting it must not reduce one.
    expect(now.remainingCommitment).toBeCloseTo(before.remainingCommitment, 2);
  });
});

// ---------------------------------------------------------------------------------------------------------

describe('the workflow refuses decisions it should refuse', () => {
  const overrunException = exceptionId('AP_COMMITMENT_OVERRUN', P1004, commitmentId('PO-0023'));

  it('rejects a decision from the wrong role without breaking the engine', () => {
    const state = run([
      {
        id: 'DEC-WRONG-ROLE',
        exceptionId: overrunException,
        subject: { projectId: P1004, canonicalId: commitmentId('PO-0023') },
        // A project manager cannot accept risk — that is a Controller judgement.
        actor: { personId: personId('PERS-PM4'), role: 'Project Manager' },
        effectiveDate: V0_CONFIG.closeDate,
        recordedAt: `${V0_CONFIG.closeDate}T09:00:00.000Z`,
        payload: { type: 'ACCEPT_RISK', rationale: 'Looks fine to me, proceeding.' },
      },
    ]);

    expect(state.ignored).toHaveLength(1);
    expect(state.ignored[0]!.reason).toContain('Controller');
    // The engine still produced a full, usable state — a bad decision cannot brick the app.
    expect(state.current.tasks.length).toBeGreaterThan(0);
  });

  it('rejects an accrual against an invoice that already posted', () => {
    const posted = model.apInvoices.find((i) => i.postingStatus === 'posted')!;
    const state = run([
      {
        id: 'DEC-DOUBLE-COUNT',
        exceptionId: exceptionId('AP_MISSING_POSTING', posted.projectId, posted.id),
        subject: { projectId: posted.projectId, canonicalId: posted.id },
        actor: { personId: personId('PERS-PA1'), role: 'Project Accountant' },
        effectiveDate: V0_CONFIG.closeDate,
        recordedAt: `${V0_CONFIG.closeDate}T09:00:00.000Z`,
        payload: {
          type: 'ACCEPT_ADJUSTMENT',
          adjustmentType: 'AP_UNPOSTED',
          subjectId: posted.id,
          amount: posted.amount,
          note: 'Accruing.',
        },
      },
    ]);

    expect(state.ignored).toHaveLength(1);
    expect(state.ignored[0]!.reason).toContain('already posted');
    expect(metrics(state, posted.projectId).acceptedApUnposted).toBe(0);
  });

  it('rejects an accrual against the suppressed duplicate invoice', () => {
    const duplicate = [...baseline.current.exceptions].find((e) => e.ruleId === 'AP_DUPLICATE')!;
    const state = run([
      {
        id: 'DEC-ACCRUE-DUPLICATE',
        exceptionId: duplicate.id,
        subject: { projectId: duplicate.projectId, canonicalId: duplicate.subjectId },
        actor: { personId: personId('PERS-PA1'), role: 'Project Accountant' },
        effectiveDate: V0_CONFIG.closeDate,
        recordedAt: `${V0_CONFIG.closeDate}T09:00:00.000Z`,
        payload: {
          type: 'ACCEPT_ADJUSTMENT',
          adjustmentType: 'AP_UNPOSTED',
          subjectId: duplicate.subjectId,
          amount: 75_920,
          note: 'Accruing the duplicate.',
        },
      },
    ]);

    expect(state.ignored).toHaveLength(1);
    expect(state.ignored[0]!.reason).toContain('duplicate');
    expect(metrics(state, P1001).acceptedApUnposted).toBe(0);
  });

  it('rejects a decision dated after the close', () => {
    const state = run([
      { ...demoReceivedNotInvoiced[0]!, id: 'DEC-FUTURE', effectiveDate: '2026-09-30' },
    ]);
    expect(state.ignored).toHaveLength(1);
    expect(metrics(state, P1001).acceptedRni).toBe(0);
  });
});

// ---------------------------------------------------------------------------------------------------------

describe('resolving one issue does not resolve unrelated ones', () => {
  const after = run(demoReceivedNotInvoiced);

  it('leaves other projects untouched', () => {
    for (const id of baseline.current.metricsByProject.keys()) {
      if (id === P1001) continue;
      expect(metrics(after, id).eac).toBeCloseTo(metrics(baseline, id).eac, 2);
    }
  });

  it('leaves the other two RNI tasks open', () => {
    const openRni = after.current.tasks.filter(
      (t) => t.exceptionId.startsWith('AP_RNI') && t.status.startsWith('WAITING'),
    );
    expect(openRni).toHaveLength(2);
  });
});

describe('the labour adjustment is idempotent too', () => {
  it('accepting unposted labour twice adds the cost once', () => {
    const decision = demoCloseP1004.find((d) => d.id === 'DEC-CLOSE-LABOR')!;
    const once = run([decision]);
    const twice = run([decision, { ...decision, id: 'DEC-CLOSE-LABOR-REPEAT' }]);
    expect(metrics(twice, P1004).acceptedUnpostedLabor).toBeCloseTo(
      metrics(once, P1004).acceptedUnpostedLabor,
      2,
    );
    expect(metrics(twice, P1004).eac).toBeCloseTo(metrics(once, P1004).eac, 2);
  });

  it('adds exactly the estimated cost of the 40 unposted entries', () => {
    const aggregate = model.index.laborAggregateById.get(laborAggregateId(P1004, '260200'))!;
    expect(aggregate.unposted.entryCount).toBe(40);
    expect(aggregate.unposted.cost).toBeCloseTo(17_752, 2);
  });
});
