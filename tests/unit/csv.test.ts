import { describe, expect, it } from 'vitest';
import { parseCsv, parseCsvRecords } from '@/data/raw/csv';
import { loadRawSources } from '@/data/raw/loadRawSources';

describe('parseCsv', () => {
  it('parses a simple grid', () => {
    expect(parseCsv('a,b\n1,2')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('keeps commas inside quoted fields', () => {
    expect(parseCsv('id,note\n1,"hello, world"')).toEqual([
      ['id', 'note'],
      ['1', 'hello, world'],
    ]);
  });

  it('unescapes doubled quotes', () => {
    expect(parseCsv('id,note\n1,"she said ""hi"""')).toEqual([
      ['id', 'note'],
      ['1', 'she said "hi"'],
    ]);
  });

  it('keeps newlines inside quoted fields', () => {
    expect(parseCsv('id,note\n1,"line one\nline two"')).toEqual([
      ['id', 'note'],
      ['1', 'line one\nline two'],
    ]);
  });

  it('handles CRLF line endings', () => {
    expect(parseCsv('a,b\r\n1,2\r\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('strips a UTF-8 BOM from the first header cell', () => {
    expect(parseCsv('﻿a,b\n1,2')[0]).toEqual(['a', 'b']);
  });

  it('preserves empty fields and ignores a trailing newline', () => {
    expect(parseCsv('a,b,c\n1,,3\n')).toEqual([
      ['a', 'b', 'c'],
      ['1', '', '3'],
    ]);
  });

  it('returns no rows for empty input', () => {
    expect(parseCsv('')).toEqual([]);
  });
});

describe('parseCsvRecords', () => {
  it('keys cells by header', () => {
    expect(parseCsvRecords('id,name\n1,Ada')).toEqual([{ id: '1', name: 'Ada' }]);
  });

  it('fills missing trailing columns with empty strings rather than undefined', () => {
    const [row] = parseCsvRecords('a,b,c\n1');
    expect(row).toEqual({ a: '1', b: '', c: '' });
  });

  it('returns no records when only a header is present', () => {
    expect(parseCsvRecords('a,b\n')).toEqual([]);
  });
});

describe('real source files', () => {
  const raw = loadRawSources();

  it('loads every collection at the row counts the data dictionary documents', () => {
    expect(raw.apInvoices).toHaveLength(109);
    expect(raw.commitments).toHaveLength(44);
    expect(raw.jobCostTransactions).toHaveLength(442);
    expect(raw.materialReceipts).toHaveLength(88);
    expect(raw.employees).toHaveLength(270);
    expect(raw.people).toHaveLength(11);
    expect(raw.projectIdMap).toHaveLength(7);
    expect(raw.vendors).toHaveLength(11);
    expect(raw.billings).toHaveLength(36);
    expect(raw.changeOrders).toHaveLength(15);
    expect(raw.costCodeProgress).toHaveLength(122);
    expect(raw.pmForecasts).toHaveLength(122);
    expect(raw.projectBudgets).toHaveLength(61);
    expect(raw.pmProjects).toHaveLength(7);
    expect(raw.sovItems).toHaveLength(36);
    expect(raw.laborEntries).toHaveLength(22_593);
    expect(raw.erpProjects).toHaveLength(6);
    expect(raw.divisions).toHaveLength(3);
    expect(raw.company).toHaveLength(1);
  });

  it('parses a quoted field containing a comma from the budget revision reason', () => {
    const revised = raw.projectBudgets.find((b) => b.linked_change_order_id === 'CO-1004-A');
    expect(revised?.cost_code).toBe('260300');
    expect(revised?.current_budget).toBe('1050000');
  });

  it('keeps the intentionally unmapped project row with a blank canonical id', () => {
    const unmapped = raw.projectIdMap.find((m) => m.pm_project_id === 'PC-UNKNOWN-88');
    expect(unmapped?.canonical_project_id).toBe('');
    expect(unmapped?.mapping_confidence).toBe('0.00');
  });
});
