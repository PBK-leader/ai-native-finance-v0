/**
 * The three required end-to-end demonstrations, expressed as decision lists.
 *
 * Because all derived state is a pure function of the ledger, a demo *is* a list of decisions — there is no
 * setup, no fixture, no mocking. The same lists drive the workflow tests and the "run demo" buttons in the
 * UI, so what the tests prove is exactly what a customer sees.
 */

import { V0_CONFIG } from '@/config/v0Config';
import {
  changeOrderId, commitmentId, costCodeId, exceptionId, laborAggregateId, personId, projectId,
} from '@/domain/ids';
import type { ReviewDecision } from '@/domain/workflow';

const CLOSE = V0_CONFIG.closeDate;

const PM_ALEX = { personId: personId('PERS-PM1'), role: 'Project Manager' as const };
const PM_MORGAN = { personId: personId('PERS-PM4'), role: 'Project Manager' as const };
const ACCOUNTANT_JAMIE = { personId: personId('PERS-PA1'), role: 'Project Accountant' as const };
const ACCOUNTANT_PRIYA = { personId: personId('PERS-PA2'), role: 'Project Accountant' as const };
const CONTROLLER = { personId: personId('PERS-CTRL'), role: 'Controller' as const };

const P1001 = projectId('P-1001');
const P1004 = projectId('P-1004');

/**
 * Demo 1 — Labour deterioration.
 *
 * The Forecast Agent finds that cost code 260200 on Riverside Office Tower has burned 65% of its budgeted
 * hours to deliver 52% of the work. It asks the project manager for a revised remaining position rather than
 * for a spreadsheet. The PM answers with materially higher remaining cost and hours, EAC and margin
 * recompute, and the movement is large enough that the Close Orchestrator escalates to the Controller.
 */
export const demoLaborDeterioration: ReviewDecision[] = [
  {
    id: 'DEC-DEMO1-PM',
    exceptionId: exceptionId('FC_LABOR_BURN', P1001, costCodeId(P1001, '260200')),
    subject: { projectId: P1001, canonicalId: costCodeId(P1001, '260200') },
    actor: PM_ALEX,
    effectiveDate: CLOSE,
    recordedAt: `${CLOSE}T09:00:00.000Z`,
    payload: {
      type: 'PM_FORECAST_UPDATE',
      lines: [
        {
          costCode: '260200',
          // Was 320,000 / 11,215 hours. Productivity has not recovered, so both go up materially.
          remainingUncommittedCost: 445_000,
          remainingLaborHours: 14_800,
          comment:
            'Second-shift crew is running roughly 20% below planned productivity on the upper floors. ' +
            'Remaining hours re-estimated bottom-up with the general foreman; no recovery assumed.',
        },
      ],
    },
  },
];

/**
 * Demo 2 — Received-not-invoiced equipment.
 *
 * $120,000 of switchgear has been received on PO-0004 but not invoiced. The accountant accepts the cutoff
 * adjustment. Cost to date rises, remaining commitment falls by the same amount, and — the point of the
 * demo — EAC does not move, because the obligation was already inside the commitment. What does move is
 * percent complete, draft earned revenue and the billing position.
 */
export const demoReceivedNotInvoiced: ReviewDecision[] = [
  {
    id: 'DEC-DEMO2-RNI',
    exceptionId: exceptionId('AP_RNI', P1001, commitmentId('PO-0004')),
    subject: { projectId: P1001, canonicalId: commitmentId('PO-0004') },
    actor: ACCOUNTANT_JAMIE,
    effectiveDate: CLOSE,
    recordedAt: `${CLOSE}T10:15:00.000Z`,
    payload: {
      type: 'ACCEPT_ADJUSTMENT',
      adjustmentType: 'RNI',
      subjectId: commitmentId('PO-0004'),
      amount: 120_000,
      note:
        'Switchgear confirmed delivered to site 22 July and inspected. Vendor invoice not yet received; ' +
        'accruing to the correct period.',
    },
  },
];

/**
 * Demo 3 — Change-order and billing readiness.
 *
 * CO-1004-A was approved for $420,000 but never reached the schedule of values, so the SOV is $420,000 short
 * of the revised contract and the project cannot close. The accountant records the missing line. Both
 * blocking exceptions clear — and a new, non-blocking one appears, because fixing the data reveals $420,000
 * of approved work that has never been billed.
 */
export const demoChangeOrderBilling: ReviewDecision[] = [
  {
    id: 'DEC-DEMO3-SOV',
    exceptionId: exceptionId('CO_MISSING_SOV', P1004, changeOrderId('CO-1004-A')),
    subject: { projectId: P1004, canonicalId: changeOrderId('CO-1004-A') },
    actor: ACCOUNTANT_PRIYA,
    effectiveDate: CLOSE,
    recordedAt: `${CLOSE}T11:30:00.000Z`,
    payload: {
      type: 'RECORD_SOV_CORRECTION',
      changeOrderId: changeOrderId('CO-1004-A'),
      scheduledValue: 420_000,
      retainagePct: 5,
    },
  },
];

/**
 * The full close walkthrough for Central University Science Lab.
 *
 * Every blocking item on P-1004 gets an answer, so the project actually reaches close-ready. This is the
 * sequence to run in front of a customer: five blocking problems, five different humans, one project that
 * goes from "not ready" to "ready" with a complete audit trail.
 */
