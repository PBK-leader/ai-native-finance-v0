/**
 * Reads the Summit MEP mock exports from disk and returns them as typed raw rows.
 *
 * This is the only module that touches the filesystem. It performs no interpretation: a blank field stays
 * blank, a malformed number stays a string. Everything meaningful happens in `src/data/normalize`, where a
 * problem can be attributed to a specific source record instead of throwing during a file read.
 *
 * Node-only (server side). The result is cached because the files never change at runtime.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseCsvRecords } from './csv';
import { SOURCE_FILES, type RawSources } from './rawTypes';

/** Repository-relative root of the mock client data. */
export const MOCK_DATA_ROOT = join(process.cwd(), 'data', 'mock', 'summit_mep');

function readRows<T>(relativePath: string): T[] {
  const absolute = join(MOCK_DATA_ROOT, relativePath);
  const text = readFileSync(absolute, 'utf8');
  return parseCsvRecords(text) as T[];
}

let cached: RawSources | null = null;

/** Load every raw source file. Cached after the first call. */
export function loadRawSources(): RawSources {
  if (cached) return cached;

  cached = {
    company: readRows(SOURCE_FILES.company),
    divisions: readRows(SOURCE_FILES.divisions),
    people: readRows(SOURCE_FILES.people),
    employees: readRows(SOURCE_FILES.employees),
    vendors: readRows(SOURCE_FILES.vendors),
    projectIdMap: readRows(SOURCE_FILES.projectIdMap),
    erpProjects: readRows(SOURCE_FILES.erpProjects),
    pmProjects: readRows(SOURCE_FILES.pmProjects),
    commitments: readRows(SOURCE_FILES.commitments),
    apInvoices: readRows(SOURCE_FILES.apInvoices),
    materialReceipts: readRows(SOURCE_FILES.materialReceipts),
    jobCostTransactions: readRows(SOURCE_FILES.jobCostTransactions),
    laborEntries: readRows(SOURCE_FILES.laborEntries),
    projectBudgets: readRows(SOURCE_FILES.projectBudgets),
    pmForecasts: readRows(SOURCE_FILES.pmForecasts),
    costCodeProgress: readRows(SOURCE_FILES.costCodeProgress),
    changeOrders: readRows(SOURCE_FILES.changeOrders),
    sovItems: readRows(SOURCE_FILES.sovItems),
    billings: readRows(SOURCE_FILES.billings),
  };

  return cached;
}

/** Test-only: drop the cache so a test can load from a different working directory. */
export function resetRawSourceCache(): void {
  cached = null;
}
