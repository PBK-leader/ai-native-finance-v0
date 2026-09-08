/**
 * Regression tests for everything the three independent reviewers found.
 *
 * Each of these reproduces a defect that shipped, passed 345 tests, and would have been invisible in a demo.
 * They are grouped by the reviewer that caught them so the history stays legible.
 */

import { describe, expect, it } from 'vitest';
import { V0_CONFIG } from '@/config/v0Config';
import { getNormalized } from '@/data/normalize/model';
import { buildReconciledView } from '@/reconciliation/buildReconciledView';
import { buildGraph } from '@/graph/build/buildGraph';
import { AGENTS } from '@/agents/agents';
import { ALL_RULES } from '@/exceptions/engine';
import { DisallowedAgentActionError, actionEmitter } from '@/agents/types';
import { replay, type EngineState } from '@/workflows/replay';
import { demoCloseP1004, demoLaborDeterioration, demoReceivedNotInvoiced } from '@/workflows/demos';
import { validateDecisionPayload } from '@/app/api/validateBody';
import { dollarExposure } from '@/calculations/portfolio';
import { commitmentId, costCodeId, exceptionId, personId, projectId } from '@/domain/ids';
import { EMPTY_PROJECTION, isSettled } from '@/domain/workflow';
import type { CanonicalModel } from '@/domain/entities';
import type { DecisionProjection, ForecastLine, ReviewDecision } from '@/domain/workflow';

const { model, reconciliationKeys } = getNormalized();
const buildView = (m: CanonicalModel, projection: DecisionProjection) =>
  buildReconciledView(m, reconciliationKeys, projection);
const run = (decisions: readonly ReviewDecision[] = []): EngineState =>
  replay(model, buildView, V0_CONFIG, decisions);

const P1001 = projectId('P-1001');
const P1004 = projectId('P-1004');
const PM = { personId: personId('PERS-PM1'), role: 'Project Manager' as const };
const ACCOUNTANT = { personId: personId('PERS-PA1'), role: 'Project Accountant' as const };
const CONTROLLER = { personId: personId('PERS-CTRL'), role: 'Controller' as const };

function forecastDecision(id: string, lines: ForecastLine[], overrides: Partial<ReviewDecision> = {}) {
  return {
    id,
    exceptionId: exceptionId('FC_LABOR_BURN', P1001, costCodeId(P1001, '260200')),
    subject: { projectId: P1001, canonicalId: costCodeId(P1001, '260200') },
    actor: PM,
    effectiveDate: V0_CONFIG.closeDate,
    recordedAt: `${V0_CONFIG.closeDate}T09:00:00.000Z`,
    payload: { type: 'PM_FORECAST_UPDATE' as const, lines },
    ...overrides,
  } as ReviewDecision;
}

// ---------------------------------------------------------------------------------------------------------
// The blocker: a Controller review disappeared on the next decision, producing a false close-ready.
// ---------------------------------------------------------------------------------------------------------

describe('a Controller review survives later, unrelated decisions', () => {
  const big = forecastDecision('DEC-BIG', [
    { costCode: '260200', remainingUncommittedCost: 900_000, remainingLaborHours: 20_000, comment: 'Bad.' },
  ]);

  // A decision on a completely different project, after the escalation.
  const unrelated: ReviewDecision = {
    ...demoReceivedNotInvoiced[0]!,
    id: 'DEC-UNRELATED',
  };

  it('still holds the project out of close-ready after an unrelated decision', () => {
    const escalated = run([big]);
    const review = escalated.current.tasks.find((t) => t.exceptionId.startsWith('CLOSE_CONTROLLER_REVIEW'));
    expect(review, 'the escalation should exist').toBeDefined();
    expect(escalated.current.closeReadiness.get(P1001)!.ready).toBe(false);

    const later = run([big, unrelated]);
    const stillThere = later.current.tasks.find((t) => t.exceptionId.startsWith('CLOSE_CONTROLLER_REVIEW'));

    // The review has no rule behind it, so nothing re-detects it. If it is not carried forward it vanishes,
    // and the project reports itself ready to close with the elevated forecast and no sign-off.
    expect(stillThere, 'the escalation must not vanish').toBeDefined();
    expect(stillThere!.status).toBe('WAITING_FOR_CONTROLLER');
    expect(later.current.closeReadiness.get(P1001)!.ready).toBe(false);
  });

  it('lets a Controller resolve it, and records the approval rather than dropping the task', () => {
    const escalated = run([big]);
    const reviewException = escalated.current.tasks.find((t) =>
      t.exceptionId.startsWith('CLOSE_CONTROLLER_REVIEW'),
    )!.exceptionId;

    const approved = run([
      big,
      {
        id: 'DEC-APPROVE',
        exceptionId: reviewException,
        subject: { projectId: P1001, canonicalId: 'DEC-BIG' },
        actor: CONTROLLER,
        effectiveDate: V0_CONFIG.closeDate,
        recordedAt: `${V0_CONFIG.closeDate}T16:00:00.000Z`,
        payload: { type: 'CONTROLLER_APPROVE', note: 'Reviewed the re-estimate with the PM. Approved.' },
      },
    ]);

    const task = approved.current.tasks.find((t) => t.exceptionId === reviewException);
    expect(task, 'an approved review should still be visible').toBeDefined();
    expect(task!.status).toBe('RESOLVED');
  });

  it('never lets close readiness flip to ready without the escalation being settled', () => {
    const states = [run([big]), run([big, unrelated])];
    for (const state of states) {
      const review = state.current.tasks.find((t) => t.exceptionId.startsWith('CLOSE_CONTROLLER_REVIEW'));
      if (review && !isSettled(review.status)) {
        expect(state.current.closeReadiness.get(P1001)!.ready).toBe(false);
      }
    }
  });
});