export const demoCloseP1004: ReviewDecision[] = [
  ...demoChangeOrderBilling,
  {
    // The unmapped source project holds the close for the whole portfolio, not for one job — "which project
    // is this?" is precisely the unanswered question. So it has to be settled before any project can close.
    id: 'DEC-CLOSE-UNMAPPED',
    exceptionId: exceptionId('DQ_PROJECT_MAP', null, 'PC-UNKNOWN-88'),
    subject: { projectId: null, canonicalId: 'PC-UNKNOWN-88' },
    actor: ACCOUNTANT_JAMIE,
    effectiveDate: CLOSE,
    recordedAt: `${CLOSE}T09:30:00.000Z`,
    payload: {
      type: 'REJECT_ADJUSTMENT',
      reason:
        'PC-UNKNOWN-88 is a small service project billed outside the job-cost system. Confirmed with ' +
        'operations that it carries no project cost, labour or billing in this period, so it is excluded ' +
        'from the close. Master-data mapping to be set up before next period.',
    },
  },
  {
    id: 'DEC-CLOSE-LABOR',
    exceptionId: exceptionId('LABOR_MISSING_POSTING', P1004, laborAggregateId(P1004, '260200')),
    subject: { projectId: P1004, canonicalId: laborAggregateId(P1004, '260200') },
    actor: ACCOUNTANT_PRIYA,
    effectiveDate: CLOSE,
    recordedAt: `${CLOSE}T11:45:00.000Z`,
    payload: {
      type: 'ACCEPT_ADJUSTMENT',
      adjustmentType: 'UNPOSTED_LABOR',
      subjectId: laborAggregateId(P1004, '260200'),
      amount: 17_752,
      note: 'Time approved in the field but not exported to payroll before cutoff. Accruing at crew rates.',
    },
  },
  {
    id: 'DEC-CLOSE-OVERRUN',
    exceptionId: exceptionId('AP_COMMITMENT_OVERRUN', P1004, commitmentId('PO-0023')),
    subject: { projectId: P1004, canonicalId: commitmentId('PO-0023') },
    actor: ACCOUNTANT_PRIYA,
    effectiveDate: CLOSE,
    recordedAt: `${CLOSE}T12:10:00.000Z`,
    payload: {
      type: 'ESCALATE',
      reason:
        'Vendor invoiced $35,000 above the purchase order. Field confirms the extra scope was directed ' +
        'verbally. Needs Controller judgement on whether to accrue or dispute.',
    },
  },
  {
    id: 'DEC-CLOSE-OVERRUN-CTRL',
    exceptionId: exceptionId('AP_COMMITMENT_OVERRUN', P1004, commitmentId('PO-0023')),
    subject: { projectId: P1004, canonicalId: commitmentId('PO-0023') },
    actor: CONTROLLER,
    effectiveDate: CLOSE,
    recordedAt: `${CLOSE}T14:00:00.000Z`,
    payload: {
      type: 'ACCEPT_RISK',
      rationale:
        'Accepting the $35,000 overrun in this close. Scope was directed and the vendor has performed; a ' +
        'change order to the PO is being raised next period. Reviewed against the field superintendent log.',
    },
  },
  {
    id: 'DEC-CLOSE-UNAPPROVED-CO',
    exceptionId: exceptionId('CO_UNAPPROVED_COST', P1004, changeOrderId('CO-1004-B')),
    subject: { projectId: P1004, canonicalId: changeOrderId('CO-1004-B') },
    actor: PM_MORGAN,
    effectiveDate: CLOSE,
    recordedAt: `${CLOSE}T15:20:00.000Z`,
    payload: {
      type: 'PM_ANSWER',
      answer:
        'Lighting control redesign was directed by the owner\'s architect in writing on 12 June. Formal ' +
        'change order is with the GC for signature; work continues at owner direction.',
    },
  },
];

export const DEMOS = {
  laborDeterioration: {
    id: 'labor-deterioration',
    name: 'Labour deterioration on Riverside Office Tower',
    summary:
      'The Forecast Agent spots hours running ahead of progress, asks the PM one specific question, and the ' +
      'answer moves EAC enough to require Controller review.',
    decisions: demoLaborDeterioration,
  },
  receivedNotInvoiced: {
    id: 'received-not-invoiced',
    name: 'Received-not-invoiced switchgear',
    summary:
      'Accepting a $120,000 cutoff adjustment moves cost from commitment into cost to date, changing the ' +
      'billing position without changing the forecast final cost.',
    decisions: demoReceivedNotInvoiced,
  },
  changeOrderBilling: {
    id: 'change-order-billing',
    name: 'Approved change order missing from the SOV',
    summary:
      'A $420,000 approved change order never reached the schedule of values. Recording it clears two ' +
      'blocking exceptions and reveals unbilled revenue.',
    decisions: demoChangeOrderBilling,
  },
  closeP1004: {
    id: 'close-p1004',
    name: 'Full close: Central University Science Lab',
    summary:
      'Work every blocking item on P-1004 to resolution — including a Controller risk acceptance — until the ' +
      'project is close-ready.',
    decisions: demoCloseP1004,
  },
} as const;

export type DemoId = keyof typeof DEMOS;
