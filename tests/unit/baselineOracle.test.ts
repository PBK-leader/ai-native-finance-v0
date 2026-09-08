/**
 * The reference oracle test.
 *
 * `expected_baseline_project_metrics.csv` was produced independently of this codebase — the Python validator
 * recomputes it straight from the raw CSVs without importing any application code. Tying to it proves the
 * TypeScript implementation agrees with an independent derivation on all 12 project/date rows, at both the
 * current close and the reconstructed prior period.
 *
 * The baseline is explicitly *pre-human-adjustment*, so this runs with an empty decision projection.
 *
 * If this test fails, the application is wrong. The reference files are not to be edited to make it pass.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { V0_CONFIG } from '@/config/v0Config';
import { parseCsvRecords } from '@/data/raw/csv';
import { canonicalModel, reconciledViewFor } from '@/workflows/engineInputs';
import { computeProjectMetrics } from '@/calculations/projectMetrics';
import { EMPTY_PROJECTION } from '@/domain/workflow';
import { projectId as toProjectId } from '@/domain/ids';
import type { ProjectMetrics } from '@/domain/metrics';

const reference = parseCsvRecords(
  readFileSync(
    join(process.cwd(), 'data', 'mock', 'summit_mep', 'reference', 'expected_baseline_project_metrics.csv'),
    'utf8',
  ),
);

const model = canonicalModel();
const view = reconciledViewFor(EMPTY_PROJECTION);

function metricsFor(projectIdText: string, asOfDate: string): ProjectMetrics {
  const project = model.index.projectById.get(toProjectId(projectIdText));
  if (!project) throw new Error(`Unknown project ${projectIdText}`);
  return computeProjectMetrics(model, view, EMPTY_PROJECTION, V0_CONFIG, asOfDate, project);
}

/** The oracle ties to within $0.02 / 0.02 percentage points, matching the Python validator's tolerance. */
const TOLERANCE = 0.02;

/** Map a reference column to the computed value. Nulls in the CSV are blank cells. */
const FIELDS: Record<string, (m: ProjectMetrics) => number | null> = {
  revised_contract_value: (m) => m.revisedContractValue,
  posted_cost_to_date: (m) => m.postedCost,
  remaining_commitment: (m) => m.remainingCommitment,
  pm_remaining_uncommitted_cost: (m) => m.pmRemainingUncommittedCost,
  baseline_eac: (m) => m.eac,
  projected_profit: (m) => m.projectedProfit,
  projected_margin_pct: (m) => m.projectedMarginPct,
  draft_percent_complete_pct: (m) => m.percentCompletePct,
  draft_earned_revenue: (m) => m.draftEarnedRevenue,
  billed_to_date: (m) => m.billedToDate,
  billing_position: (m) => m.billingPosition,
};

describe('baseline project metrics tie to the independent reference oracle', () => {
  it('covers all 12 project/date rows', () => {
    expect(reference).toHaveLength(12);
  });

  for (const row of reference) {
    const project = row['project_id']!;
    const asOf = row['as_of_date']!;

    describe(`${project} as at ${asOf}`, () => {
      const metrics = metricsFor(project, asOf);

      for (const [column, read] of Object.entries(FIELDS)) {
        it(column, () => {
          const rawExpected = row[column]!;
          const actual = read(metrics);

          if (rawExpected === '') {
            expect(actual).toBeNull();
            return;
          }

          expect(actual).not.toBeNull();
          expect(Number.isFinite(actual!)).toBe(true);
          expect(Math.abs(actual! - Number(rawExpected))).toBeLessThanOrEqual(TOLERANCE);
        });
      }
    });
  }
});

describe('denominator guards hold across the real portfolio', () => {
  it('never produces NaN or Infinity in any project metric', () => {
    for (const asOf of [V0_CONFIG.priorComparisonDate, V0_CONFIG.closeDate]) {
      for (const project of model.projects) {
        const metrics = computeProjectMetrics(model, view, EMPTY_PROJECTION, V0_CONFIG, asOf, project);

        for (const [key, value] of Object.entries(metrics)) {
          if (typeof value === 'number') {
            expect(Number.isFinite(value), `${project.id}.${key}`).toBe(true);
          }
        }

        for (const costCode of metrics.costCodes) {
          for (const [key, value] of Object.entries(costCode)) {
            if (typeof value === 'number') {
              expect(Number.isFinite(value), `${project.id}.${costCode.costCode}.${key}`).toBe(true);
            }
          }
        }
      }
    }
  });

  it('returns a not-applicable ratio rather than zero for the zero-labour-budget control', () => {
    // PC-7791 / 229950 is the seeded denominator-safe control: no budget, no hours, no activity.
    const project = model.index.projectById.get(toProjectId('P-1003'))!;
    const metrics = computeProjectMetrics(model, view, EMPTY_PROJECTION, V0_CONFIG, V0_CONFIG.closeDate, project);
    const control = metrics.costCodes.find((c) => c.costCode === '229950');

    expect(control).toBeDefined();
    expect(control!.budgetedLaborHours).toBe(0);
    expect(control!.hoursConsumedPct).toBeNull();
  });
});
