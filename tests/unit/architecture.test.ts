/**
 * Architecture invariants, enforced rather than documented.
 *
 * Three rules hold this codebase together, and all three are the kind that erode quietly under time pressure.
 * A comment saying "don't do this" is not a control; a failing test is.
 *
 * 1. Reconciled relationships exist in exactly one place — as graph links behind `ReconciledView`. If a
 *    counterparty id reappears as a field on an entity, the financial maths and the graph explorer can start
 *    disagreeing about which invoices count, and nothing would fail loudly.
 * 2. `replay` is pure, so no wall-clock reads below the app layer. A `new Date()` in the derived pipeline
 *    would make the activity trail change on every refresh and turn idempotency tests flaky.
 * 3. Financial arithmetic lives in `src/calculations`. A percentage recomputed in a component is how two
 *    screens start showing different numbers for the same thing.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = join(process.cwd(), 'src');

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

/** Strip comments and string literals so prose about a rule cannot trip the rule. */
function code(file: string): string {
  return readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
    .replace(/'(?:[^'\\]|\\.)*'/g, "''")
    .replace(/"(?:[^"\\]|\\.)*"/g, '""')
    .replace(/`(?:[^`\\]|\\.)*`/g, '``');
}

const files = sourceFiles(SRC);
const rel = (file: string) => relative(SRC, file).split(sep).join('/');

describe('reconciled relationships live in exactly one place', () => {
  // The raw column names, for the layers that are allowed nowhere near them.
  const RAW_KEYS = /\b(commitment_id|source_doc_id|approved_co_id|sov_item_id|erp_job_id|pm_project_id)\b/;

  // Only these modules may read a raw counterparty key.
  const ALLOWED = ['data/raw/', 'data/normalize/', 'reconciliation/'];

  it('no module outside the data and reconciliation layers reads a raw counterparty key', () => {
    const offenders = files
      .filter((file) => !ALLOWED.some((prefix) => rel(file).startsWith(prefix)))
      .filter((file) => RAW_KEYS.test(code(file)))
      .map(rel);

    expect(offenders).toEqual([]);
  });

  it('canonical entities carry no reconciled counterparty ids', () => {
    // The camelCase form is the one the original design defect actually took, and a raw-column grep would
    // never have caught it.
    const entities = code(join(SRC, 'domain', 'entities.ts'));
    const banned = /\b(commitmentId|invoiceId|sovItemId|changeOrderId|receiptId|billingId|jobCostTxnId)\s*:/g;

    const matches = [...entities.matchAll(banned)].map((m) => m[0]);
    expect(matches).toEqual([]);
  });

  it('still permits the containment and master-data keys that are meant to be fields', () => {
    // A guard on the guard: if this ever fails, the ban above has been written too broadly.
    const entities = readFileSync(join(SRC, 'domain', 'entities.ts'), 'utf8');
    expect(entities).toMatch(/projectId:/);
    expect(entities).toMatch(/costCodeId:/);
    expect(entities).toMatch(/vendorId:/);
  });
});

describe('the derived pipeline is pure', () => {
  const WALL_CLOCK = /\b(Date\.now\(\)|new Date\(\s*\))/;

  it('reads no wall clock below the app layer', () => {
    const offenders = files
      .filter((file) => !rel(file).startsWith('app/'))
      .filter((file) => WALL_CLOCK.test(code(file)))
      .map(rel);

    // `src/app` may stamp `recordedAt`; nothing else may observe time, or replay stops being deterministic.
    expect(offenders).toEqual([]);
  });

  it('never mutates the canonical model outside normalization', () => {
    const offenders = files
      .filter((file) => !rel(file).startsWith('data/'))
      .filter((file) => /\bmodel\.[a-zA-Z]+\.(push|pop|splice|shift|unshift|sort|reverse)\(/.test(code(file)))
      .map(rel);

    expect(offenders).toEqual([]);
  });
});

describe('financial arithmetic stays in the calculation layer', () => {
  const MONEY_FIELD =
    '(revisedContractValue|eac|projectedProfit|adjustedCostToDate|postedCost|remainingCommitment|' +
    'billedToDate|billingPosition|draftEarnedRevenue|currentBudget|budgetedLaborHours|impact|' +
    'pendingChangeOrderIncurredCost|acceptedRni|acceptedApUnposted|acceptedUnpostedLabor)';

  const presentation = files.filter(
    (file) => rel(file).startsWith('components/') || rel(file).startsWith('app/'),
  );

  it('does not divide by a computed financial value', () => {
    const pattern = new RegExp('/\s*[a-z][\w.]*\.?' + MONEY_FIELD + '\b');
    const offenders = presentation.filter((file) => pattern.test(code(file))).map(rel);
    expect(offenders).toEqual([]);
  });

  it('does not sum or subtract financial values', () => {
    // The original guard looked only for division, so a `reduce` that added days and percentage points to
    // dollars sat in a page component and passed it. Addition is how portfolio roll-ups get written by
    // accident, and it was producing a headline figure that mixed units and treble-counted one problem.
    const patterns = [
      new RegExp(String.raw`reduce\([^)]*\+[^)]*` + MONEY_FIELD, 's'),
      new RegExp(String.raw`\b\w+\.` + MONEY_FIELD + String.raw`\s*[-+]\s*\w+\.` + MONEY_FIELD),
      new RegExp(String.raw`\+=\s*[a-z][\w.]*\.` + MONEY_FIELD + String.raw`\b`),
    ];

    const offenders = presentation
      .filter((file) => patterns.some((pattern) => pattern.test(code(file))))
      .map(rel);
    expect(offenders).toEqual([]);
  });
});

describe('module layering', () => {
  /**
   * The design's §3 table is a *grant* table, not merely an ordering. A plain "must be a lower layer" check
   * lets `src/calculations` import the normalization and reconciliation modules — which is exactly the door
   * the design closed so calculations could not build their own index and re-join.
   */
  const LAYER: [prefix: string, layer: number][] = [
    ['config/', 1],
    ['data/raw/', 2],
    ['domain/', 3],
    ['graph/core', 4],
    ['data/normalize/', 5],
    ['reconciliation/', 6],
    ['calculations/', 7],
    ['graph/build', 8],
    ['exceptions/', 9],
    ['agents/', 10],
    ['workflows/', 11],
    ['components/', 12],
    ['app/', 13],
  ];

  const ALLOWED: Record<number, number[]> = {
    1: [],
    2: [1],
    3: [1],
    4: [1, 3],
    5: [1, 2, 3, 4],
    6: [1, 2, 3, 4],
    7: [1, 3, 4],
    8: [1, 3, 4, 6],
    9: [1, 2, 3, 4, 5, 6, 7, 8],
    10: [1, 2, 3, 4, 5, 6, 7, 8, 9],
    11: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
    12: [1, 3, 7, 11],
    13: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
  };

  const layerOf = (path: string): number => {
    for (const [prefix, layer] of LAYER) if (path.startsWith(prefix)) return layer;
    return 0;
  };

  it('only imports what its layer is granted', () => {
    const violations: string[] = [];

    for (const file of files) {
      const from = rel(file);
      const fromLayer = layerOf(from);
      if (fromLayer === 0) continue;

      const raw = readFileSync(file, 'utf8');
      for (const match of raw.matchAll(/from\s+['"]@\/([^'"]+)['"]/g)) {
        const target = match[1]!;
        const toLayer = layerOf(target);
        if (toLayer === 0 || toLayer === fromLayer) continue;

        if (!ALLOWED[fromLayer]!.includes(toLayer)) {
          violations.push(`${from} (layer ${fromLayer}) imports ${target} (layer ${toLayer})`);
        }
      }
    }

    expect(violations).toEqual([]);
  });
});

describe('the reference oracle is treated as read-only', () => {
  it('no application code writes to the mock data directory', () => {
    const offenders = files
      .filter((file) => /writeFileSync|writeFile|appendFile|createWriteStream/.test(code(file)))
      .map(rel);

    // Accepted adjustments live in the decision ledger; raw source files are never edited.
    expect(offenders).toEqual([]);
  });
});
