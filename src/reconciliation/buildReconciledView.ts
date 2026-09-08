/**
 * Cross-system matching: raw counterparty keys in, canonical graph links out.
 *
 * This is the only module besides `src/data/*` that is allowed to read `commitment_id`, `source_doc_id`,
 * `approved_co_id` or `sov_item_id`. Everything above it — EAC, the 24 rules, the graph explorer — reaches
 * these relationships through the `ReconciledView` it returns. That is what makes "one representation, used
 * three ways" true rather than aspirational: there is no second copy of the invoice→PO edge for the
 * arithmetic to disagree with.
 *
 * It takes the decision projection, not just the model, because a human can create a relationship. Recording
 * a missing SOV line for an approved change order emits both an SOV item and a `MAPS_TO` link; a view built
 * from the frozen model alone would never see it, and `CO_MISSING_SOV` could never clear.
 */

import type { IsoDate } from '@/domain/dates';
import { onOrBefore } from '@/domain/dates';
import type {
  ApInvoice, Billing, CanonicalModel, Commitment, Employee, ForecastSnapshot, JobCostTransaction,
  MaterialReceipt, Person, SourceRef, SovItem, Vendor,
} from '@/domain/entities';
import type { GraphLink, LinkType } from '@/domain/graph';
import { graphLinkId } from '@/domain/ids';
import type {
  ApInvoiceId, ChangeOrderId, CommitmentId, LaborAggregateId, ProjectId, SovItemId,
} from '@/domain/ids';
import {
  apInvoiceId, changeOrderId, commitmentId, sovItemId,
} from '@/domain/ids';
import type { ReconciledView, ReconciliationKeys } from '@/domain/reconciliation';
import type { DecisionProjection } from '@/domain/workflow';

type Keys = ReconciliationKeys;

function link(
  type: LinkType,
  fromId: string,
  toId: string,
  sourceRefs: SourceRef[],
  derivedBy: GraphLink['derivedBy'] = 'reconciliation',
): GraphLink {
  return { id: graphLinkId(type, fromId, toId), type, fromId, toId, sourceRefs, derivedBy };
}

/**
 * Identify duplicate invoices.
 *
 * V0 detects exact vendor + invoice-number duplicates only. Sorting by
 * `(vendor, number, invoice date, invoice id)` and keeping the first is deterministic and matches the
 * independent reference implementation, so `INV-00089` (2026-07-19) is the suppressed duplicate of
 * `INV-00001` (2026-07-10).
 *
 * Not parameterised by as-of date on purpose: whether two records are the same document is a property of the
 * pair, not of the period we happen to be looking at.
 */
function findSuppressedDuplicates(invoices: readonly ApInvoice[]): Set<ApInvoiceId> {
  const ordered = [...invoices].sort((a, b) => {
    if (a.vendorId !== b.vendorId) return a.vendorId < b.vendorId ? -1 : 1;
    if (a.invoiceNumber !== b.invoiceNumber) return a.invoiceNumber < b.invoiceNumber ? -1 : 1;
    if (a.invoiceDate !== b.invoiceDate) return a.invoiceDate < b.invoiceDate ? -1 : 1;
    return a.id < b.id ? -1 : 1;
  });

  const seen = new Set<string>();
  const suppressed = new Set<ApInvoiceId>();
  for (const invoice of ordered) {
    const key = `${invoice.vendorId}|${invoice.invoiceNumber}`;
    if (seen.has(key)) suppressed.add(invoice.id);
    else seen.add(key);
  }
  return suppressed;
}