// ---------------------------------------------------------------------------------------------------------
// Untrusted input must not reach the arithmetic.
// ---------------------------------------------------------------------------------------------------------

describe('non-numeric and non-finite values cannot corrupt the numbers', () => {
  const baseline = run();

  it('refuses a numeric string amount, which would turn addition into concatenation', () => {
    const state = run([
      {
        ...demoReceivedNotInvoiced[0]!,
        id: 'DEC-STRING-AMOUNT',
        payload: {
          type: 'ACCEPT_ADJUSTMENT',
          adjustmentType: 'RNI',
          subjectId: commitmentId('PO-0004'),
          // Exactly what JSON.parse yields from {"amount": "120000"}.
          amount: '120000' as unknown as number,
          note: 'Typed as text.',
        },
      },
    ]);

    expect(state.ignored).toHaveLength(1);
    const metrics = state.current.metricsByProject.get(P1001)!;
    expect(typeof metrics.eac).toBe('number');
    expect(metrics.eac).toBeCloseTo(baseline.current.metricsByProject.get(P1001)!.eac, 2);
  });

  it('refuses a NaN forecast value, which would switch off the rules that watch the forecast', () => {
    const state = run([
      forecastDecision('DEC-NAN', [
        { costCode: '260200', remainingUncommittedCost: Number.NaN, remainingLaborHours: null, comment: 'x' },
      ]),
    ]);

    expect(state.ignored).toHaveLength(1);

    const metrics = state.current.metricsByProject.get(P1001)!;
    expect(Number.isFinite(metrics.eac)).toBe(true);

    // Both rules must still be watching. A NaN forecast made every comparison false and silenced them.
    const firing = state.current.exceptions.filter((e) => e.currentlyTriggering).map((e) => e.ruleId);
    expect(firing).toContain('FC_MARGIN_FADE');
    expect(firing).toContain('FC_EAC_DETERIORATION');
  });

  it('refuses a forecast line naming a cost code that does not exist', () => {
    const state = run([
      forecastDecision('DEC-PHANTOM', [
        { costCode: '999999', remainingUncommittedCost: 5_000_000, remainingLaborHours: null, comment: 'x' },
      ]),
    ]);
    expect(state.ignored).toHaveLength(1);
    expect(state.ignored[0]!.reason).toContain('does not exist');
  });

  it('keeps every project metric finite across a hostile ledger', () => {
    const hostile: ReviewDecision[] = [
      forecastDecision('H1', [
        { costCode: '260200', remainingUncommittedCost: Number.POSITIVE_INFINITY, remainingLaborHours: null, comment: 'x' },
      ]),
      forecastDecision('H2', [
        { costCode: '260200', remainingUncommittedCost: -1, remainingLaborHours: null, comment: 'x' },
      ]),
      { ...demoReceivedNotInvoiced[0]!, id: 'H3', effectiveDate: '2099-01-01' },
    ];

    const state = run(hostile);

    for (const metrics of state.current.metricsByProject.values()) {
      for (const [key, value] of Object.entries(metrics)) {
        if (typeof value === 'number') {
          expect(Number.isFinite(value), `${metrics.projectId}.${key}`).toBe(true);
        }
      }
      for (const costCode of metrics.costCodes) {
        for (const [key, value] of Object.entries(costCode)) {
          if (typeof value === 'number') {
            expect(Number.isFinite(value), `${costCode.costCode}.${key}`).toBe(true);
          }
        }
      }
    }
  });
});

