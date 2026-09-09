/**
 * Project the canonical model, the reconciled view and the workflow state into graph nodes and links.
 *
 * This is composition, not a new representation. Every reconciled link rendered here is the *same* object the
 * rule engine consumed — the graph explorer cannot draw an edge the maths does not also see, and vice versa.
 * That is the difference between an operating graph and a picture next to some numbers.
 *
 * Master-data links are projected from the whitelisted entity fields, never independently reconciled, so the
 * field and the link cannot diverge.
 */

import { graphLinkId } from '@/domain/ids';
import type { CanonicalModel } from '@/domain/entities';
import type { GraphLink, GraphNode, LinkType } from '@/domain/graph';
import type { ReconciledView } from '@/domain/reconciliation';
import type { ReviewDecision, Task } from '@/domain/workflow';
import type { AgentDescriptor, Snapshot } from '@/domain/engine';
import { buildGraphIndex, type GraphIndex } from '@/graph/core';

function link(type: LinkType, fromId: string, toId: string, derivedBy: GraphLink['derivedBy']): GraphLink {
  return { id: graphLinkId(type, fromId, toId), type, fromId, toId, sourceRefs: [], derivedBy };
}

export function buildGraph(
  model: CanonicalModel,
  view: ReconciledView,
  snapshot: Snapshot,
  decisions: readonly ReviewDecision[],
  // Passed in rather than imported, so this projection stays below the agent layer.
  agents: readonly AgentDescriptor[],
): GraphIndex {
  const nodes: GraphNode[] = [];
  const links: GraphLink[] = [];

  // --- Organisation ---------------------------------------------------------------------------------------
  nodes.push({
    id: model.company.id,
    type: 'COMPANY',
    label: model.company.name,
    projectId: null,
    props: { country: model.company.country, currency: model.company.currency },
    sourceRefs: model.company.sourceRefs,
  });

  for (const division of model.divisions) {
    nodes.push({
      id: division.id,
      type: 'DIVISION',
      label: division.name,
      projectId: null,
      props: {},
      sourceRefs: division.sourceRefs,
    });
    links.push(link('HAS_DIVISION', model.company.id, division.id, 'master_data'));
  }

  for (const person of model.people) {
    nodes.push({
      id: person.id,
      type: 'PERSON',
      label: person.name,
      projectId: null,
      props: { role: person.role, email: person.email },
      sourceRefs: person.sourceRefs,
    });
  }

  // Employees are cited as evidence by the unposted-labour exception, so they must exist as nodes — the
  // endpoint-validity filter below would otherwise silently drop those RELATES_TO edges and the drill-down
  // from an exception to the crew would lead nowhere, invisibly.
  for (const employee of model.employees) {
    nodes.push({
      id: employee.id,
      type: 'EMPLOYEE',
      label: employee.name,
      projectId: null,
      props: { trade: employee.trade, role: employee.role, rate: employee.hourlyCostRate },
      sourceRefs: employee.sourceRefs,
    });
  }

  for (const vendor of model.vendors) {
    nodes.push({
      id: vendor.id,
      type: 'VENDOR',
      label: vendor.name,
      projectId: null,
      props: { category: vendor.category, trade: vendor.tradeScope },
      sourceRefs: vendor.sourceRefs,
    });
  }

  // --- Projects and their structure -----------------------------------------------------------------------
  for (const project of model.projects) {
    const metrics = snapshot.metricsByProject.get(project.id);
    nodes.push({
      id: project.id,
      type: 'PROJECT',
      label: project.name,
      projectId: project.id,
      props: {
        customer: project.customerName,
        trade: project.trade,
        contract: metrics?.revisedContractValue ?? project.originalContractValue,
        eac: metrics?.eac ?? null,
        margin: metrics?.projectedMarginPct ?? null,
        closeReady: snapshot.closeReadiness.get(project.id)?.ready ?? false,
      },
      sourceRefs: project.sourceRefs,
    });
    links.push(link('HAS_PROJECT', project.divisionId, project.id, 'master_data'));
    links.push(link('MANAGED_BY', project.id, project.projectManagerId, 'master_data'));
  }

  for (const costCode of model.costCodes) {
    const budget = model.index.budgetLineByCostCode.get(costCode.id);
    nodes.push({
      id: costCode.id,
      type: 'COST_CODE',
      label: `${costCode.code} ${costCode.description}`,
      projectId: costCode.projectId,
      props: {
        code: costCode.code,
        mapped: costCode.mapped,
        currentBudget: budget?.currentBudget ?? null,
        costType: costCode.costType,
      },
      sourceRefs: costCode.sourceRefs,
    });
    links.push(link('HAS_COST_CODE', costCode.projectId, costCode.id, 'master_data'));
  }

  // --- Procurement and AP ---------------------------------------------------------------------------------
  for (const commitment of model.commitments) {
    nodes.push({
      id: commitment.id,
      type: 'COMMITMENT',
      label: commitment.description,
      projectId: commitment.projectId,
      props: {
        committed: commitment.committedAmount,
        status: commitment.status,
        costCode: commitment.costCode,
      },
      sourceRefs: commitment.sourceRefs,
    });
    links.push(link('BELONGS_TO', commitment.id, commitment.projectId, 'master_data'));
    links.push(link('CODED_TO', commitment.id, commitment.costCodeId, 'master_data'));
  }

  for (const invoice of model.apInvoices) {
    nodes.push({
      id: invoice.id,
      type: 'AP_INVOICE',
      label: `${invoice.invoiceNumber}`,
      projectId: invoice.projectId,
      props: {
        amount: invoice.amount,
        approvalStatus: invoice.approvalStatus,
        postingStatus: invoice.postingStatus,
        approvedDate: invoice.approvedDate,
        costCode: invoice.costCode,
        suspectedDuplicate: view.suppressedDuplicateIds.has(invoice.id),
      },
      sourceRefs: invoice.sourceRefs,
    });
    links.push(link('BELONGS_TO', invoice.id, invoice.projectId, 'master_data'));
    links.push(link('ISSUES', invoice.vendorId, invoice.id, 'master_data'));
  }

  for (const receipt of model.materialReceipts) {
    nodes.push({
      id: receipt.id,
      type: 'MATERIAL_RECEIPT',
      label: receipt.description,
      projectId: receipt.projectId,
      props: { received: receipt.receivedValue, date: receipt.receiptDate },
      sourceRefs: receipt.sourceRefs,
    });
  }

  for (const txn of model.jobCostTransactions) {
    nodes.push({
      id: txn.id,
      type: 'JOB_COST_TXN',
      label: txn.description,
      projectId: txn.projectId,
      props: {
        amount: txn.amount,
        postingDate: txn.postingDate,
        costType: txn.costType,
        sourceType: txn.sourceType,
      },
      sourceRefs: txn.sourceRefs,
    });
    links.push(link('CODED_TO', txn.id, txn.costCodeId, 'master_data'));
  }

  for (const aggregate of model.laborAggregates) {
    nodes.push({
      id: aggregate.id,
      type: 'LABOR_AGGREGATE',
      label: `Labour — ${aggregate.costCode}`,
      projectId: aggregate.projectId,
      props: {
        unpostedEntries: aggregate.unposted.entryCount,
        unpostedCost: aggregate.unposted.cost,
        crewSize: aggregate.employeeIds.length,
      },
      sourceRefs: aggregate.sourceRefs,
    });
    links.push(link('CODED_TO', aggregate.id, aggregate.costCodeId, 'master_data'));
  }

  // --- Revenue and billing --------------------------------------------------------------------------------
  for (const co of model.changeOrders) {
    nodes.push({
      id: co.id,
      type: 'CHANGE_ORDER',
      label: co.description,
      projectId: co.projectId,
      props: {
        status: co.status,
        requested: co.requestedValue,
        approved: co.approvedValue,
        incurred: co.costIncurredToDate,
        approvalDate: co.approvalDate,
      },
      sourceRefs: co.sourceRefs,
    });
    links.push(link('MODIFIES', co.id, co.projectId, 'master_data'));
  }

  // SOV items include human-created overlay lines, which is why they come from the view.
  for (const project of model.projects) {
    for (const sov of view.sovItemsForProject(project.id)) {
      nodes.push({
        id: sov.id,
        type: 'SOV_ITEM',
        label: sov.description,
        projectId: sov.projectId,
        props: { scheduledValue: sov.scheduledValue, retainagePct: sov.retainagePct },
        sourceRefs: sov.sourceRefs,
      });
      links.push(link('BELONGS_TO', sov.id, sov.projectId, 'master_data'));
    }
  }

  for (const billing of model.billings) {
    nodes.push({
      id: billing.id,
      type: 'BILLING',
      label: `${billing.billingPeriod} application`,
      projectId: billing.projectId,
      props: {
        currentBilled: billing.currentBilled,
        billedToDate: billing.billedToDate,
        retainageHeld: billing.retainageHeld,
      },
      sourceRefs: billing.sourceRefs,
    });
  }

  // Includes human-authored overlay snapshots. Sourcing these from the frozen model alone would show the
  // decision but not the forecast it created, so the graph could not explain why the estimate moved.
  for (const snapshotRow of view.forecastSnapshotsForProject(null)) {
    nodes.push({
      id: snapshotRow.id,
      type: 'FORECAST_SNAPSHOT',
      label: `Forecast ${snapshotRow.costCode} @ ${snapshotRow.asOfDate}`,
      projectId: snapshotRow.projectId,
      props: {
        remainingCost: snapshotRow.pmRemainingUncommittedCost,
        remainingHours: snapshotRow.pmRemainingLaborHours,
        comment: snapshotRow.comment,
      },
      sourceRefs: snapshotRow.sourceRefs,
    });
    links.push(link('FORECASTS', snapshotRow.id, snapshotRow.costCodeId, 'master_data'));
  }

  for (const progress of model.progressSnapshots) {
    nodes.push({
      id: progress.id,
      type: 'PROGRESS_SNAPSHOT',
      label: `Progress ${progress.costCode} @ ${progress.asOfDate}`,
      projectId: progress.projectId,
      props: { progressPct: progress.physicalProgressPct, source: progress.source },
      sourceRefs: progress.sourceRefs,
    });
    links.push(link('PROGRESSES', progress.id, progress.costCodeId, 'master_data'));
  }

  // --- Unmappable source records --------------------------------------------------------------------------
  for (const unmapped of model.unmappedSources) {
    nodes.push({
      id: `UNMAPPED-${unmapped.sourceKey}`,
      type: 'UNMAPPED_SOURCE',
      label: unmapped.sourceKey,
      projectId: null,
      props: { reason: unmapped.reason, confidence: unmapped.sourceRef.confidence ?? null },
      sourceRefs: [unmapped.sourceRef],
    });
  }

  // --- Reconciled links: the same objects the rules consumed ----------------------------------------------
  links.push(...view.links);

  // --- Workflow -------------------------------------------------------------------------------------------
  for (const agent of agents) {
    nodes.push({
      id: agent.id,
      type: 'AGENT',
      label: agent.name,
      projectId: null,
      props: { goal: agent.goal, workstream: agent.workstream },
      sourceRefs: [{ system: 'APPLICATION', file: 'src/agents/agents.ts', recordId: agent.id }],
    });
  }

  const taskByException = new Map<string, Task>(snapshot.tasks.map((t) => [t.exceptionId, t]));

  for (const exception of snapshot.exceptions) {
    nodes.push({
      id: exception.id,
      type: 'EXCEPTION',
      label: exception.title,
      projectId: exception.projectId,
      props: {
        rule: exception.ruleId,
        severity: exception.severity,
        blocking: exception.blocking,
        triggering: exception.currentlyTriggering,
        impact: exception.impact,
        suppressedBy: exception.suppressedBy,
      },
      sourceRefs: exception.evidence.sourceRefs,
    });

    // Every node the exception cited as evidence, so "show me the evidence" and "show me the subgraph" are
    // the same operation.
    for (const nodeId of exception.evidence.nodeIds) {
      links.push(link('RELATES_TO', exception.id, nodeId, 'reconciliation'));
    }

    // An exception is always scoped to its project by `projectId`, whether or not the rule's evidence
    // happens to cite the project node directly (several AP rules cite only the invoice/commitment/vendor
    // chain). Without this, a project is not reliably one hop from its own exceptions, and any type-filtered
    // neighbourhood walk — such as the graph explorer's "why can't this close" preset — can silently fail to
    // reach a real blocking exception because the only path to it ran through a node type the filter excluded.
    // `BELONGS_TO`, not `RELATES_TO`: this is scoping, and must not be drawn as evidence the rule cited.
    if (exception.projectId && !exception.evidence.nodeIds.includes(exception.projectId)) {
      links.push(link('BELONGS_TO', exception.id, exception.projectId, 'master_data'));
    }

    const owningAgent = agents.find((agent) => agent.ownedRules.includes(exception.ruleId));
    if (owningAgent) links.push(link('CREATED', owningAgent.id, exception.id, 'master_data'));

    const task = taskByException.get(exception.id);
    if (task) {
      nodes.push({
        id: task.id,
        type: 'TASK',
        label: task.title,
        projectId: task.projectId,
        props: {
          status: task.status,
          ownerRole: task.ownerRole,
          blocking: task.blocking,
          requestedAction: task.requestedAction,
        },
        sourceRefs: [],
      });
      links.push(link('RELATES_TO', task.id, exception.id, 'master_data'));
      if (task.ownerPersonId) links.push(link('ASSIGNED_TO', task.id, task.ownerPersonId, 'master_data'));
    }
  }

  for (const decision of decisions) {
    nodes.push({
      id: decision.id,
      type: 'REVIEW_DECISION',
      label: `${decision.payload.type} by ${decision.actor.role}`,
      projectId: decision.subject.projectId,
      props: {
        type: decision.payload.type,
        actor: decision.actor.role,
        effectiveDate: decision.effectiveDate,
      },
      sourceRefs: [{
        system: 'APPLICATION', file: 'decision-ledger', recordId: decision.id, method: 'human_decision',
      }],
    });
    links.push(link('RESOLVES', decision.id, decision.exceptionId, 'human_decision'));
  }

  // Deduplicate: several passes can legitimately produce the same edge or reference the same node.
  const uniqueNodes = new Map(nodes.map((node) => [node.id, node]));
  const uniqueLinks = new Map(links.map((l) => [l.id, l]));

  // Drop links whose endpoints do not exist, so the explorer can never draw an unsupported relationship.
  const valid = [...uniqueLinks.values()].filter(
    (l) => uniqueNodes.has(l.fromId) && uniqueNodes.has(l.toId),
  );

  return buildGraphIndex([...uniqueNodes.values()], valid);
}
