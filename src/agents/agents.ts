/**
 * The four V0 agents.
 *
 * Three detection agents own disjoint rule sets covering all 24 rules, and the Close Orchestrator owns no
 * detection rule at all — its job is to judge whether the close can proceed and to escalate material
 * movements to the Controller. Ordering is part of the contract: the detection agents run first, because
 * close readiness is a function of the blocking tasks they produce in the same pass.
 */

import { CLOSE_CONTROLLER_REVIEW, exceptionId as makeExceptionId } from '@/domain/ids';
import type { ProjectId } from '@/domain/ids';
import { isSettled, waitingStateFor } from '@/domain/workflow';
import type { ExceptionRecord, Task, Workstream } from '@/domain/workflow';
import { actionEmitter, type Agent, type AgentRunContext, type AgentRunResult, type CloseReadiness } from './types';
import { computeMovement } from '@/calculations/projectMetrics';
import { ownerRoleFor, resolveOwner, runDetectionAgent } from './detectionAgent';

export const costControlAgent: Agent = {
  id: 'COST_CONTROL',
  name: 'Cost Control Agent',
  goal:
    'Find cost that is duplicated, unposted, over-committed, miscoded or received but not invoiced, and get ' +
    'it in front of the project accountant with the evidence needed to resolve it.',
  workstream: 'AP',
  evidenceInspected: [
    'AP invoices', 'commitments', 'material receipts', 'job-cost transactions', 'cost codes and budgets',
  ],
  allowedActions: [
    'OBSERVED', 'EXCEPTION_DETECTED', 'TASK_CREATED', 'TASK_ROUTED', 'RESPONSE_INCORPORATED',
    'ANALYSIS_RERUN', 'EXCEPTION_CLEARED',
  ],
  ownedRules: [
    'AP_DUPLICATE', 'AP_COMMITMENT_OVERRUN', 'AP_COST_CODE_MISMATCH', 'AP_MISSING_POSTING', 'AP_RNI',
    'DQ_PROJECT_MAP', 'DQ_UNMAPPED_COST_CODE', 'DQ_UNBUDGETED_COST',
  ],
  routesTo: ['Project Accountant'],
  run: (ctx) => runDetectionAgent(costControlAgent, ctx),
};

export const forecastAgent: Agent = {
  id: 'FORECAST',
  name: 'Forecast Agent',
  goal:
    'Keep the forecast honest: compare cost and labour burn against progress and against the prior close, ' +
    'and ask the project manager only for what the systems cannot tell us.',
  workstream: 'Forecast',
  evidenceInspected: [
    'PM forecast snapshots', 'cost-code progress', 'labour aggregates', 'budgets', 'prior-period metrics',
  ],
  allowedActions: [
    'OBSERVED', 'EXCEPTION_DETECTED', 'TASK_CREATED', 'TASK_ROUTED', 'RESPONSE_INCORPORATED',
    'ANALYSIS_RERUN', 'EXCEPTION_CLEARED',
  ],
  ownedRules: [
    'FC_STALE', 'FC_MARGIN_FADE', 'FC_EAC_DETERIORATION', 'FC_COST_CODE_OVERRUN', 'FC_LABOR_BURN',
    'FC_PM_CHANGE_NO_EXPLANATION', 'FC_PROFIT_RISK_CONCENTRATION', 'FC_COMPLETE_CODE_REMAINING',
    'LABOR_MISSING_POSTING',
  ],
  routesTo: ['Project Manager', 'Project Accountant', 'Controller'],
  run: (ctx) => runDetectionAgent(forecastAgent, ctx),
};