describe('the API body validator narrows untrusted JSON', () => {
  it('rejects a string where a number belongs', () => {
    const result = validateDecisionPayload({
      type: 'ACCEPT_ADJUSTMENT',
      adjustmentType: 'RNI',
      subjectId: 'CMT-PO-0004',
      amount: '120000',
      note: '',
    });
    expect(result.ok).toBe(false);
  });

  it('rejects NaN and Infinity', () => {
    for (const amount of [Number.NaN, Number.POSITIVE_INFINITY]) {
      const result = validateDecisionPayload({
        type: 'ACCEPT_ADJUSTMENT', adjustmentType: 'RNI', subjectId: 'CMT-PO-0004', amount, note: '',
      });
      expect(result.ok).toBe(false);
    }
  });

  it('rejects an unknown decision type', () => {
    expect(validateDecisionPayload({ type: 'DROP_TABLES' }).ok).toBe(false);
  });

  it('accepts a well-formed payload', () => {
    const result = validateDecisionPayload({
      type: 'ACCEPT_ADJUSTMENT',
      adjustmentType: 'RNI',
      subjectId: 'CMT-PO-0004',
      amount: 120_000,
      note: 'Confirmed delivered.',
    });
    expect(result.ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------------------------
// Agent and graph invariants that nothing pinned.
// ---------------------------------------------------------------------------------------------------------

describe('the agents partition every rule', () => {
  it('covers all 24 detection rules exactly once', () => {
    const owned = AGENTS.flatMap((agent) => agent.ownedRules).filter(
      (rule) => rule !== 'CLOSE_CONTROLLER_REVIEW',
    );
    const declared = ALL_RULES.map((rule) => rule.id);

    // A rule owned by no agent produces exceptions no agent reports, so no task is ever opened for it —
    // and nothing anywhere would fail.
    expect([...owned].sort()).toEqual([...declared].sort());
    expect(new Set(owned).size).toBe(owned.length);
  });

  it('enforces the declared action set rather than documenting it', () => {
    const orchestrator = AGENTS.find((a) => a.id === 'CLOSE_ORCHESTRATOR')!;
    const emitter = actionEmitter(orchestrator, 0, V0_CONFIG.closeDate);

    expect(() => emitter.emit({ type: 'CLOSE_STATUS_CHANGED', summary: 'allowed' })).not.toThrow();
    // The orchestrator does not detect exceptions, so it must not be able to claim it did.
    expect(() => emitter.emit({ type: 'EXCEPTION_DETECTED', summary: 'not allowed' })).toThrow(
      DisallowedAgentActionError,
    );
  });
});

describe('the graph supports everything it displays', () => {
  const state = run(demoLaborDeterioration);
  // The projection the engine actually used, which is what `currentGraph` consumes in production.
  const projection = state.effectiveProjection;
  const view = buildView(model, projection);
  const graph = buildGraph(model, view, state.current, state.decisions, AGENTS);

  it('resolves every node id cited as exception evidence', () => {
    const dangling: string[] = [];
    for (const exception of state.current.exceptions) {
      for (const nodeId of exception.evidence.nodeIds) {
        if (!graph.nodes.has(nodeId)) dangling.push(`${exception.ruleId} → ${nodeId}`);
      }
    }
    // Employees were cited by the unposted-labour exception but never created as nodes, so the drill-down
    // led nowhere and the endpoint filter hid the omission.
    expect(dangling).toEqual([]);
  });

  it('shows the forecast snapshot a human created, not just the decision', () => {
    const overlayIds = [...projection.forecastOverlay.keys()];
    expect(overlayIds.length).toBeGreaterThan(0);
    for (const id of overlayIds) {
      expect(graph.nodes.has(id), `${id} should appear in the graph`).toBe(true);
    }
  });

  it('has no link with a missing endpoint and no duplicate ids', () => {
    for (const link of graph.links) {
      expect(graph.nodes.has(link.fromId)).toBe(true);
      expect(graph.nodes.has(link.toId)).toBe(true);
    }
    expect(new Set(graph.links.map((l) => l.id)).size).toBe(graph.links.length);
  });
});

// ---------------------------------------------------------------------------------------------------------
// Portfolio exposure must be unit-correct and must not multi-count.
// ---------------------------------------------------------------------------------------------------------

describe('dollar exposure', () => {
  const state = run();

  it('excludes impacts that are not denominated in dollars', () => {
    const exposure = dollarExposure(state.current.exceptions);
    const daysAndPoints = state.current.exceptions.filter(
      (e) => e.impact !== null && e.impactUnit !== 'USD',
    );
    // Forecast age in days and labour burn in percentage points were being added to dollars.
    expect(daysAndPoints.length).toBeGreaterThan(0);
    expect(exposure.excludedNonDollar).toBe(daysAndPoints.length);
    expect(Number.isFinite(exposure.total)).toBe(true);
  });

  it('counts one economic subject once, however many rules describe it', () => {
    // On P-1004 the same $420,000 appears as a missing SOV line, an unbilled change order and an SOV
    // variance. Summing all three would treble-count it.
    const p1004 = state.current.exceptions.filter((e) => e.projectId === P1004);
    const exposure = dollarExposure(p1004);
    const naive = p1004.reduce((sum, e) => sum + (e.impact ?? 0), 0);
    expect(exposure.total).toBeLessThan(naive);
  });
});

// ---------------------------------------------------------------------------------------------------------
// The close walkthrough still ends where it should.
// ---------------------------------------------------------------------------------------------------------

describe('the full close walkthrough still reaches close-ready after hardening', () => {
  const after = run(demoCloseP1004);

  it('settles the portfolio-level blocker and every blocking item on P-1004', () => {
    expect(after.current.portfolioReadiness.ready).toBe(true);
    expect(after.current.closeReadiness.get(P1004)!.ready).toBe(true);
  });

  it('did not silently drop any decision', () => {
    expect(after.ignored).toEqual([]);
  });
});
