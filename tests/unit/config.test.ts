/**
 * The typed config module and the machine-readable config shipped with the mock data must never drift.
 *
 * `src/config/v0Config.ts` is the single runtime source of truth, transcribed from `docs/product/V0_CONFIG.md`.
 * `reference/client_config.json` is part of the mock-data oracle. If someone edits one and not the other, a
 * rule silently starts using a different threshold than the documentation and the reference data assume.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { V0_CONFIG, type Thresholds } from '@/config/v0Config';

type ClientConfigJson = {
  closeDate: string;
  priorComparisonDate: string;
  overtimeCostMultiplier: number;
  thresholds: Record<string, number>;
};

const reference = JSON.parse(
  readFileSync(
    join(process.cwd(), 'data', 'mock', 'summit_mep', 'reference', 'client_config.json'),
    'utf8',
  ),
) as ClientConfigJson;

describe('V0_CONFIG agrees with the mock-data reference config', () => {
  it('uses the same close and prior comparison dates', () => {
    expect(V0_CONFIG.closeDate).toBe(reference.closeDate);
    expect(V0_CONFIG.priorComparisonDate).toBe(reference.priorComparisonDate);
  });

  it('uses the same overtime cost multiplier', () => {
    expect(V0_CONFIG.overtimeCostMultiplier).toBe(reference.overtimeCostMultiplier);
    // Stated explicitly in FINANCIAL_LOGIC_V0.md for Summit MEP.
    expect(V0_CONFIG.overtimeCostMultiplier).toBe(1.5);
  });

  it('defines exactly the same threshold names', () => {
    expect(Object.keys(V0_CONFIG.thresholds).sort()).toEqual(Object.keys(reference.thresholds).sort());
  });

  it('uses the same value for every threshold', () => {
    for (const [name, value] of Object.entries(reference.thresholds)) {
      expect(V0_CONFIG.thresholds[name as keyof Thresholds], `threshold ${name}`).toBe(value);
    }
  });

  it('ships the 29 thresholds the mock-data validator counts', () => {
    expect(Object.keys(V0_CONFIG.thresholds)).toHaveLength(29);
  });
});
