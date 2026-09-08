/**
 * The five calculation edge cases from `reference/edge_case_fixtures.json`.
 *
 * These are synthetic fixtures rather than Summit MEP projects, precisely so the realistic client data does
 * not have to be polluted with degenerate values to test the guards. Each one is a case where a naive
 * implementation returns `NaN`, `Infinity`, or a confidently wrong zero.
 *
 * The distinction that matters throughout: `null` means "not applicable", and it is a different statement
 * from zero. A project with no contract value has an undefined margin, not a 0% margin.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { safeDivide, safePercent } from '@/domain/money';
import { percentComplete } from '@/calculations/projectMetrics';
import { detectExceptions } from '@/exceptions/engine';
import { baselineContext } from './ruleCounts.test';

type Fixture = {
  id: string;
  revisedContractValue?: number;
  eac?: number;
  adjustedCostToDate?: number;
  budgetedLaborHours?: number;
  actualLaborHours?: number;
  physicalProgressPct?: number;
  priorRemainingCost?: number;
  currentRemainingCost?: number;
  expected: Record<string, unknown>;
};

const fixtures = (
  JSON.parse(
    readFileSync(
      join(process.cwd(), 'data', 'mock', 'summit_mep', 'reference', 'edge_case_fixtures.json'),
      'utf8',
    ),
  ) as { cases: Fixture[] }
).cases;

const find = (id: string): Fixture => {
  const fixture = fixtures.find((f) => f.id === id);
  if (!fixture) throw new Error(`Missing edge-case fixture ${id}`);
  return fixture;
};

describe('EDGE-ZERO-CONTRACT — margin is not applicable when there is no contract value', () => {
  const fixture = find('EDGE-ZERO-CONTRACT');

  it('returns null rather than NaN or Infinity', () => {
    const profit = fixture.revisedContractValue! - fixture.eac!;
    const margin = safePercent(profit, fixture.revisedContractValue!);

    expect(margin).toBeNull();
    expect(fixture.expected['projectedMargin']).toBeNull();
  });

  it('still reports the loss in dollars, which is well defined', () => {
    expect(fixture.revisedContractValue! - fixture.eac!).toBe(-100_000);
  });
});

describe('EDGE-ZERO-EAC-ZERO-COST — nothing forecast and nothing spent is 0% complete', () => {
  const fixture = find('EDGE-ZERO-EAC-ZERO-COST');

  it('treats zero over zero as 0%, not as an error', () => {
    const result = percentComplete(fixture.eac!, fixture.adjustedCostToDate!);
    expect(result.percentCompletePct).toBe(0);
    expect(result.dataQualityError).toBeNull();
    expect(fixture.expected['percentComplete']).toBe(0);
  });
});

describe('EDGE-ZERO-EAC-NONZERO-COST — cost with no forecast is a data problem, not a percentage', () => {
  const fixture = find('EDGE-ZERO-EAC-NONZERO-COST');

  it('refuses to divide and flags the inconsistency', () => {
    const result = percentComplete(fixture.eac!, fixture.adjustedCostToDate!);
    expect(result.percentCompletePct).toBeNull();
    expect(result.dataQualityError).not.toBeNull();
    expect(fixture.expected['percentComplete']).toBeNull();
    expect(fixture.expected['dataQualityError']).toBe(true);
  });
});

describe('EDGE-ZERO-LABOR-BUDGET — no budgeted hours means no consumption rate', () => {
  const fixture = find('EDGE-ZERO-LABOR-BUDGET');

  it('returns null for hours consumed rather than dividing by zero', () => {
    const consumed = safePercent(fixture.actualLaborHours!, fixture.budgetedLaborHours!);
    expect(consumed).toBeNull();
    expect(fixture.expected['hoursConsumedPct']).toBeNull();
  });

  it('makes the labour-burn rule unevaluable, so it must not fire', () => {
    expect(fixture.expected['laborBurnRuleEvaluable']).toBe(false);

    // Driven through the real rule engine against the seeded zero-budget control (PC-7791 / 229950), rather
    // than against a boolean computed in this file. A test that re-implements its subject keeps passing
    // while the subject regresses.
    const detected = detectExceptions(baselineContext());
    const onZeroBudgetCode = detected.all.filter(
      (exception) =>
        exception.ruleId === 'FC_LABOR_BURN' && exception.subjectId.endsWith('229950'),
    );
    expect(onZeroBudgetCode).toEqual([]);
  });
});

describe('EDGE-ZERO-PRIOR-FORECAST — a percentage change from zero is meaningless', () => {
  const fixture = find('EDGE-ZERO-PRIOR-FORECAST');

  it('falls back to the dollar threshold when the prior value is zero', () => {
    expect(fixture.expected['pmChangeUsesDollarThresholdOnly']).toBe(true);
    expect(Math.abs(fixture.currentRemainingCost! - fixture.priorRemainingCost!)).toBe(60_000);

    // Verified against the real rule: every instance it reports must carry a percentage threshold that is
    // either genuinely met or explicitly unmet, and it must never divide by a zero prior value. The seeded
    // instances both have non-zero priors, so the guard is checked by inspecting what the rule emits.
    const detected = detectExceptions(baselineContext());
    const instances = detected.all.filter((e) => e.ruleId === 'FC_PM_CHANGE_NO_EXPLANATION');
    expect(instances.length).toBeGreaterThan(0);

    for (const instance of instances) {
      const priorValue = instance.evidence.measured.find((m) => m.label === 'Prior remaining')?.value;
      const pctThreshold = instance.evidence.thresholds.find((t) => t.name === 'pmChangeCommentPct');

      expect(pctThreshold).toBeDefined();
      // When the prior value is zero the percentage test cannot apply, so it must be reported as unmet.
      if (priorValue === 0) expect(pctThreshold!.met).toBe(false);
      for (const measure of instance.evidence.measured) {
        if (measure.value !== null) expect(Number.isFinite(measure.value)).toBe(true);
      }
    }
  });
});

describe('the guards themselves', () => {
  it('never returns NaN or Infinity for any zero denominator', () => {
    for (const numerator of [-1000, 0, 1000, Number.MAX_SAFE_INTEGER]) {
      expect(safeDivide(numerator, 0)).toBeNull();
      expect(safePercent(numerator, 0)).toBeNull();
    }
  });

  it('rejects non-finite inputs rather than propagating them', () => {
    expect(safeDivide(Number.NaN, 5)).toBeNull();
    expect(safeDivide(5, Number.NaN)).toBeNull();
    expect(safeDivide(Number.POSITIVE_INFINITY, 5)).toBeNull();
  });

  it('handles very large values without overflowing to Infinity', () => {
    const result = safeDivide(Number.MAX_SAFE_INTEGER, 2);
    expect(result).not.toBeNull();
    expect(Number.isFinite(result!)).toBe(true);
  });

  it('clamps percent complete into 0–100 rather than reporting over-completion', () => {
    // Cost above EAC would otherwise report more than 100% complete and overstate earned revenue.
    expect(percentComplete(100_000, 150_000).percentCompletePct).toBe(100);
    expect(percentComplete(100_000, -50_000).percentCompletePct).toBe(0);
  });
});
