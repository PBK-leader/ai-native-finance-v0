/**
 * Exact seeded instances and negative controls.
 *
 * `expected_seeded_exceptions.csv` names all 59 exception instances the mock data should produce at the close
 * date — rule, project, source record, owner and blocking flag. Counting alone is not enough: the right
 * number of exceptions on the wrong records would still pass a count test.
 *
 * The oracle names raw source records (`INV-00090`, `PO-0004`, `260300`). Exception subjects are canonical
 * ids, and the two deliberately differ for rules that reason about one object while citing another — the
 * commitment-overrun exception is keyed on the purchase order but the oracle names the invoice that tipped it
 * over. So the source record is matched against the exception's evidence, which is where it genuinely lives.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseCsvRecords } from '@/data/raw/csv';
import { detectExceptions } from '@/exceptions/engine';
import type { ExceptionRecord } from '@/domain/workflow';
import { baselineContext } from './ruleCounts.test';

const REF = join(process.cwd(), 'data', 'mock', 'summit_mep', 'reference');
const seeded = parseCsvRecords(readFileSync(join(REF, 'expected_seeded_exceptions.csv'), 'utf8'));
const negativeControls = parseCsvRecords(readFileSync(join(REF, 'expected_negative_controls.csv'), 'utf8'));

const result = detectExceptions(baselineContext());

/** Every raw source id an exception touches: its subject, its evidence records, and its cited node ids. */
function sourceFootprint(record: ExceptionRecord): string[] {
  return [
    record.subjectId,
    ...record.evidence.sourceRefs.map((r) => r.recordId),
    ...record.evidence.nodeIds,
  ];
}

/** The oracle writes composite keys like `JC-00388:239777` and `PC-7480:260200 unposted labor`. */
function oracleTokens(sourceRecord: string): string[] {
  return sourceRecord
    .split(/[:\s]+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 0 && token !== 'unposted' && token !== 'labor' && token !== 'latest');
}

describe('every seeded exception instance is produced', () => {
  it('the oracle names 59 instances', () => {
    expect(seeded).toHaveLength(59);
  });

  for (const row of seeded) {
    const scenario = row['scenario_id']!;
    const ruleId = row['rule_id']!;
    const projectId = row['project_id']!;
    const sourceRecord = row['source_record']!;
    const expectedOwner = row['expected_owner']!;
    const expectedBlocking = row['blocking']! === 'True';

    it(`${scenario} — ${ruleId} on ${projectId || 'GLOBAL'} / ${sourceRecord}`, () => {
      const candidates = result.unsuppressed.filter(
        (e) => e.ruleId === ruleId && (e.projectId ?? '') === projectId,
      );
      expect(candidates.length, `no ${ruleId} exception found for ${projectId || 'GLOBAL'}`)
        .toBeGreaterThan(0);

      // At least one of them must actually reference the record the oracle names.
      const tokens = oracleTokens(sourceRecord);
      const match = candidates.find((candidate) => {
        const footprint = sourceFootprint(candidate).join(' ');
        return tokens.every((token) => footprint.includes(token));
      });

      expect(
        match,
        `${ruleId} for ${projectId} does not cite ${sourceRecord}. ` +
          `Candidates: ${candidates.map((c) => c.subjectId).join(', ')}`,
      ).toBeDefined();

      // The oracle's owner uses "PM" where the domain model says "Project Manager".
      const normalisedOwner = expectedOwner === 'PM' ? 'Project Manager' : expectedOwner;
      expect(match!.ownerRole, `${scenario} owner`).toBe(normalisedOwner);
      expect(match!.blocking, `${scenario} blocking flag`).toBe(expectedBlocking);
    });
  }
});

describe('negative controls do not produce false positives', () => {
  it('the oracle names 6 controls', () => {
    expect(negativeControls).toHaveLength(6);
  });

  for (const row of negativeControls) {
    const controlId = row['control_id']!;
    const sourceRecord = row['source_record']!;
    const mustNotTrigger = row['must_not_trigger']!.split(';').filter(Boolean);

    it(`${controlId} — ${sourceRecord} must not trigger ${mustNotTrigger.join(', ')}`, () => {
      const tokens = oracleTokens(sourceRecord);

      for (const ruleId of mustNotTrigger) {
        const offending = result.all.filter((record) => {
          if (record.ruleId !== ruleId) return false;
          // `all billing rows` is a blanket control: the rule must produce nothing at all.
          if (sourceRecord.startsWith('all ')) return true;
          const footprint = sourceFootprint(record).join(' ');
          return tokens.every((token) => footprint.includes(token));
        });

        expect(
          offending.map((o) => o.id),
          `${controlId}: ${ruleId} should not fire for ${sourceRecord}`,
        ).toEqual([]);
      }
    });
  }
});

describe('specific negative controls, checked directly', () => {
  const ctx = baselineContext();

  it('NC-01: the closed, fully invoiced PO-0020 has zero remaining commitment', () => {
    const metrics = ctx.metrics.get('P-1003' as never)!;
    const costCode = metrics.costCodes.find((c) => c.costCode === '220700');
    // PO-0020 is the only commitment on this cost code and it is fully invoiced.
    expect(costCode?.remainingCommitment).toBe(0);
  });

  it('NC-03: the rejected CO-1003-C is excluded from the revised contract', () => {
    const metrics = ctx.metrics.get('P-1003' as never)!;
    // 3,200,000 original + 100,000 for the one approved CO. The rejected 75,000 is not included.
    expect(metrics.revisedContractValue).toBe(3_300_000);
  });

  it('NC-04: the pending INV-00109 does not reduce its commitment', () => {
    const pending = ctx.model.apInvoices.find((i) => i.invoiceNumber === 'PENDING-TEST-001');
    expect(pending).toBeDefined();
    expect(ctx.view.isValidInvoice(pending!.id, ctx.asOfDate)).toBe(false);
  });

  it('NC-05: P-1003 is overbilled, so it is not reported as underbilled', () => {
    const metrics = ctx.metrics.get('P-1003' as never)!;
    expect(metrics.billingPosition).toBeGreaterThan(0);
    expect(result.all.filter((e) => e.ruleId === 'BILL_UNDERBILLING' && e.projectId === 'P-1003')).toEqual([]);
  });
});
