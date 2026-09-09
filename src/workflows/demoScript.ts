/**
 * The guided walkthrough script.
 *
 * The demo dropdown loaded decisions and left you on the same screen with no idea what had changed. This is
 * the fix: a narrated path that says what to click, what to say, and what to point at — so the product can be
 * shown by someone who did not build it, without holding the whole workflow in their head.
 *
 * Each step names the screen it belongs on, so the guide can navigate there itself.
 */

import type { DemoId } from './demos';
import type { PersonaId } from './personas';

export type GuideStep = {
  /** Short label for the progress rail. */
  label: string;
  /** The headline for this beat of the story. */
  title: string;
  /** What to say out loud. Written as speech, not documentation. */
  say: string;
  /** Where to look on the screen once it loads. */
  lookFor: string[];
  /** Why this beat matters commercially — the "so what". */
  soWhat: string;
  /** Where the guide navigates for this step. */
  href: string;
  /**
   * Ledger state this step needs. `reset` clears everything; a demo id loads that scenario. Omitted means
   * "leave the ledger alone", used for steps that only change which screen you are looking at.
   */
  load?: DemoId | 'reset';
  /** Whose chair to sit in for this beat. Home is cut per person, so the story has to say who is looking. */
  persona?: PersonaId;
};

export const GUIDE: GuideStep[] = [
  {
    label: 'The problem',
    title: 'Six live jobs, and nobody can close the books',
    say:
      "This is Summit MEP — a $37 million electrical, mechanical and plumbing contractor with six active " +
      "jobs. We're sitting in the Controller's chair on the last day of the month, trying to close. Look at " +
      "'Ready to close': zero of six. Not because the jobs are in trouble, but because the finance team is " +
      "still chasing answers that live in four different systems.",
    lookFor: [
      'Ready to close: 0 of 6',
      'Projected profit is down $675k since last month',
      '$1.12M underbilled — work performed that has not been invoiced',
      'Top right: the system already knows what is waiting on the Controller personally',
    ],
    soWhat:
      'Today this is three weeks of a controller and two accountants emailing project managers. That is the ' +
      'cost we are attacking.',
    href: '/',
    load: 'reset',
    persona: 'controller',
  },
  {
    label: 'Meet the agents',
    title: 'Four agents, each with a declared job, evidence scope, and a hard limit on what it can do',
    say:
      "Before the numbers: what found all this? Four agents. Three of them — Cost Control, Forecast, and " +
      "Billing & Change Order — own disjoint sets of rules and run the same loop: observe the records they " +
      "are entitled to see, detect, open an evidence-backed task, and route it to a named person. The fourth, " +
      "the Close Orchestrator, owns no detection rule at all — its only job is deciding whether a project can " +
      "close and escalating to a Controller when a human answer moves the numbers materially. This isn't a " +
      "label on a function. Each agent declares the exact list of actions it is allowed to emit, and the " +
      "runtime rejects anything outside it — that list, and the live count next to it, is what you're looking " +
      "at on this screen right now.",
    lookFor: [
      'Each agent\'s goal, evidence scope, and owned rules, in the language a controller would use',
      'The allowed-actions list with a live count — this session has already run the baseline pass',
      'The Close Orchestrator owns zero detection rules; it only judges readiness and escalates',
    ],
    soWhat:
      'This is the difference between "we added AI" and an auditable system: every action an agent can ever ' +
      'take is enumerated and enforced in code, not asserted in a slide.',
    href: '/agents',
  },
  {
    label: 'What is blocking',
    title: 'Nineteen things are blocking the close — each with evidence',
    say:
      "The system has already done the investigation. Nineteen blocking items, each one with the source " +
      "records behind it, the dollar impact, who should act, and what they should do. Nobody had to open a " +
      "spreadsheet. Scroll the first card: it names the exact change order, the exact amount, and the exact " +
      "rule that fired.",
    lookFor: [
      '19 blocking items, $2.4M of value affected',
      'Every card leads with what is at stake, who owns it, and the next step',
      'Open "Show the evidence" on any card to see the test that fired and the underlying rows',
    ],
    soWhat:
      'This is the difference from a dashboard. A dashboard tells you the number is wrong. This tells you ' +
      'which record is wrong, who owns it, and what to do about it.',
    href: '/work-queue?status=blocking',
  },
  {
    label: 'A real find',
    title: '$420,000 of approved work missing from the billing schedule',
    say:
      "Here is one the finance team would not have found until the job closed out. A change order for " +
      "$420,000 was approved by the client back in June — but it never made it onto the schedule of values, " +
      "which is the document you actually bill against. So the schedule is $420,000 short of the contract, " +
      "and that money cannot be invoiced.",
    lookFor: [
      'Schedule of values shows a ($420,000) variance',
      'The change-order table shows "Lab equipment feeders" — approved, but On SOV: Missing',
      'Billing position: $515,275 underbilled',
    ],
    soWhat:
      'This is real cash sitting still. It was approved two months ago and nobody noticed it was unbillable.',
    href: '/projects/P-1004?tab=billing',
    load: 'reset',
  },
  {
    label: 'The fix',
    title: 'The accountant fixes it — and it uncovers something else',
    say:
      "The accountant adds the missing line. Watch two things happen. First, the schedule now reconciles to " +
      "the contract exactly — that blocking item is gone. Second, and this is the interesting part: now that " +
      "the line exists, the system can see that $420,000 of approved work has never actually been billed. " +
      "Fixing the data problem revealed the money problem underneath it.",
    lookFor: [
      'Schedule of values now says "Reconciles"',
      'The change order now shows On SOV: Yes',
      'A new item appeared: $420,000 of approved change work unbilled after 31 days',
    ],
    soWhat:
      'One correction, two outcomes: a blocked close became unblocked, and $420,000 became invoiceable. That ' +
      'is the product paying for itself in a single click.',
    href: '/projects/P-1004?tab=billing',
    load: 'changeOrderBilling',
  },
  {
    label: 'Asking the PM',
    title: 'The system asks the project manager one specific question',
    say:
      "Different workstream. On Riverside Office Tower, the crew has burned 65% of the budgeted hours on a " +
      "cost code that is only 52% complete. The system does not send the PM a spreadsheet — it asks one " +
      "question: given what you are seeing in the field, what is your remaining cost and remaining hours? " +
      "The PM answers, and the forecast recalculates.",
    lookFor: [
      'Forecast final cost rose $125,000 after the PM answered',
      'Projected margin dropped from 11.9% to 9.4%',
      'Open the History tab to see the full chain',
    ],
    soWhat:
      'PMs will not fill in finance spreadsheets. They will answer one specific question about their own job. ' +
      'That is the whole design.',
    href: '/projects/P-1001',
    load: 'laborDeterioration',
  },
  {
    label: 'The guardrail',
    title: 'A material change cannot reach the books without a Controller',
    say:
      "The PM's answer moved the forecast by $125,000. That is over the materiality threshold, so the system " +
      "did not just accept it — it opened a Controller review and the project is now held out of close until " +
      "a human signs off. No AI decided anything. It gathered the evidence and put a named person in front " +
      "of the decision.",
    lookFor: [
      "Sam's desk: one item now needs a decision before close — it did not exist a moment ago",
      'Open "Show the evidence": forecast cost before, after, and the movement',
      'The project cannot close until this is approved or the risk is explicitly accepted',
    ],
    soWhat:
      'This is the answer to "are you letting an AI touch our books?" No. It prepares the work and stops at ' +
      'the judgement.',
    href: '/',
    persona: 'controller',
  },
  {
    label: 'No double counting',
    title: 'Cutoff done right: the cost moves, the forecast does not',
    say:
      "One more, and this is the one a controller will test you on. $120,000 of switchgear was delivered but " +
      "the invoice has not arrived. The accountant accepts the cutoff. Cost to date goes up $120,000 — but " +
      "the forecast final cost does not move at all, because that money was already inside the purchase " +
      "order. What changes is timing: percent complete, earned revenue, and the billing position.",
    lookFor: [
      'Cost to date up $120,000; remaining commitments down $120,000',
      'Forecast final cost: unchanged',
      'Percent complete and billing position both move',
    ],
    soWhat:
      'Getting this wrong is how contractors double-count cost and report a margin that is not real. This is ' +
      'the single most technical thing to show a controller, and it is the one that earns trust.',
    href: '/projects/P-1001',
    load: 'receivedNotInvoiced',
  },
  {
    label: 'Closing it out',
    title: 'Every blocking item answered — the job is ready to close',
    say:
      "Now the full run. Five blocking problems on Central University Science Lab, five different people " +
      "answering: the accountant fixes the schedule of values and accrues unposted payroll, the PM explains " +
      "the unapproved change work, and the controller accepts one $35,000 risk in writing with a rationale. " +
      "The job goes from not close-ready to Ready to close.",
    lookFor: [
      'Central University Science Lab: Ready to close',
      'The History tab shows the entire chain in order',
      'The controller\'s risk acceptance is preserved with its written rationale',
    ],
    soWhat:
      'That is a month-end close turned into a worklist. Every number traceable to a source record, every ' +
      'judgement attributed to a named human.',
    href: '/projects/P-1004?tab=activity',
    load: 'closeP1004',
  },
  {
    label: 'The moat',
    title: 'Everything is connected, and everything is traceable',
    say:
      "Last thing. This is the operating graph — every object in the business and how they relate, read " +
      "left to right in the order the money moves: raw records, what they reconcile to, the agent that " +
      "looked, what it flagged, who owns it, what they decided. It is not a picture bolted onto a dashboard; " +
      "it is the same structure the calculations run on. Hover anything and its whole chain lights up. The " +
      "green lines are relationships a human created during this close.",
    lookFor: [
      'The selected exception on load — hover it and trace left to the invoices and PO that prove it',
      'The Agents column: follow "detected" from Billing & Change Order Agent into the exceptions it found',
      'Open the AP invoice bundle to see every record; click any card for its source file and row',
      'The green line from the human decision back to the schedule-of-values line it created',
    ],
    soWhat:
      'This is what makes the second customer cheaper than the first. Once a contractor is modelled, every ' +
      'new workstream reuses the same structure.',
    href: '/graph?project=P-1004&depth=2',
  },
];

export const GUIDE_LENGTH = GUIDE.length;