export const billingAgent: Agent = {
  id: 'BILLING_CO',
  name: 'Billing & Change Order Agent',
  goal:
    'Protect contract value and cash: find work performed without a contract, contract value missing from ' +
    'the schedule of values, and revenue earned but not billed.',
  workstream: 'Billing',
  evidenceInspected: [
    'change orders', 'schedule of values', 'billings', 'draft earned revenue', 'revised contract value',
  ],
  allowedActions: [
    'OBSERVED', 'EXCEPTION_DETECTED', 'TASK_CREATED', 'TASK_ROUTED', 'RESPONSE_INCORPORATED',
    'ANALYSIS_RERUN', 'EXCEPTION_CLEARED',
  ],
  ownedRules: [
    'CO_LARGE_AGING', 'CO_UNAPPROVED_COST', 'CO_MISSING_SOV', 'CO_APPROVED_UNBILLED',
    'BILL_UNDERBILLING', 'BILL_SOV_MISMATCH', 'BILL_RETAINAGE',
  ],
  routesTo: ['Project Manager', 'Project Accountant', 'Controller'],
  run: (ctx) => runDetectionAgent(billingAgent, ctx),
};

/**
 * The Close Orchestrator.
 *
 * Owns no detection rule. It answers one question — can this project close? — and raises a Controller review
 * when a human answer has moved the numbers materially. That review is a real, resolvable task: it uses a
 * reserved pseudo-rule id keyed on the decision that triggered it, so a Controller approval has something to
 * attach to. It is deliberately excluded from the seeded rule-count oracle, because it can only exist after
 * a human decision and the oracle describes the pre-decision baseline.
 */
