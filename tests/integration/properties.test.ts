/**
 * Property tests over randomly generated hostile decision ledgers.
 *
 * Every other test in this suite asserts something specific that is known to have gone wrong. This one looks
 * for the *next* defect. The QA reviewer's own fuzz harness is what surfaced the string-concatenation and
 * `NaN` corruption bugs, neither of which any targeted test would have found, so the technique earns a
 * permanent place in the repository rather than living in a reviewer's scratchpad.
 *
 * Four invariants are asserted for every generated ledger, however nonsensical:
 *
 * 1. **`replay` never throws.** The ledger is append-only and replay runs on every render, so one bad
 *    decision that threw would break every screen permanently with no way to remove it.
 * 2. **Every metric is a finite number.** Not a string, not `NaN`, not `Infinity`. A string amount once
 *    turned `+=` into concatenation and produced a confidently wrong margin.
 * 3. **Close readiness is never true while an unsettled blocking task exists.** This is the product's
 *    strongest claim — no material change reaches the books without a Controller looking at it.
 * 4. **Replay is deterministic.** The same ledger twice gives the same answer.
 *
 * The generator is seeded so a failure is reproducible: the seed is printed in the assertion message.
 */

import { describe, expect, it } from 'vitest';
import { V0_CONFIG } from '@/config/v0Config';
import { getNormalized } from '@/data/normalize/model';
import { buildReconciledView } from '@/reconciliation/buildReconciledView';
import { replay } from '@/workflows/replay';
import { isSettled } from '@/domain/workflow';
import type { CanonicalModel } from '@/domain/entities';
import type { DecisionProjection, DecisionType, ReviewDecision } from '@/domain/workflow';
import type { ExceptionId, ProjectId } from '@/domain/ids';

const { model, reconciliationKeys } = getNormalized();
const buildView = (m: CanonicalModel, projection: DecisionProjection) =>
  buildReconciledView(m, reconciliationKeys, projection);

