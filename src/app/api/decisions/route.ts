/**
 * Record a human decision.
 *
 * Validation lives here, on the write path, not inside the replay engine. The ledger is append-only and
 * replay runs on every render, so a decision that threw during reduction would break every screen
 * permanently with no way to remove it. Refusing it here means the user gets a readable reason and the
 * ledger only ever contains decisions the workflow actually accepted.
 */

import { NextResponse } from 'next/server';
import { V0_CONFIG } from '@/config/v0Config';
import { checkTransition } from '@/domain/taskStatus';
import { waitingStateFor } from '@/domain/workflow';
import type { DecisionPayload, ReviewDecision } from '@/domain/workflow';
import { personId as toPersonId, projectId as toProjectId } from '@/domain/ids';
import type { ExceptionId, ProjectId } from '@/domain/ids';
import { PERSONAS, isPersonaId } from '@/components/persona';
import { canonical, buildView, engineState } from '@/workflows/engine';
import { decisionStore } from '@/workflows/decisionStore';
import { projectDecisions } from '@/workflows/projectDecisions';
import { checkEligibility } from '@/workflows/eligibility';
import { validateDecisionPayload } from '../validateBody';

type Body = {
  exceptionId: string;
  projectId: string | null;
  canonicalId: string;
  persona: string;
  payload: DecisionPayload;
};

export async function POST(request: Request) {
  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ reason: 'Malformed request.' }, { status: 400 });
  }

  if (!body?.exceptionId || !isPersonaId(body.persona)) {
    return NextResponse.json({ reason: 'Missing exception or persona.' }, { status: 400 });
  }

  // Narrow untrusted JSON into the domain's own types before anything downstream touches it.
  const payload = validateDecisionPayload(body.payload);
  if (!payload.ok) {
    return NextResponse.json({ reason: payload.reason }, { status: 400 });
  }

  const persona = PERSONAS[body.persona];
  const state = engineState();
  const task = state.current.tasks.find((t) => t.exceptionId === body.exceptionId);

  if (!task) {
    return NextResponse.json(
      { reason: 'That item is no longer open — it may have been resolved by an earlier answer.' },
      { status: 409 },
    );
  }

  const decision: ReviewDecision = {
    id: `DEC-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    exceptionId: body.exceptionId as ExceptionId,
    subject: {
      projectId: body.projectId ? (toProjectId(body.projectId) as ProjectId) : null,
      canonicalId: body.canonicalId,
    },
    actor: { personId: toPersonId(persona.personId.replace(/^PER-/, '')), role: persona.role },
    // Business date, deliberately not the wall clock: an overlay dated after the close would be filtered out
    // of every as-of selector and the answer would silently change nothing.
    effectiveDate: V0_CONFIG.closeDate,
    recordedAt: new Date().toISOString(),
    payload: payload.value,
  };

  const currentStatus = task.status ?? waitingStateFor(task.ownerRole);
  const transitionProblem = checkTransition(currentStatus, decision, V0_CONFIG.closeDate);
  if (transitionProblem) {
    return NextResponse.json({ reason: transitionProblem.reason }, { status: 422 });
  }

  const model = canonical();
  const view = buildView(model, projectDecisions(model, state.decisions));
  const eligibilityProblem = checkEligibility({ model, view, config: V0_CONFIG }, decision);
  if (eligibilityProblem) {
    return NextResponse.json({ reason: eligibilityProblem.reason }, { status: 422 });
  }

  decisionStore().append(decision);
  return NextResponse.json({ ok: true, decisionId: decision.id });
}
