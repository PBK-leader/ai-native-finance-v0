/**
 * Exact rule counts against the seeded oracle.
 *
 * `expected_rule_counts.csv` is an exact count per rule for this mock data at the close date, before any
 * simulated human resolution. It counts the **unsuppressed** set — which is why `AP_MISSING_POSTING` is 1 and
 * not 3: the duplicate and the over-committed invoice are both silenced by higher-precedence rules.
 *
 * These files are the oracle. If a count disagrees, the application is wrong.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { V0_CONFIG } from '@/config/v0Config';
import { parseCsvRecords } from '@/data/raw/csv';
import { canonicalModel, reconciledViewFor } from '@/workflows/engineInputs';
import { computeAllProjectMetrics } from '@/calculations/projectMetrics';
import { detectExceptions } from '@/exceptions/engine';
import { EMPTY_PROJECTION } from '@/domain/workflow';
import type { ProjectMetrics } from '@/domain/metrics';
import type { ProjectId } from '@/domain/ids';
import type { RuleContext } from '@/exceptions/types';

const REF = join(process.cwd(), 'data', 'mock', 'summit_mep', 'reference');
const expectedCounts = parseCsvRecords(readFileSync(join(REF, 'expected_rule_counts.csv'), 'utf8'));

function byProject(metrics: ProjectMetrics[]): Map<ProjectId, ProjectMetrics> {
  return new Map(metrics.map((m) => [m.projectId, m]));
}

/** The zero-decision baseline: exactly what the oracle describes. */
export function baselineContext(): RuleContext {
  const model = canonicalModel();
  const view = reconciledViewFor(EMPTY_PROJECTION);

  return {
    model,
    view,
    projection: EMPTY_PROJECTION,
    config: V0_CONFIG,
    metrics: byProject(
      computeAllProjectMetrics(model, view, EMPTY_PROJECTION, V0_CONFIG, V0_CONFIG.closeDate),
    ),
    priorMetrics: byProject(
      computeAllProjectMetrics(model, view, EMPTY_PROJECTION, V0_CONFIG, V0_CONFIG.priorComparisonDate),
    ),
    resolutionIndex: new Map(),
    asOfDate: V0_CONFIG.closeDate,
  };
}

const result = detectExceptions(baselineContext());

describe('exact rule counts match the seeded oracle', () => {
  it('the oracle covers 24 rules', () => {
    expect(expectedCounts).toHaveLength(24);
  });

  for (const row of expectedCounts) {
    const ruleId = row['rule_id']!;
    const expected = Number(row['expected_count']!);

    it(`${ruleId} produces exactly ${expected}`, () => {
      const actual = result.unsuppressed.filter((e) => e.ruleId === ruleId);
      expect(
        actual.length,
        `${ruleId}: expected ${expected}, got ${actual.length} — ` +
          `[${actual.map((e) => e.subjectId).join(', ')}]`,
      ).toBe(expected);
    });
  }

  it('produces no exception outside the 24 known rules', () => {
    const known = new Set(expectedCounts.map((r) => r['rule_id']!));
    const unknown = result.all.filter((e) => !known.has(e.ruleId));
    expect(unknown.map((e) => e.ruleId)).toEqual([]);
  });
});

describe('suppression behaves as documented', () => {
  it('silences the duplicate invoice and the over-committed invoice, leaving one missing posting', () => {
    const missing = result.all.filter((e) => e.ruleId === 'AP_MISSING_POSTING');

    // Three invoices are approved-but-unposted in the source data, but INV-00090 was approved only two days
    // before the close — inside the three-day posting lag — so it is not yet late and never fires. Of the two
    // that are old enough, the duplicate is silenced, leaving exactly one task.
    expect(missing).toHaveLength(2);
    expect(missing.filter((e) => e.suppressedBy === null).map((e) => e.subjectId)).toEqual(['AP-INV-00064']);

    const duplicateSuppressed = missing.find((e) => e.subjectId === 'AP-INV-00089');
    expect(duplicateSuppressed?.suppressedBy?.startsWith('AP_DUPLICATE')).toBe(true);
  });

  it('silences approved-unbilled for change orders that are missing from the SOV', () => {
    const suppressed = result.suppressed.filter((e) => e.ruleId === 'CO_APPROVED_UNBILLED');
    expect(suppressed.map((e) => e.subjectId).sort()).toEqual(['CHG-CO-1002-C', 'CHG-CO-1004-A']);
    for (const record of suppressed) {
      expect(record.suppressedBy!.startsWith('CO_MISSING_SOV')).toBe(true);
    }
  });

  it('records every exception it suppressed rather than dropping it', () => {
    for (const record of result.suppressed) {
      expect(record.suppressedBy).not.toBeNull();
      expect(result.all).toContain(record);
    }
  });
});

describe('every exception carries usable evidence', () => {
  it('has a deterministic id, an owner, a recommended action and at least one measured value', () => {
    for (const record of result.unsuppressed) {
      expect(record.id).toBe(`${record.ruleId}:${record.projectId ?? 'GLOBAL'}:${record.subjectId}`);
      expect(record.ownerRole).toBeTruthy();
      expect(record.recommendedAction.length).toBeGreaterThan(10);
      expect(record.explanation.length).toBeGreaterThan(20);
      expect(record.evidence.measured.length).toBeGreaterThan(0);
    }
  });

  it('never reports a NaN or Infinity in a measured value', () => {
    for (const record of result.all) {
      for (const measure of record.evidence.measured) {
        if (measure.value !== null) {
          expect(Number.isFinite(measure.value), `${record.id} / ${measure.label}`).toBe(true);
        }
      }
    }
  });

  it('produces unique exception ids', () => {
    const ids = result.all.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
