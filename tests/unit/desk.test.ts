/**
 * The desk is only useful if it is exactly right: the header count, the desk list and the Command Center's
 * "waiting on" list must all be the same numbers, an escalation must move an item to the desk it is now
 * waiting on, and every threshold a rule cites must have words.
 */

import { describe, expect, it } from 'vitest';
import { V0_CONFIG } from '@/config/v0Config';
import { getNormalized } from '@/data/normalize/model';
import { buildReconciledView } from '@/reconciliation/buildReconciledView';
import { openTasks, openTasksForPerson, replay, waitingOnByPerson } from '@/workflows/replay';
import { demoCloseP1004, demoLaborDeterioration } from '@/workflows/demos';
import { GUIDE } from '@/workflows/demoScript';
import { PERSONAS, isPersonaId } from '@/workflows/personas';
import type { CanonicalModel } from '@/domain/entities';
import type { DecisionProjection } from '@/domain/workflow';
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

  it('shows the Command Center exactly what each desk shows', () => {
    // Structural parity: the "waiting on" list is built from the per-person selector, so it cannot drift.
    const waiting = waitingOnByPerson(state, model);
    for (const entry of waiting) {
      if (!entry.person) continue;
      expect(entry.tasks.map((t) => t.id)).toEqual(openTasksForPerson(state, entry.person.id).map((t) => t.id));
    }
    expect(waiting.reduce((n, e) => n + e.tasks.length, 0)).toBe(openTasks(state).length);
  });

  it('matches the figures the demo narrates at baseline', () => {
    // These are the numbers a founder reads off the screen; if they drift, the demo lies.
    const jamie = openTasksForPerson(state, PERSONAS.accountant.personId);
    expect(jamie).toHaveLength(11);
    expect(jamie.filter((t) => t.blocking)).toHaveLength(9);

    const sam = openTasksForPerson(state, PERSONAS.controller.personId);
    expect(sam).toHaveLength(6);
    // Six things on the Controller's radar, none holding the close: nothing needs a decision until a human
    // answer has moved the numbers.
    expect(sam.filter((t) => t.blocking)).toHaveLength(0);

    expect(openTasksForPerson(state, PERSONAS.cfo.personId)).toHaveLength(0);
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

  it('puts a Controller review on the Controller’s desk, on top, once a material answer lands', () => {
    const after = replay(model, buildView, V0_CONFIG, demoLaborDeterioration);
    const sam = openTasksForPerson(after, PERSONAS.controller.personId);
    const holding = sam.filter((t) => t.blocking);
    expect(holding).toHaveLength(1);
    expect(holding[0]!.exceptionId.startsWith('CLOSE_CONTROLLER_REVIEW')).toBe(true);
    expect(sam[0]!.id).toBe(holding[0]!.id);
  });

  it('moves an escalated item to the Controller’s desk and off the escalator’s', () => {
    // The close-P-1004 script has the accountant escalate the PO-0023 overrun before the Controller
    // accepts the risk. Replay up to and including the escalation only.
    const escalationIndex = demoCloseP1004.findIndex((d) => d.payload.type === 'ESCALATE');
    expect(escalationIndex).toBeGreaterThan(-1);
    const escalation = demoCloseP1004[escalationIndex]!;
    const state = replay(model, buildView, V0_CONFIG, demoCloseP1004.slice(0, escalationIndex + 1));

    const task = state.current.tasks.find((t) => t.exceptionId === escalation.exceptionId)!;
    expect(task.status).toBe('WAITING_FOR_CONTROLLER');
    expect(task.ownerRole).toBe('Controller');
    expect(task.ownerPersonId).toBe(PERSONAS.controller.personId);

    const sam = openTasksForPerson(state, PERSONAS.controller.personId).map((t) => t.id);
    expect(sam).toContain(task.id);
    const escalator = openTasksForPerson(state, escalation.actor.personId).map((t) => t.id);
    expect(escalator).not.toContain(task.id);

    // The exception still records where the rule routed it — that is how the desk knows it was handed up.
    const exception = state.current.exceptions.find((e) => e.id === escalation.exceptionId)!;
    expect(exception.ownerRole).toBe('Project Accountant');
  });
});

describe('the guided demo sits in real chairs', () => {
  it('names only personas that exist', () => {
    for (const step of GUIDE) {
      if (step.persona) expect(isPersonaId(step.persona), step.label).toBe(true);
    }
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
