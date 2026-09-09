/**
 * The desk is only useful if it is exactly right: the header count, the desk list and the Command Center's
 * "waiting on" list must all be the same numbers, and every threshold a rule cites must have words.
 */

import { describe, expect, it } from 'vitest';
import { V0_CONFIG } from '@/config/v0Config';
import { getNormalized } from '@/data/normalize/model';
import { buildReconciledView } from '@/reconciliation/buildReconciledView';
import { openTasks, openTasksForPerson, replay } from '@/workflows/replay';
import { demoLaborDeterioration } from '@/workflows/demos';
import { personId as toPersonId } from '@/domain/ids';
import type { CanonicalModel } from '@/domain/entities';
import type { DecisionProjection } from '@/domain/workflow';
import { PERSONAS } from '@/components/persona';
import { describeThreshold, hasThresholdLabel } from '@/components/thresholdLabels';

const { model, reconciliationKeys } = getNormalized();
const buildView = (m: CanonicalModel, projection: DecisionProjection) =>
  buildReconciledView(m, reconciliationKeys, projection);

describe('what is on each desk', () => {
  const state = replay(model, buildView, V0_CONFIG, []);

  it('gives every open task to exactly one person, and to nobody else', () => {
    const all = openTasks(state);
    const perPerson = model.people.map((p) => openTasksForPerson(state, p.id));
    expect(perPerson.reduce((n, list) => n + list.length, 0)).toBe(all.length);

    const seen = new Set<string>();
    for (const list of perPerson) {
      for (const task of list) {
        expect(seen.has(task.id), task.id).toBe(false);
        seen.add(task.id);
      }
    }
  });

  it('matches the "waiting on" figures the Command Center shows at baseline', () => {
    // These are the numbers a founder reads off the screen; if they drift, the demo lies.
    const jamie = openTasksForPerson(state, toPersonId(PERSONAS.accountant.personId));
    expect(jamie).toHaveLength(11);
    expect(jamie.filter((t) => t.blocking)).toHaveLength(9);

    const sam = openTasksForPerson(state, toPersonId(PERSONAS.controller.personId));
    expect(sam).toHaveLength(6);
    // Six things on the Controller's radar, none holding the close: nothing needs a decision until a human
    // answer has moved the numbers. (Status cannot express this — every Controller-routed task is
    // "waiting for Controller" — so the desk splits on `blocking`, and so does this test.)
    expect(sam.filter((t) => t.blocking)).toHaveLength(0);

    const dana = openTasksForPerson(state, toPersonId(PERSONAS.cfo.personId));
    expect(dana).toHaveLength(0);
  });

  it('puts blocking items first, then the biggest dollars', () => {
    for (const person of model.people) {
      const list = openTasksForPerson(state, person.id);
      const impact = (id: string) => state.current.exceptions.find((e) => e.id === id)?.impact ?? 0;
      for (let i = 1; i < list.length; i += 1) {
        const prev = list[i - 1]!;
        const cur = list[i]!;
        if (prev.blocking === cur.blocking) {
          expect(impact(prev.exceptionId)).toBeGreaterThanOrEqual(impact(cur.exceptionId));
        } else {
          expect(prev.blocking).toBe(true);
        }
      }
    }
  });

  it('puts a Controller sign-off on the Controller’s desk once a material answer lands', () => {
    const after = replay(model, buildView, V0_CONFIG, demoLaborDeterioration);
    const sam = openTasksForPerson(after, toPersonId(PERSONAS.controller.personId));
    const signOff = sam.filter((t) => t.blocking);
    expect(signOff).toHaveLength(1);
    // It is the orchestrator's review of the PM's material answer, and it goes to the top of the desk.
    expect(signOff[0]!.exceptionId.startsWith('CLOSE_CONTROLLER_REVIEW')).toBe(true);
    expect(sam[0]!.id).toBe(signOff[0]!.id);
  });
});

describe('thresholds read as words', () => {
  const state = replay(model, buildView, V0_CONFIG, demoLaborDeterioration);

  it('has a label for every configured threshold', () => {
    for (const name of Object.keys(V0_CONFIG.thresholds)) expect(hasThresholdLabel(name), name).toBe(true);
  });

  it('has a label for every threshold any rule actually cites', () => {
    for (const exception of state.current.exceptions) {
      for (const t of exception.evidence.thresholds) {
        expect(hasThresholdLabel(t.name), `${exception.ruleId} cites ${t.name}`).toBe(true);
        expect(describeThreshold(t)).not.toMatch(/[A-Z][a-z]+[A-Z]/); // no camelCase leaks through
      }
    }
  });

  it('formats the configured value in its own unit', () => {
    expect(describeThreshold({ name: 'laborBurnAheadProgressPercentagePoints', value: 10, comparator: 'GTE' }))
      .toBe('Hours used ahead of progress ≥ 10 pts');
    expect(describeThreshold({ name: 'controllerEacChangeDollar', value: 100_000, comparator: 'GTE' }))
      .toBe('Forecast movement needing Controller sign-off ≥ $100,000');
    expect(describeThreshold({ name: 'costCodeOverrunPct', value: 0.1, comparator: 'GTE' }))
      .toBe('Cost code over budget by ≥ 10.0%');
  });
});
