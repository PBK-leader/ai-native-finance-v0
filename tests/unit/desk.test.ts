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
import { AGENTS } from '@/agents/agents';
import { isSettled } from '@/domain/workflow';
import { taskStatusFor } from '@/domain/taskStatus';
import { exceptionId, projectId } from '@/domain/ids';
import type { CanonicalModel } from '@/domain/entities';
import type { DecisionProjection, ReviewDecision } from '@/domain/workflow';
import { describeThreshold, hasThresholdLabel } from '@/components/thresholdLabels';
import { needsControllerDecision } from '@/components/desk/ControllerDesk';

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

  it('never routes work to the CFO, who consumes rather than acts', () => {
    // `roleForWaitingState` collapses CFO into Controller, which is only safe while nothing routes there.
    for (const agent of AGENTS) expect(agent.routesTo, agent.id).not.toContain('CFO');
    for (const exception of state.current.exceptions) expect(exception.ownerRole).not.toBe('CFO');
  });

  it('describes each persona exactly as the canonical model does', () => {
    for (const [id, persona] of Object.entries(PERSONAS)) {
      const person = model.index.personById.get(persona.personId);
      expect(person, id).toBeDefined();
      expect(person!.name).toBe(persona.name);
      expect(person!.role).toBe(persona.role);
    }
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
    expect(needsControllerDecision(task, exception.ownerRole)).toBe(true);

    // And the Command Center agrees: it is listed against Sam, not the accountant who escalated it.
    const waiting = waitingOnByPerson(state, model);
    const samsEntry = waiting.find((e) => e.person?.id === PERSONAS.controller.personId);
    expect(samsEntry?.tasks.map((t) => t.id)).toContain(task.id);
    const escalatorEntry = waiting.find((e) => e.person?.id === escalation.actor.personId);
    expect(escalatorEntry?.tasks.map((t) => t.id) ?? []).not.toContain(task.id);
  });

  it('keeps a settled item attributed to whoever actually settled it', () => {
    // The Controller accepts the risk on the item the accountant escalated. Once settled it must stay with
    // the Controller — reverting to the original routing would contradict the ledger, the work queue's
    // settled view and the graph's "assigned to" edge.
    const state = replay(model, buildView, V0_CONFIG, demoCloseP1004);
    const escalation = demoCloseP1004.find((d) => d.payload.type === 'ESCALATE')!;
    const settled = state.current.tasks.find((t) => t.exceptionId === escalation.exceptionId)!;

    expect(isSettled(settled.status)).toBe(true);
    expect(settled.ownerRole).toBe('Controller');
    expect(settled.ownerPersonId).toBe(PERSONAS.controller.personId);

    // A task settled by the person it was routed to is unaffected.
    const direct = state.current.tasks.find(
      (t) => isSettled(t.status) && t.exceptionId !== escalation.exceptionId,
    )!;
    const directException = state.current.exceptions.find((e) => e.id === direct.exceptionId)!;
    expect(direct.ownerRole).toBe(directException.ownerRole);
  });

  it('leaves a PM’s desk when the PM escalates', () => {
    // The accountant path is covered above; this is the other transition row into the Controller.
    const question = state.current.tasks.find((t) => t.status === 'WAITING_FOR_PM')!;
    const pm = model.people.find((p) => p.id === question.ownerPersonId)!;
    const exception = state.current.exceptions.find((e) => e.id === question.exceptionId)!;
    const decision: ReviewDecision = {
      id: 'DEC-PM-ESCALATE',
      exceptionId: question.exceptionId,
      subject: { projectId: question.projectId, canonicalId: exception.subjectId },
      actor: { personId: pm.id, role: 'Project Manager' },
      effectiveDate: V0_CONFIG.closeDate,
      recordedAt: `${V0_CONFIG.closeDate}T09:00:00.000Z`,
      payload: { type: 'ESCALATE', reason: 'Needs a call from finance.' },
    };
    const escalated = replay(model, buildView, V0_CONFIG, [decision]);

    expect(escalated.ignored).toHaveLength(0);
    const moved = escalated.current.tasks.find((t) => t.exceptionId === question.exceptionId)!;
    expect(moved.ownerPersonId).toBe(PERSONAS.controller.personId);
    expect(openTasksForPerson(escalated, pm.id).map((t) => t.id)).not.toContain(moved.id);
    expect(openTasksForPerson(escalated, PERSONAS.controller.personId).map((t) => t.id)).toContain(moved.id);
  });
});

describe('who holds a task when it settles', () => {
  // Reducer-level, so every settling row is pinned rather than only the ones a demo happens to walk.
  const close = V0_CONFIG.closeDate;
  const decide = (
    role: 'Project Manager' | 'Project Accountant' | 'Controller',
    payload: ReviewDecision['payload'],
    id = `DEC-${role}`,
  ): ReviewDecision => ({
    id,
    exceptionId: exceptionId('AP_RNI', projectId('P-1001'), 'CMT-PO-0004'),
    subject: { projectId: projectId('P-1001'), canonicalId: 'CMT-PO-0004' },
    actor: { personId: PERSONAS.controller.personId, role },
    effectiveDate: close,
    recordedAt: `${close}T09:00:00.000Z`,
    payload,
  });

  const settledRoleAfter = (routedTo: 'Project Manager' | 'Project Accountant', ds: ReviewDecision[]) =>
    taskStatusFor(routedTo, ds, close).settledWaitingRole;

  it('records the accountant when the accountant resolves their own item', () => {
    const entry = taskStatusFor(
      'Project Accountant',
      [decide('Project Accountant', { type: 'REJECT_ADJUSTMENT', reason: 'Invoice arrived; no cutoff.' })],
      close,
    );
    expect(entry.status).toBe('RESOLVED');
    expect(entry.settledWaitingRole).toBe('Project Accountant');
  });

  it('records the PM when the PM answers their own question', () => {
    expect(settledRoleAfter('Project Manager', [decide('Project Manager', { type: 'PM_ANSWER', answer: 'Done.' })]))
      .toBe('Project Manager');
  });

  it('records the Controller once an item has been escalated to them', () => {
    const entry = taskStatusFor(
      'Project Accountant',
      [
        decide('Project Accountant', { type: 'ESCALATE', reason: 'Needs a judgement.' }, 'DEC-ESC'),
        decide('Controller', { type: 'ACCEPT_RISK', rationale: 'Accepted for this close.' }, 'DEC-RISK'),
      ],
      close,
    );
    expect(entry.status).toBe('ACCEPTED_RISK');
    expect(entry.settledWaitingRole).toBe('Controller');
  });

  it('records custody, not authorship, when a Controller settles someone else’s open item', () => {
    // A Controller may accept a risk on anything. The task then stays with the person who held it; who
    // decided is the ledger's business, and the card renders it from `ReviewDecision.actor`.
    expect(settledRoleAfter('Project Accountant', [
      decide('Controller', { type: 'ACCEPT_RISK', rationale: 'Immaterial; closing.' }),
    ])).toBe('Project Accountant');
  });

  it('is null while the task is still open', () => {
    expect(settledRoleAfter('Project Accountant', [])).toBeNull();
    expect(settledRoleAfter('Project Accountant', [
      decide('Project Accountant', { type: 'ESCALATE', reason: 'Over to you.' }),
    ])).toBeNull();
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
