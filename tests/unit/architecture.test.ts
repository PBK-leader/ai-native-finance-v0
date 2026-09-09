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
import { ALL_RULES } from '@/exceptions/engine';
import { CLOSE_REVIEW_RULE } from '@/agents/agents';
import { SOURCE_FILES } from '@/data/raw/rawTypes';
import { hasFieldLabel, hasRecordKind } from '@/components/sourceVocabulary';

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
  /**
   * The raw column names, for the layers that are allowed nowhere near them.
   *
   * `(?!\s*:)` excludes one syntactic form: the key of an object literal. Naming a column is not using it,
   * and something has to name them — `SourceRef.fields` carries raw column names all the way to the screen,
   * so a dictionary turning `approved_co_id` into "which change order it came from" is the difference
   * between evidence and a database schema. Every form that could actually re-join still trips this:
   * `row.commitment_id`, `const { commitment_id } = row`, `f(commitment_id)`, `{ x: invoice.commitment_id }`.
   *
   * This replaced a per-file exemption. A path allowlist would have let the *whole* file do anything,
   * defended only by a proxy for the hazard; excluding the one harmless form instead keeps the rule applying
   * to every file, including the dictionary itself.
   */
  const RAW_KEYS =
    /\b(commitment_id|source_doc_id|approved_co_id|sov_item_id|erp_job_id|pm_project_id)\b(?!\s*:)/;

  // Only these modules may read a raw counterparty key.
  const ALLOWED = ['data/raw/', 'data/normalize/', 'reconciliation/'];

  it('no module outside the data and reconciliation layers reads a raw counterparty key', () => {
    const offenders = files
      .filter((file) => !ALLOWED.some((prefix) => rel(file).startsWith(prefix)))
      .filter((file) => RAW_KEYS.test(code(file)))
      .map(rel);

    expect(offenders).toEqual([]);
  });

  it('still catches a read dressed up next to a key of the same name', () => {
    // A guard on the guard: the lookahead must exempt the key and still catch the value beside it.
    expect(RAW_KEYS.test('const x = { commitment_id: row.commitment_id };')).toBe(true);
    expect(RAW_KEYS.test('const x = { commitment_id: "a purchase order" };')).toBe(false);
    expect(RAW_KEYS.test('const { sov_item_id } = billing;')).toBe(true);
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
    'pendingChangeOrderIncurredCost|acceptedRni|acceptedApUnposted|acceptedUnpostedLabor|' +
    'projectedMarginPct|originalMarginPct|percentCompletePct)';

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

describe('every rule can explain itself', () => {
  /**
   * `CLAUDE.md`'s evidence rule requires each exception to show the rule that triggered it. A rule id and a
   * one-line summary satisfy that literally while still leaving the reader unable to check the finding — the
   * question people actually ask is "how did you get that number". `method` is the answer, and a rule that
   * ships without one would present a conclusion with no working.
   */
  // Every finding a screen can show, including the Controller review the Close Orchestrator raises, which is
  // not a detection rule and would otherwise be the one finding nothing checks.
  const EXPLAINABLE = [...ALL_RULES, CLOSE_REVIEW_RULE];

  it('states its method in plain steps', () => {
    // Length, not mere presence: `method: ['']` and `method: ['TODO']` are how this check gets satisfied
    // without anything being explained.
    const missing = EXPLAINABLE.filter(
      (rule) => rule.method.length === 0 || rule.method.some((step) => step.trim().length < 20),
    ).map((rule) => rule.id);

    expect(missing).toEqual([]);
  });

  it('writes those steps for a reader who will never see the code', () => {
    // Raw identifiers are the specific failure this is guarding: a step that says `costIncurredToDate` has
    // described the variable rather than the reasoning. Two humps, so a product name with a single intercap
    // — QuickBooks, eSUB — is still allowed to appear in prose.
    const IDENTIFIER = /_[a-z]|\.csv|\b[a-z]+[A-Z][a-z]*[A-Z]/;

    const offenders = EXPLAINABLE.flatMap((rule) =>
      rule.method.filter((step) => IDENTIFIER.test(step)).map((step) => `${rule.id}: ${step}`),
    );

    expect(offenders).toEqual([]);
  });
});

describe('evidence names every kind of record it can cite', () => {
  /**
   * `recordKind` falls back to the word "Record", which reads as a placeholder rather than a name. The worst
   * case is not a source file but the decision ledger: a human's own answer is the most consequential entry
   * in an audit trail, and it reaches the evidence panel through overlaid forecast snapshots.
   */
  it('names every source file and every record this application produces', () => {
    const applicationOrigins = ['decision-ledger', 'src/agents/agents.ts'];
    const unnamed = [...Object.values(SOURCE_FILES), ...applicationOrigins]
      .filter((file) => !hasRecordKind(file))
      .sort();

    expect(unnamed).toEqual([]);
  });
});

describe('evidence names its source fields in English', () => {
  /**
   * `SourceRef.fields` is how a finding says which part of a record it relied on, and it carries raw column
   * names all the way to the screen. A field with no plain-English name falls back to its raw form, so the
   * panel quietly shows a database column to a finance team — the exact failure this vocabulary exists to
   * prevent, and one nobody notices until it is in front of a customer.
   */
  it('every field a rule can cite has a plain-English name', () => {
    const cited = new Set<string>();

    // Two shapes reach `SourceRef.fields`: a named `fields:` property, and the trailing array argument of
    // normalization's `ref(collection, id, [...])` helper. Reading only the first is how this test passed
    // vacuously on five fields while twenty-three others went unlabelled. The record-id group allows commas
    // so a computed id — `ref('x', key(a, b), [...])` — does not silently drop that call's fields.
    const LISTS = [/fields:\s*\[([^\]]*)\]/g, /\bref\(\s*'[A-Za-z]+'\s*,[^[]+,\s*\[([^\]]*)\]/g];

    // Every source file, not a hand-listed few: `SourceRef` is a plain type and any module may build one, so
    // naming three producers would quietly stop covering the fourth.
    for (const file of files) {
      const source = readFileSync(file, 'utf8');
      for (const pattern of LISTS) {
        for (const list of source.matchAll(pattern)) {
          // Only quoted literals. A field built at runtime — a cost code, say — is data, not a column name.
          for (const name of list[1]!.matchAll(/'([A-Za-z_][A-Za-z0-9_]*)'/g)) cited.add(name[1]!);
        }
      }
    }

    // A guard on the guard: if the extraction silently stops matching, the test must fail rather than pass
    // vacuously on an empty set.
    expect(cited.size).toBeGreaterThan(15);

    expect([...cited].filter((field) => !hasFieldLabel(field)).sort()).toEqual([]);
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