/** Deterministic PRNG, so a failing case can be reproduced from the seed alone. */
function rng(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1_664_525 + 1_013_904_223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

const PERSONAS = ['PERS-PM1', 'PERS-PM4', 'PERS-PA1', 'PERS-PA2', 'PERS-CTRL', 'PERS-CFO'];
const ROLES = ['Project Manager', 'Project Accountant', 'Controller', 'CFO'] as const;
const DECISION_TYPES: DecisionType[] = [
  'PM_FORECAST_UPDATE', 'PM_ANSWER', 'ACCEPT_ADJUSTMENT', 'REJECT_ADJUSTMENT',
  'RECORD_SOV_CORRECTION', 'ESCALATE', 'ACCEPT_RISK', 'CONTROLLER_APPROVE',
];

/** Values chosen to be hostile: wrong types, non-finite numbers, malformed dates, unknown subjects. */
const HOSTILE_AMOUNTS: unknown[] = [
  120_000, -1, 0, 5_000_000, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY,
  '120000', '', null, undefined, {},
];
const HOSTILE_DATES = [
  V0_CONFIG.closeDate, V0_CONFIG.priorComparisonDate, '2099-01-01', '1999-01-01', 'not-a-date', '',
];
const HOSTILE_SUBJECTS = [
  'CMT-PO-0004', 'AP-INV-00064', 'LAB-P-1004-260200', 'CHG-CO-1004-A',
  'CMT-DOES-NOT-EXIST', '', 'null', '../../etc/passwd',
];
const HOSTILE_EXCEPTIONS = [
  'AP_RNI:P-1001:CMT-PO-0004',
  'CO_MISSING_SOV:P-1004:CHG-CO-1004-A',
  'FC_LABOR_BURN:P-1001:CC-P-1001-260200',
  'NOT_A_RULE:P-1001:whatever',
  '',
  'AP_RNI:P-9999:CMT-PO-0004',
];
const PROJECTS = ['P-1001', 'P-1002', 'P-1003', 'P-1004', 'P-1005', 'P-1006', 'P-9999', ''];

function generateLedger(seed: number): ReviewDecision[] {
  const random = rng(seed);
  const pick = <T,>(items: readonly T[]): T => items[Math.floor(random() * items.length)]!;

  const count = 1 + Math.floor(random() * 5);
  const decisions: ReviewDecision[] = [];

  for (let i = 0; i < count; i += 1) {
    const type = pick(DECISION_TYPES);
    const amount = pick(HOSTILE_AMOUNTS);

    const payload = ((): unknown => {
      switch (type) {
        case 'PM_FORECAST_UPDATE':
          return {
            type,
            lines: [
              {
                costCode: pick(['260200', '260400', '230500', '999999', '']),
                remainingUncommittedCost: amount,
                remainingLaborHours: pick(HOSTILE_AMOUNTS),
                comment: pick(['Explained.', '', '   ']),
              },
            ],
          };
        case 'ACCEPT_ADJUSTMENT':
          return {
            type,
            adjustmentType: pick(['RNI', 'AP_UNPOSTED', 'UNPOSTED_LABOR', 'NONSENSE']),
            subjectId: pick(HOSTILE_SUBJECTS),
            amount,
            note: 'fuzz',
          };
        case 'RECORD_SOV_CORRECTION':
          return {
            type,
            changeOrderId: pick(['CHG-CO-1004-A', 'CHG-CO-1002-C', 'CHG-NOPE']),
            scheduledValue: amount,
            retainagePct: pick([5, -1, 1000, Number.NaN]),
          };
        case 'PM_ANSWER':
          return { type, answer: pick(['Answered.', '']) };
        case 'REJECT_ADJUSTMENT':
        case 'ESCALATE':
          return { type, reason: pick(['Because.', '']) };
        case 'ACCEPT_RISK':
          return { type, rationale: pick(['Accepted knowingly.', '', 'ok']) };
        case 'CONTROLLER_APPROVE':
          return { type, note: 'fuzz' };
      }
    })();

    const projectText = pick(PROJECTS);

    decisions.push({
      id: `FUZZ-${seed}-${i}`,
      exceptionId: pick(HOSTILE_EXCEPTIONS) as ExceptionId,
      subject: {
        projectId: projectText === '' ? null : (projectText as ProjectId),
        canonicalId: pick(HOSTILE_SUBJECTS),
      },
      actor: { personId: pick(PERSONAS) as never, role: pick(ROLES) },
      effectiveDate: pick(HOSTILE_DATES),
      recordedAt: '2026-08-25T00:00:00.000Z',
      payload: payload as ReviewDecision['payload'],
    });
  }

  return decisions;
}

describe('replay holds under hostile ledgers', () => {
  const SEEDS = 200;
  // Each case is a full replay of the whole portfolio, so the suite is legitimately slower than a unit test.
  const TIMEOUT = 60_000;

  it(`survives ${SEEDS} randomly generated ledgers without throwing`, () => {
    for (let seed = 1; seed <= SEEDS; seed += 1) {
      const ledger = generateLedger(seed);
      expect(
        () => replay(model, buildView, V0_CONFIG, ledger),
        `seed ${seed} threw — reproduce with generateLedger(${seed})`,
      ).not.toThrow();
    }
  }, TIMEOUT);

  it('never produces a non-finite or non-numeric metric', () => {
    for (let seed = 1; seed <= SEEDS; seed += 1) {
      const state = replay(model, buildView, V0_CONFIG, generateLedger(seed));

      for (const metrics of state.current.metricsByProject.values()) {
        for (const [key, value] of Object.entries(metrics)) {
          if (key === 'costCodes' || value === null) continue;
          if (typeof value === 'string' && key !== 'projectId' && key !== 'asOfDate' && key !== 'dataQualityError') {
            throw new Error(`seed ${seed}: ${metrics.projectId}.${key} is a string — ${value}`);
          }
          if (typeof value === 'number') {
            expect(Number.isFinite(value), `seed ${seed}: ${metrics.projectId}.${key} = ${value}`).toBe(true);
          }
        }

        for (const costCode of metrics.costCodes) {
          for (const [key, value] of Object.entries(costCode)) {
            if (typeof value === 'number') {
              expect(
                Number.isFinite(value),
                `seed ${seed}: ${metrics.projectId}/${costCode.costCode}.${key} = ${value}`,
              ).toBe(true);
            }
          }
        }
      }
    }
  }, TIMEOUT);

  it('never reports a project close-ready while a blocking task is unsettled', () => {
    for (let seed = 1; seed <= SEEDS; seed += 1) {
      const state = replay(model, buildView, V0_CONFIG, generateLedger(seed));

      for (const [projectId, readiness] of state.current.closeReadiness) {
        if (!readiness.ready) continue;

        const unsettled = state.current.tasks.filter(
          (task) =>
            task.blocking &&
            !isSettled(task.status) &&
            (task.projectId === projectId || task.projectId === null),
        );

        expect(
          unsettled.map((t) => `${t.exceptionId} (${t.status})`),
          `seed ${seed}: ${projectId} is close-ready with unsettled blocking work`,
        ).toEqual([]);
      }
    }
  }, TIMEOUT);

  it('is deterministic for every generated ledger', () => {
    for (let seed = 1; seed <= 40; seed += 1) {
      const ledger = generateLedger(seed);
      const first = replay(model, buildView, V0_CONFIG, ledger);
      const second = replay(model, buildView, V0_CONFIG, ledger);

      expect(second.current.tasks, `seed ${seed}`).toEqual(first.current.tasks);
      expect(second.current.actions, `seed ${seed}`).toEqual(first.current.actions);
      expect(second.ignored.map((e) => e.decision.id), `seed ${seed}`).toEqual(
        first.ignored.map((e) => e.decision.id),
      );
    }
  }, TIMEOUT);

  it('refuses malformed decisions rather than silently applying them', () => {
    // A ledger of pure nonsense should move no number at all.
    const baseline = replay(model, buildView, V0_CONFIG, []);
    let sawRejections = false;

    for (let seed = 1; seed <= SEEDS; seed += 1) {
      const state = replay(model, buildView, V0_CONFIG, generateLedger(seed));
      if (state.ignored.length > 0) sawRejections = true;

      for (const [projectId, metrics] of state.current.metricsByProject) {
        // Contract value depends only on source change orders, so no decision may ever move it.
        expect(
          metrics.revisedContractValue,
          `seed ${seed}: ${projectId} contract value moved`,
        ).toBeCloseTo(baseline.current.metricsByProject.get(projectId)!.revisedContractValue, 2);
      }
    }

    expect(sawRejections, 'the generator should produce at least some refused decisions').toBe(true);
  }, TIMEOUT);
});