export function buildReconciledView(
  model: CanonicalModel,
  keys: Keys,
  projection: DecisionProjection,
): ReconciledView {
  const links: GraphLink[] = [];

  // --- MATCHES: invoice → commitment ---------------------------------------------------------------------
  const commitmentByInvoice = new Map<ApInvoiceId, Commitment>();
  const invoicesByCommitment = new Map<CommitmentId, ApInvoice[]>();

  for (const invoice of model.apInvoices) {
    const rawCommitment = keys.invoiceToCommitment.get(invoice.id);
    if (!rawCommitment) continue;
    const commitment = model.index.commitmentById.get(commitmentId(rawCommitment));
    if (!commitment) continue;

    commitmentByInvoice.set(invoice.id, commitment);
    const list = invoicesByCommitment.get(commitment.id);
    if (list) list.push(invoice);
    else invoicesByCommitment.set(commitment.id, [invoice]);

    links.push(link('MATCHES', invoice.id, commitment.id, [
      { ...invoice.sourceRefs[0]!, fields: ['commitment_id'] },
    ]));
  }

  // --- POSTS_AS: invoice → job-cost transaction ----------------------------------------------------------
  const postingByInvoice = new Map<ApInvoiceId, JobCostTransaction>();
  for (const posting of model.jobCostTransactions) {
    const rawInvoice = keys.postingToInvoice.get(posting.id);
    if (!rawInvoice) continue;
    const invoice = model.index.apInvoiceById.get(apInvoiceId(rawInvoice));
    // A posting whose source_doc_id is not an invoice (the seeded UNMAPPED-COST-01 case) simply has no link.
    if (!invoice) continue;

    postingByInvoice.set(invoice.id, posting);
    links.push(link('POSTS_AS', invoice.id, posting.id, [
      { ...posting.sourceRefs[0]!, fields: ['source_doc_id', 'source_type'] },
    ]));
  }

  // --- RECEIVED_AGAINST: receipt → commitment ------------------------------------------------------------
  const receiptsByCommitment = new Map<CommitmentId, MaterialReceipt[]>();
  for (const receipt of model.materialReceipts) {
    const rawCommitment = keys.receiptToCommitment.get(receipt.id);
    if (!rawCommitment) continue;
    const commitment = model.index.commitmentById.get(commitmentId(rawCommitment));
    if (!commitment) continue;

    const list = receiptsByCommitment.get(commitment.id);
    if (list) list.push(receipt);
    else receiptsByCommitment.set(commitment.id, [receipt]);

    links.push(link('RECEIVED_AGAINST', receipt.id, commitment.id, [
      { ...receipt.sourceRefs[0]!, fields: ['commitment_id'] },
    ]));
  }

  // --- MAPS_TO: change order → SOV item ------------------------------------------------------------------
  // Source-derived first, then human-created overlay links. Overlay links carry the same deterministic id
  // shape, so a human correction for a CO the PM system later fixes collides rather than duplicating.
  const sovByChangeOrder = new Map<ChangeOrderId, SovItem>();
  for (const sov of model.sovItems) {
    const rawCo = keys.sovToChangeOrder.get(sov.id);
    if (!rawCo) continue;
    const co = model.index.changeOrderById.get(changeOrderId(rawCo));
    if (!co) continue;
    sovByChangeOrder.set(co.id, sov);
    links.push(link('MAPS_TO', co.id, sov.id, [
      { ...sov.sourceRefs[0]!, fields: ['approved_co_id'] },
    ]));
  }

  // --- Overlays -------------------------------------------------------------------------------------------
  const sovOverlay = [...projection.sovOverlay.values()];
  const sovItemById = new Map(model.index.sovItemById);
  for (const item of sovOverlay) sovItemById.set(item.id, item);

  for (const overlayLink of projection.linkOverlay.values()) {
    links.push(overlayLink);
    if (overlayLink.type === 'MAPS_TO') {
      const co = model.index.changeOrderById.get(changeOrderId(overlayLink.fromId.replace(/^CHG-/, '')));
      const sov = sovItemById.get(sovItemId(overlayLink.toId.replace(/^SVI-/, '')));
      if (co && sov) sovByChangeOrder.set(co.id, sov);
    }
  }

  // --- BILLS: billing → SOV item -------------------------------------------------------------------------
  const billingsBySov = new Map<SovItemId, Billing[]>();
  for (const billing of model.billings) {
    const rawSov = keys.billingToSov.get(billing.id);
    if (!rawSov) continue;
    const sov = sovItemById.get(sovItemId(rawSov));
    if (!sov) continue;

    const list = billingsBySov.get(sov.id);
    if (list) list.push(billing);
    else billingsBySov.set(sov.id, [billing]);

    links.push(link('BILLS', billing.id, sov.id, [
      { ...billing.sourceRefs[0]!, fields: ['sov_item_id'] },
    ]));
  }

  // --- Master-data links: projected from whitelisted fields, never independently reconciled ---------------
  const vendorByInvoice = new Map<ApInvoiceId, Vendor>();
  for (const invoice of model.apInvoices) {
    const vendor = model.index.vendorById.get(invoice.vendorId);
    if (!vendor) continue;
    vendorByInvoice.set(invoice.id, vendor);
    links.push(link('ISSUES', vendor.id, invoice.id, invoice.sourceRefs.slice(0, 1), 'master_data'));
  }

  const employeesByLabor = new Map<LaborAggregateId, Employee[]>();
  for (const aggregate of model.laborAggregates) {
    const crew = aggregate.employeeIds
      .map((id) => model.index.employeeById.get(id))
      .filter((e): e is Employee => e !== undefined);
    employeesByLabor.set(aggregate.id, crew);
    for (const employee of crew) {
      links.push(link('WORKS_ON', employee.id, aggregate.id, [], 'master_data'));
    }
  }

  const managerByProject = new Map<ProjectId, Person>();
  for (const project of model.projects) {
    const manager = model.index.personById.get(project.projectManagerId);
    if (!manager) continue;
    managerByProject.set(project.id, manager);
    links.push(link('MANAGED_BY', project.id, manager.id, project.sourceRefs.slice(0, 1), 'master_data'));
  }

  // --- Project-scoped collections, projection aware -------------------------------------------------------
  const sovByProject = new Map<ProjectId, SovItem[]>();
  for (const item of [...model.sovItems, ...sovOverlay]) {
    const list = sovByProject.get(item.projectId);
    if (list) list.push(item);
    else sovByProject.set(item.projectId, [item]);
  }

  const forecastByProject = new Map<ProjectId | null, ForecastSnapshot[]>();
  const allForecasts = [...model.forecastSnapshots, ...projection.forecastOverlay.values()];
  forecastByProject.set(null, allForecasts);
  for (const snapshot of allForecasts) {
    const list = forecastByProject.get(snapshot.projectId);
    if (list) list.push(snapshot);
    else forecastByProject.set(snapshot.projectId, [snapshot]);
  }

  const billingsByProject = new Map<ProjectId, Billing[]>();
  for (const billing of model.billings) {
    const list = billingsByProject.get(billing.projectId);
    if (list) list.push(billing);
    else billingsByProject.set(billing.projectId, [billing]);
  }

  const suppressedDuplicateIds = findSuppressedDuplicates(model.apInvoices);

  const isValidInvoice = (id: ApInvoiceId, asOf: IsoDate): boolean => {
    const invoice = model.index.apInvoiceById.get(id);
    if (!invoice) return false;
    if (invoice.approvalStatus !== 'approved') return false;
    if (!onOrBefore(invoice.approvedDate, asOf)) return false;
    if (suppressedDuplicateIds.has(id)) return false;
    return true;
  };

  return {
    links,
    invoicesForCommitment: (id) => invoicesByCommitment.get(id) ?? [],
    commitmentForInvoice: (id) => commitmentByInvoice.get(id) ?? null,
    postingForInvoice: (id) => postingByInvoice.get(id) ?? null,
    receiptsForCommitment: (id) => receiptsByCommitment.get(id) ?? [],
    sovItemForChangeOrder: (id) => sovByChangeOrder.get(id) ?? null,
    billingsForSovItem: (id) => billingsBySov.get(id) ?? [],
    sovItemsForProject: (id) => sovByProject.get(id) ?? [],
    billingsForProject: (id) => billingsByProject.get(id) ?? [],
    forecastSnapshotsForProject: (id) => forecastByProject.get(id) ?? [],
    vendorForInvoice: (id) => vendorByInvoice.get(id) ?? null,
    employeesForLaborAggregate: (id) => employeesByLabor.get(id) ?? [],
    managerForProject: (id) => managerByProject.get(id) ?? null,
    isValidInvoice,
    validInvoicesForCommitment: (id, asOf) =>
      (invoicesByCommitment.get(id) ?? []).filter((i) => isValidInvoice(i.id, asOf)),
    suppressedDuplicateIds,
  };
}