export const closeOrchestrator: Agent = {
  id: 'CLOSE_ORCHESTRATOR',
  name: 'Close Orchestrator',
  goal:
    'Decide whether each project is ready to close, and make sure no material change reaches the books ' +
    'without a Controller looking at it.',
  workstream: 'All',
  evidenceInspected: ['open tasks', 'blocking status', 'project metrics', 'prior-step metrics'],
  allowedActions: ['OBSERVED', 'CLOSE_STATUS_CHANGED', 'ESCALATED', 'TASK_CREATED', 'TASK_ROUTED'],
  ownedRules: [CLOSE_CONTROLLER_REVIEW as never],
  routesTo: ['Controller'],

  run(ctx: AgentRunContext): AgentRunResult {
    const at = ctx.triggeringDecision?.effectiveDate ?? ctx.config.closeDate;
    const emitter = actionEmitter(closeOrchestrator, ctx.step, at);
    const exceptions: ExceptionRecord[] = [];
    const tasks: Task[] = [];

    emitter.emit({
      type: 'OBSERVED',
      summary: `Reviewed ${ctx.tasksSoFar.length} open items across ${ctx.metrics.size} projects.`,
      triggeringDecisionId: ctx.triggeringDecision?.id ?? null,
    });

    // --- Carry forward reviews raised on earlier steps ----------------------------------------------------
    // Detection rules re-emit their exceptions every pass because they re-evaluate the same source facts.
    // A Controller review has no rule behind it — it exists because of one specific past decision — so if it
    // were not carried forward it would silently vanish on the very next decision, on any project, and the
    // project would report itself ready to close with the elevated forecast intact and no sign-off. The
    // resolution index still decides its status, so an approval or a risk acceptance settles it normally.
    const carried = new Set<string>();
    for (const previous of ctx.previousSnapshot?.exceptions ?? []) {
      if (previous.ruleId !== 'CLOSE_CONTROLLER_REVIEW') continue;
      carried.add(previous.id);

      const resolution = ctx.resolutionIndex.get(previous.id);
      // Derived from the decision, not asserted. An approved review is carried forward so the sign-off stays
      // visible in the audit trail, but it is no longer an open condition — anything filtering on
      // `currentlyTriggering` would otherwise list a signed-off review as a live issue.
      exceptions.push({
        ...previous,
        currentlyTriggering: !isSettled(resolution?.status ?? waitingStateFor('Controller')),
      });
      // Derived, not asserted: today a review can only wait on or be settled by the Controller, but the rule
      // for who owns a task lives in one place so a future send-back transition cannot leave this behind.
      const carriedStatus = resolution?.status ?? waitingStateFor('Controller');
      const carriedOwner = ownerRoleFor(carriedStatus, resolution, 'Controller');
      tasks.push({
        id: `TASK-${previous.id}`,
        exceptionId: previous.id,
        projectId: previous.projectId,
        workstream: previous.workstream,
        ownerRole: carriedOwner,
        ownerPersonId: resolveOwner(ctx, carriedOwner, previous.projectId),
        blocking: previous.blocking,
        status: carriedStatus,
        title: previous.title,
        requestedAction: previous.recommendedAction,
        evidence: previous.evidence,
        createdAt: at,
        updatedAt: resolution?.lastDecisionAt ?? at,
      });
    }

    // --- Controller escalation ---------------------------------------------------------------------------
    // Only when a human decision actually moved something material. Comparing against the previous step, not
    // against the baseline, so each answer is judged on its own effect.
    const decision = ctx.triggeringDecision;
    if (decision && ctx.previousSnapshot) {
      const projectId = decision.subject.projectId;
      if (projectId) {
        const current = ctx.metrics.get(projectId);
        const previous = ctx.previousSnapshot.metricsByProject?.get(projectId);

        if (current && previous) {
          // One definition of movement, shared with the project screen, so what a Controller is escalated
          // for and what they are shown are computed the same way.
          const movement = computeMovement(current, previous);
          const eacChange = Math.abs(movement.eacChange);
          const marginMove = Math.abs(movement.marginMovementPercentagePoints ?? 0);

          const materialEac = eacChange >= ctx.config.thresholds.controllerEacChangeDollar;
          const materialMargin =
            marginMove >= ctx.config.thresholds.controllerMarginMovementPercentagePoints;

          if ((materialEac || materialMargin) && !carried.has(makeExceptionId(CLOSE_CONTROLLER_REVIEW, projectId, decision.id))) {
            const id = makeExceptionId(CLOSE_CONTROLLER_REVIEW, projectId, decision.id);
            const project = ctx.model.index.projectById.get(projectId);

            const review: ExceptionRecord = {
              id,
              ruleId: 'CLOSE_CONTROLLER_REVIEW',
              projectId,
              workstream: 'Forecast',
              severity: 'HIGH',
              blocking: true,
              blockingScope: 'CLOSE',
              title: `Controller review: ${project?.name ?? projectId} moved materially after a ${decision.actor.role} response`,
              explanation:
                `A ${decision.payload.type} decision by ${decision.actor.role} changed forecast final cost by ` +
                `$${Math.round(eacChange).toLocaleString('en-US')}` +
                (marginMove > 0 ? ` and projected margin by ${marginMove.toFixed(2)} points` : '') +
                '. A change of this size needs Controller sign-off before the project is closed.',
              impact: eacChange,
              impactUnit: 'USD',
              recommendedAction:
                'Review the change and the evidence behind it, then approve it for close or accept the risk ' +
                'explicitly.',
              ownerRole: 'Controller',
              evidence: {
                nodeIds: [projectId],
                sourceRefs: project?.sourceRefs ?? [],
                measured: [
                  { label: 'EAC before', value: previous.eac, unit: 'USD' },
                  { label: 'EAC after', value: current.eac, unit: 'USD' },
                  { label: 'EAC movement', value: eacChange, unit: 'USD' },
                  { label: 'Margin movement', value: marginMove, unit: 'PP' },
                ],
                thresholds: [
                  {
                    name: 'controllerEacChangeDollar',
                    value: ctx.config.thresholds.controllerEacChangeDollar,
                    comparator: 'GTE',
                    met: materialEac,
                  },
                  {
                    name: 'controllerMarginMovementPercentagePoints',
                    value: ctx.config.thresholds.controllerMarginMovementPercentagePoints,
                    comparator: 'GTE',
                    met: materialMargin,
                  },
                ],
              },
              subjectId: decision.id,
              suppressedBy: null,
              currentlyTriggering: true,
            };

            exceptions.push(review);

            const resolution = ctx.resolutionIndex.get(id);
            const reviewStatus = resolution?.status ?? waitingStateFor('Controller');
            const reviewOwner = ownerRoleFor(reviewStatus, resolution, 'Controller');
            tasks.push({
              id: `TASK-${id}`,
              exceptionId: id,
              projectId,
              workstream: 'Forecast',
              ownerRole: reviewOwner,
              ownerPersonId: resolveOwner(ctx, reviewOwner, projectId),
              blocking: true,
              status: reviewStatus,
              title: review.title,
              requestedAction: review.recommendedAction,
              evidence: review.evidence,
              createdAt: at,
              updatedAt: resolution?.lastDecisionAt ?? at,
            });

            emitter.emit({
              type: 'ESCALATED',
              summary:
                `Escalated to Controller: EAC moved $${Math.round(eacChange).toLocaleString('en-US')} ` +
                `after ${decision.actor.role} response.`,
              projectId,
              exceptionId: id,
              triggeringDecisionId: decision.id,
            });
            emitter.emit({
              type: 'TASK_CREATED',
              summary: 'Opened Controller review before close.',
              projectId,
              exceptionId: id,
            });
            emitter.emit({ type: 'TASK_ROUTED', summary: 'Routed to Controller.', projectId, exceptionId: id });
          }
        }
      }
    }

    // --- Close readiness ----------------------------------------------------------------------------------
    // A project is ready when nothing blocking is still open. Severity and blocking stay separate: a HIGH
    // margin fade is serious but does not block the close, while a MEDIUM stale forecast does.
    const allTasks = [...ctx.tasksSoFar, ...tasks];
    const readiness = new Map<ProjectId, CloseReadiness>();

    // Portfolio-level blockers first. A source project nobody can map means cost, labour and billing are
    // invisible to every close calculation, so it holds the whole close rather than any one project.
    const portfolioBlocking = allTasks.filter(
      (task) => task.projectId === null && task.blocking && !isSettled(task.status),
    );
    const portfolioReadiness = {
      ready: portfolioBlocking.length === 0,
      blockingTaskIds: portfolioBlocking.map((t) => t.id),
      heldByPortfolioIssue: [] as ProjectId[],
    };

    for (const projectId of ctx.metrics.keys()) {
      const projectTasks = allTasks.filter((task) => task.projectId === projectId);
      const openBlocking = projectTasks.filter((task) => task.blocking && !isSettled(task.status));
      const blockedWorkstreams = [...new Set(openBlocking.map((t) => t.workstream))] as Workstream[];
      const ownItemsClear = openBlocking.length === 0;
      const heldByPortfolioIssue = ownItemsClear && !portfolioReadiness.ready;

      if (heldByPortfolioIssue) portfolioReadiness.heldByPortfolioIssue.push(projectId);

      const state: CloseReadiness = {
        projectId,
        ready: ownItemsClear && portfolioReadiness.ready,
        blockingTaskIds: [...openBlocking.map((t) => t.id), ...portfolioReadiness.blockingTaskIds],
        openTaskCount: projectTasks.filter((task) => !isSettled(task.status)).length,
        blockedWorkstreams,
        heldByPortfolioIssue,
      };
      readiness.set(projectId, state);

      const previous = ctx.previousSnapshot?.closeReadiness.get(projectId);
      if (previous && previous.ready !== state.ready) {
        emitter.emit({
          type: 'CLOSE_STATUS_CHANGED',
          summary: state.ready
            ? 'All blocking items resolved — ready to close.'
            : `No longer ready to close: ${openBlocking.length} blocking item(s) open.`,
          projectId,
          triggeringDecisionId: ctx.triggeringDecision?.id ?? null,
        });
      }
    }

    if (portfolioBlocking.length > 0 && ctx.step === 0) {
      emitter.emit({
        type: 'OBSERVED',
        summary:
          `${portfolioBlocking.length} portfolio-level data-quality item(s) hold the close for every ` +
          'project, including any whose own items are clear.',
      });
    }

    return {
      exceptions,
      tasks,
      actions: emitter.actions,
      closeReadiness: readiness,
      portfolioReadiness,
    };
  },
};

/** Run order is contractual: detection first, orchestration last. */
export const AGENTS: readonly Agent[] = [
  costControlAgent,
  forecastAgent,
  billingAgent,
  closeOrchestrator,
];
