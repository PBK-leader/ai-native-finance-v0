# V0 Technical Design

Status: **revision 4 — Gate 1 PASSED (PASS WITH ISSUES, no unresolved BLOCKER/HIGH)**
Author: Lead Engineer (main Claude Code session)
Date: 2026-08-24

Revision history:
- **r1** — FAIL (1 BLOCKER, 7 HIGH). All findings were document-level.
- **r2** — FAIL (2 HIGH remaining: B-1, B-3). Six of eight prior findings resolved; the BLOCKER fix
  (`ReconciledView`) and the overlay fix (`DecisionProjection`) had been designed separately and did not join up.
- **r3** — FAIL (1 new HIGH: a `src/domain` ↔ `src/graph/core` type-placement cycle introduced by the B-1 fix).
  Both r2 blockers verified resolved against the raw data; all seven MEDIUMs and six LOWs addressed.
- **r4** — this revision. Removes the cycle by declaring all shared types at layer 3, and resolves the five
  MEDIUMs and seven LOWs raised in the r3 pass. **Gate 1 verdict: PASS WITH ISSUES.** §14 is the full
  finding-to-fix log; §15 carries the commitments to be honoured during implementation.

---

## 1. Design goals

1. Normalize five simulated source systems into one canonical model.
2. Make the Client Operating Graph the shared operating context for reconciliation, rules, agents and UI.
3. Make every financial number deterministic, traceable to source records, and free of double counting.
4. Make the agent loop real and auditable: `observe → detect → task → route → human → incorporate → recompute → resolve/escalate`.
5. Stay small enough that a non-technical founder and a future technical cofounder can follow it.

---

## 2. Core architectural decision: derived state from an append-only decision ledger

**Nothing derived is ever mutated.** The application holds exactly two pieces of state:

| State | Nature | Lifetime |
|---|---|---|
| `CanonicalModel` | pure function of the raw CSV files, **deeply frozen** | built once, cached, never written to |
| `DecisionLedger` | append-only list of validated human decisions | held by an injected `DecisionStore`, resettable |

Everything else is recomputed by a pure function: `replay(model, config, decisions) -> EngineState`.

### 2.1 What `replay` does, precisely

Every derived artifact is a function of `(model, projection)`. A human decision can add SOV lines, forecast
snapshots **and graph links**, so the reconciled view is rebuilt per step — it is not a property of the frozen
model alone.

```
// Prior period is invariant: it never uses current-close decisions, so it is built once.
priorProjection = EMPTY_PROJECTION
priorView       = buildReconciledView(model, priorProjection)
prior           = computeProjectMetrics(model, priorView, priorProjection, config, config.priorComparisonDate)

// Step 0 — the agents' baseline run, before any human has answered anything.
view_0       = buildReconciledView(model, EMPTY_PROJECTION)
metrics_0    = computeProjectMetrics(model, view_0, EMPTY_PROJECTION, config, config.closeDate)
resolution_0 = buildResolutionIndex([])                       // empty: nothing is resolved at baseline
snapshot_0   = runAgents({ model, view: view_0, projection: EMPTY_PROJECTION, metrics: metrics_0,
                           resolutionIndex: resolution_0, prior,
                           previousSnapshot: null, triggeringDecision: null })

// Steps 1..n — one per human decision, each recomputing the whole derived picture.
for i in 1..n:
    resolution_i = buildResolutionIndex(decisions[0..i])       // prefix-scoped, so history is honest
    effective_i  = decisions[0..i] minus those resolution_i marked `ignored`   // §9.2
    projection_i = projectDecisions(effective_i)               // keyed reduction, not a running sum
    view_i       = buildReconciledView(model, projection_i)    // sees sovOverlay + linkOverlay
    metrics_i    = computeProjectMetrics(model, view_i, projection_i, config, config.closeDate)
    snapshot_i   = runAgents({ model, view: view_i, projection: projection_i, metrics: metrics_i,
                               resolutionIndex: resolution_i, prior,
                               previousSnapshot: snapshot_(i-1), triggeringDecision: decisions[i] })

return { prior, snapshots, current: snapshot_n,
         activity: concat(all agent actions, all decisions, in order) }
```

Five properties this pseudocode is asserting, each of which a reviewer found missing in an earlier revision:

- **`view` is threaded explicitly** into both `computeProjectMetrics` and `runAgents`. Calculations cannot
  reach a relationship except through the view.
- **Metrics are engine substrate, not agent output.** `computeProjectMetrics` is called by `replay`, once per
  step, and handed to every agent. If metrics were computed inside `runAgents`, each of the four agents could
  arrive at its own EAC — the duplicated-business-logic failure mode.
- **A decision the workflow ignored cannot move a number.** The resolution index is built first, and only
  decisions it did not mark `ignored` reach `projectDecisions` (§9.2). Otherwise a task could read
  `WAITING_FOR_PM` while its rejected answer had already changed EAC.
- **`resolutionIndex` is prefix-scoped** (`decisions[0..i]`, not the whole ledger). Without this, `snapshot_0`
  would show tasks as resolved before the resolving decision existed — every final-state test would still pass
  while the demo timeline was quietly wrong.
- **`replay` emits no agent actions of its own.** It orders the run and concatenates. Agents observe and emit (§8).

`replay` never throws — validation happens on the write path (§9.2).

### 2.2 Why this shape

- **Idempotency is structural, not defensive.** `projectDecisions` reduces the ledger into keyed `Map`s (§4.5).
  Accepting the same adjustment twice writes the same key twice and yields one adjustment. There is no
  "have I already applied this?" check to forget.
- **No stale state.** There is no cached EAC to invalidate. A PM answer cannot update one screen and miss another.
- **The audit trail is the source of truth**, not a log written alongside mutations that can drift from them.
- **Testability.** Every workflow test is `replay(model, config, [decisions...])` plus an assertion.
- **Replayable demos.** The three required demos are literally decision lists.

### 2.3 Cost

`replay` runs the pipeline n+1 times. The expensive input is `labor_entries.csv` (22,593 rows), so the canonical
layer pre-aggregates labor once into `(project, costCode)` buckets (§4.6); `replay` touches aggregates only.
Prior-period metrics and `priorView` are hoisted out of the loop. A test asserts `replay` is deterministic
across two invocations with the same ledger.

---

## 3. Module layout and dependency direction

Dependencies point **downward only**, listed bottom-up. No module imports a module above it.

| Layer | Module | May import | Responsibility |
|---:|---|---|---|
| 1 | `src/config` | — | the one typed runtime configuration |
| 2 | `src/data/raw` | config | RFC-4180 CSV parser + typed raw row types + loaders. Knows column names. |
| 3 | `src/domain` | config | **all inert type declarations** (see §3.1), canonical ID scheme, money/date helpers, the `taskStatus` reducer. Imports no raw types. |
| 4 | `src/graph/core` | domain | graph **indexing and traversal**: adjacency index, BFS. Generic; knows nothing about invoices. |
| 5 | `src/data/normalize` | config, **data/raw**, domain, graph/core | the only module that sees both raw and canonical. Emits the frozen `CanonicalModel`. |
| 6 | `src/reconciliation` | config, **data/raw**, domain, graph/core | the only module that reads raw *counterparty* ids. Implements `buildReconciledView(model, projection)`. |
| 7 | `src/calculations` | config, domain, graph/core | deterministic finance math. Receives `ReconciledView` as an **argument**; imports only its interface from `domain`. |
| 8 | `src/graph/build` | config, domain, graph/core, reconciliation | assembles nodes/links from model + view. Composition, not a new representation. |
| 9 | `src/exceptions` | layers 1–8 | 24 rules + the suppression pass |
| 10 | `src/agents` | layers 1–9 | 4 agents: observe, detect, create task, route, emit actions |
| 11 | `src/workflows` | layers 1–10 | decision types, `projectDecisions`, `validateDecision`, `replay`, `DecisionStore` |
| 12 | `src/components` | layer 11 types only | presentation |
| 13 | `src/app` | all | routes, API handlers, persona switcher |

### 3.1 Types are declared low; behaviour is implemented where it belongs

A type is inert data — naming one creates no runtime dependency. Behaviour is what layering must order.
So **every shared type is declared in `src/domain`**, and the code that builds or reduces it lives in its own
layer:

| Type declared in `src/domain` | Behaviour implemented in |
|---|---|
| `ReconciledView` (interface) | `buildReconciledView` — `src/reconciliation` (layer 6) |
| `GraphNode`, `GraphLink`, `NodeType`, `LinkType` | adjacency index and BFS — `src/graph/core` (layer 4); assembly — `src/graph/build` (layer 8) |
| `DecisionProjection`, `AdjustmentSet` | `projectDecisions` — `src/workflows` (layer 11) |
| `ResolutionIndex`, `TaskStatus` | `buildResolutionIndex` — `src/workflows`; the `taskStatus` reducer itself is pure and stays in `src/domain` |
| `ReviewDecision`, `DecisionType`, `DecisionPayload` | `validateDecision` — `src/workflows` |
| `Evidence`, `Exception`, `Task`, `AgentAction` | rules — `src/exceptions`; agents — `src/agents` |

This is the rule r3 applied to `ReconciledView` but not one level down: `ReconciledView` carries
`links: readonly GraphLink[]` and `DecisionProjection` carries `linkOverlay`, so declaring `GraphLink` at
layer 4 while `src/domain` (layer 3) had to name it was a 3↔4 cycle. Declaring all of them at layer 3 removes it.

### 3.2 Two rules enforced by test, not convention

1. **No financial arithmetic in `src/components` or `src/app`.** UI renders numbers `replay` already computed.
2. **No reconciled counterparty id outside `src/data/raw`, `src/data/normalize` and `src/reconciliation`.**
   Enforced by two complementary greps (§11), because r2's single grep could not have caught the original defect:
   - **raw columns:** `commitment_id`, `source_doc_id`, `erp_job_id`, `pm_project_id`, `approved_co_id`, `sov_item_id`
   - **canonical fields:** `/\b(commitment|invoice|sovItem|changeOrder|receipt|billing|jobCostTxn)Id\b/`
     in `src/domain` entity declarations — the camelCase form the BLOCKER actually took.

---

## 4. Canonical domain model

### 4.1 Identity

Raw source IDs never become canonical IDs.

**Derivation rule, one sentence:** a canonical ID is `PREFIX + '-' + <raw source id>`, with no stripping;
prefixes are chosen so the result is unambiguous. Composite entities that have no single raw row
(cost codes, budget lines, snapshots, labor aggregates) compose their key from canonical parts.
**`Project` is the single exception:** `project_id_map.csv` already supplies a canonical id, which is the
whole point of that file, so `P-1002` is used directly.

| Entity | Canonical ID | Example |
|---|---|---|
| Company | `CMP-<company_id>` | `CMP-C-001` |
| Division | `DIV-<division_id>` | `DIV-D-ELEC` |
| Project | *from the map* | `P-1002` |
| Cost code | `CC-<projectId>-<code>` | `CC-P-1002-230300` |
| Budget line | `BL-<projectId>-<code>` | `BL-P-1002-230300` |
| Commitment | `CMT-<commitment_id>` | `CMT-PO-0004` |
| AP invoice | `AP-<invoice_id>` | `AP-INV-00064` |
| Material receipt | `RCP-<receipt_id>` | `RCP-RCV-00001` |
| Job-cost txn | `JCT-<job_cost_txn_id>` | `JCT-JC-00388` |
| Change order | `CHG-<change_order_id>` | `CHG-CO-1004-A` |
| SOV item | `SVI-<sov_item_id>` | `SVI-SOV-CO-1004-C` |
| Billing | `BIL-<billing_id>` | `BIL-BILL-SOV-P-1001-1` |
| Forecast snapshot | `FCS-<projectId>-<code>-<asOfDate>` | `FCS-P-1001-260400-2026-07-28` |
| Progress snapshot | `PRG-<projectId>-<code>-<asOfDate>` | `PRG-P-1006-220900-2026-07-29` |
| Labor aggregate | `LAB-<projectId>-<code>` | `LAB-P-1004-260200` |
| Person / Employee / Vendor | `PER-` / `EMP-` / `VEN-` | `PER-PERS-PM1`, `EMP-E-001`, `VEN-V-E01` |

`src/domain` keeps a `canonicalId ← SourceRef` index. **`exceptionId` subject keys are canonical IDs wherever
one exists**, so ledger entries survive a future ERP re-keying. The one unavoidable exception is
`DQ_PROJECT_MAP`, whose whole subject is a source record that *has* no canonical form — it keys on the raw
source key (`PC-UNKNOWN-88`), which is the only stable identifier available.

```ts
type SourceRef = {
  system: 'ERP' | 'PM' | 'TIMEKEEPING' | 'MASTER_DATA' | 'APPLICATION';
  file: string;          // 'raw/erp/ap_invoices.csv'
  recordId: string;      // 'INV-00064'
  fields?: string[];     // fields actually used
  /** How the key was matched. */
  method?: 'seeded_master_mapping' | 'exact_key_match' | 'unmapped' | 'human_decision';
  /** Mapping confidence where the source supplies one. */
  confidence?: number;
};
```

`SourceRef.method` records *how a key was matched*; `GraphLink.derivedBy` (§5.1) records *which layer created a
link*. They overlap only on `human_decision` and are not interchangeable.

`confidence` is populated from `project_id_map.csv:mapping_confidence` (`PC-UNKNOWN-88` carries `0.00`) and is
required by `CLIENT_OPERATING_GRAPH.md`, which asks source references to retain "confidence / mapping method
where relevant". It is `undefined` on source refs whose system supplies no such measure.

### 4.2 Entities

| Group | Entities |
|---|---|
| Organization | `Company`, `Division` |
| People | `Person`, `Employee` |
| Project finance | `Project`, `CostCode`, `BudgetLine`, `ForecastSnapshot`, `ProgressSnapshot` |
| Procurement / AP | `Vendor`, `Commitment`, `MaterialReceipt`, `ApInvoice`, `JobCostTransaction` |
| Labor | `LaborEntry`, `LaborAggregate` |
| Revenue / billing | `ChangeOrder`, `SovItem`, `Billing` |
| Workflow | `Exception`, `Task`, `ReviewDecision`, `AgentAction` |

Agents are **not** canonical entities — they are application objects declared in `src/agents` (§8) and projected
into the graph as `AGENT` nodes with an `APPLICATION` source ref.

`UnmappedSource` is not an entity: an unmappable source record is carried as `{ sourceRef, reason }` inside the
`DQ_*` exception's evidence and projected as an `UNMAPPED_SOURCE` graph node. Two such records exist in the
whole dataset.

These are four deliberate deviations from `DOMAIN_MODEL_V0.md` and `CLIENT_OPERATING_GRAPH.md`
(`Agent` demoted, `LaborAggregate` as the graph node, `ProgressSnapshot` added, `WORKS_ON` re-pointed).
Pointer notes have been added to both source documents so a future session reading them is not misled.

### 4.3 What entities may and may not carry

> **Containment and intra-source master-data keys live on entities. Cross-system reconciled matches live only as links.**

A canonical entity carries its own attributes, its `sourceRefs`, and:

- **containment:** `projectId`, `costCodeId`
- **intra-source master-data keys:** `vendorId`, `employeeId`, `divisionId`, `personId`

The criterion is **not** "single source system" — `billings.csv:sov_item_id` and
`schedule_of_values.csv:approved_co_id` are single-source PM keys too, and they are banned. The criterion is:

> A relationship that **reconciliation derives, or that a human decision can create or change**, is a link.
> Pure containment and master-data lookup are fields.

`vendorId` is a fixed master-data lookup that no reconciliation or human decision ever alters, and duplicate
detection (§6.2) groups by vendor — banning it would have forced a scan of the raw link array, the ad-hoc join
this architecture exists to prevent. `SovItem → ChangeOrder` is the opposite: Demo C is precisely a human
creating that relationship, so it must be a link.

A canonical entity **never** carries a reconciled counterparty id — no `ApInvoice.commitmentId`, no
`JobCostTransaction.invoiceId`, no `MaterialReceipt.commitmentId`, no `SovItem.changeOrderId`, no
`Billing.sovItemId`. Those raw columns are read only by `src/reconciliation`, which emits them as `GraphLink`s.

Everything downstream consumes the **same** links through one projection-aware object:

```ts
// Declared in src/domain, implemented in src/reconciliation.
interface ReconciledView {
  links: readonly GraphLink[];

  // Reconciled matches (the six links of §5.3)
  invoicesForCommitment(cmtId: CommitmentId): ApInvoice[];          // MATCHES
  commitmentForInvoice(invId: ApInvoiceId): Commitment | null;
  postingForInvoice(invId: ApInvoiceId): JobCostTransaction | null; // POSTS_AS
  receiptsForCommitment(cmtId: CommitmentId): MaterialReceipt[];    // RECEIVED_AGAINST
  sovItemForChangeOrder(coId: ChangeOrderId): SovItem | null;       // MAPS_TO
  billingsForSovItem(sovId: SovItemId): Billing[];                  // BILLS

  // Projection-aware collection accessors. Billing rules MUST use these rather than reading
  // `model.sovItems` directly, or an SOV correction would be invisible to BILL_SOV_MISMATCH
  // while being visible to sovItemForChangeOrder — the r1 BLOCKER's failure mode, one level down.
  sovItemsForProject(projectId: ProjectId): SovItem[];
  billingsForProject(projectId: ProjectId): Billing[];

  // Master-data neighbours needed by rules and routing
  vendorForInvoice(invId: ApInvoiceId): Vendor | null;              // ISSUES
  employeesForLaborAggregate(labId: LaborAggregateId): Employee[];  // WORKS_ON
  managerForProject(projectId: ProjectId): Person | null;           // MANAGED_BY

  // One definition of AP validity, shared by the current and prior passes
  isValidInvoice(invId: ApInvoiceId, asOf: IsoDate): boolean;
  suppressedDuplicateIds: ReadonlySet<ApInvoiceId>;
}

buildReconciledView(model: CanonicalModel, projection: DecisionProjection): ReconciledView;
```

`buildReconciledView` takes the **projection**, so a human decision that creates an SOV line and its `MAPS_TO`
link is visible to `sovItemForChangeOrder`. Without this, `CO_MISSING_SOV` could never clear and Demo C would
resolve its task while the blocking exception kept firing.

`computeProjectMetrics(model, view, projection, config, asOfDate)` takes the view as an argument, so
calculations cannot silently fall back to a foreign key.

### 4.4 Decisions project into overlays — the model is never edited

The cached `CanonicalModel` is deeply frozen. A human decision produces **overlay records**:

```ts
type DecisionProjection = {
  adjustments:     AdjustmentSet;        // §4.5
  forecastOverlay: Map<ForecastSnapshotId, ForecastSnapshot>;  // PM answers, system: 'APPLICATION'
  sovOverlay:      Map<SovItemId, SovItem>;                    // accountant SOV corrections
  linkOverlay:     Map<GraphLinkId, GraphLink>;                // links those corrections imply
  riskAcceptances: Map<ExceptionId, { rationale: string; actor: Actor }>;
};
```

**Every overlay is a keyed `Map`, not an array**, for the same reason `AdjustmentSet` is (§4.5): last write
wins over the decision prefix, so answering the same question twice cannot produce two records. This matters
concretely — an overlay `ForecastSnapshot` has canonical ID `FCS-<projectId>-<code>-<effectiveDate>` and every
overlay inherits `effectiveDate = closeDate`, so two PM answers for the same cost code collide on one key by
design. As arrays they would both survive and "latest snapshot on or before `asOfDate`" would have no tie-break.

Every selector takes `(model, projection)` and reads the union. Two worked examples, both of which r2 could not
express:

- **`RECORD_SOV_CORRECTION`** (Demo C) emits *both* a `SovItem` into `sovOverlay` **and** a `MAPS_TO`
  `GraphLink` into `linkOverlay`. `buildReconciledView` merges `linkOverlay` with the reconciled links, so
  `sovItemForChangeOrder('CHG-CO-1004-A')` starts returning the corrected line, `CO_MISSING_SOV` clears, and
  the `−$420,000` `BILL_SOV_MISMATCH` on `P-1004` closes to `$0`, inside the `$100` tolerance.
  **Expected downstream cascade, not a regression:** suppression rule 4 (§7.2) then lifts, and a *new*
  `CO_APPROVED_UNBILLED:P-1004:CHG-CO-1004-A` fires — `$420,000` unbilled, 31 days since the 2026-06-30
  approval, against thresholds of `$25,000` / 14 days. Fixing a data-quality problem reveals real unbilled
  revenue, which is the point of the workstream. It is non-blocking, so `P-1004` close-readiness still turns on
  its remaining blocking exceptions (`AP_COMMITMENT_OVERRUN`, `LABOR_MISSING_POSTING`, `CO_UNAPPROVED_COST`).
- **`PM_FORECAST_UPDATE`** (Demo A) emits a `ForecastSnapshot` into `forecastOverlay` dated
  `decision.effectiveDate` (§4.7), so "latest snapshot on or before `asOfDate`" selects it.

### 4.5 Management adjustments

```ts
type AdjustmentSet = {
  acceptedRni:           Map<CommitmentId, Money>;
  acceptedApUnposted:    Map<ApInvoiceId, Money>;
  acceptedUnpostedLabor: Map<LaborAggregateId, Money>;
};
```

Maps keyed by canonical ID, not arrays — duplicate acceptance is impossible by construction. Accepted
adjustments never modify raw source data.

### 4.6 Cost-code identity, the UNMAPPED bucket, and labor aggregation

`CostCode` is project-scoped: `{ id, projectId, code, description, costType, mapped: boolean }`.
A project-mapped job-cost transaction whose cost code is absent from `project_budgets.csv` yields a `CostCode`
with `mapped: false` and no budget line. **The cost stays in the project total** under
`UNMAPPED / NEEDS CLASSIFICATION`; it is excluded only from cost-code-budget comparisons, because a code with no
budget cannot be "over budget" — it raises `DQ_UNMAPPED_COST_CODE` instead.
Verified in data: exactly one case, `JC-00388` / `239777` on `P-1005`, `$38,500`.

`LaborAggregate` is built once per `(project, costCode)` with cumulative approved hours and cost through the
close date and the prior date, the unposted subset, `sourceRefs` for the member rows an exception must cite
(the 40 unposted `PC-7480/260200` rows), and employee links for drill-down.

### 4.7 Time: business date versus wall clock

Two different things, kept separate on every `ReviewDecision`:

```ts
type ReviewDecision = {
  id: string;
  exceptionId: ExceptionId;
  type: DecisionType;
  actor: Actor;
  /** Business as-of date. Defaults to config.closeDate. Drives every as-of selector. */
  effectiveDate: IsoDate;
  /** Wall clock, stamped once in src/app when the decision is appended. Display and ordering only. */
  recordedAt: string;
  payload: DecisionPayload;
};
```

This matters more than it looks. The close date is `2026-07-31` but the demo is run later in calendar time. If
an overlay forecast snapshot were dated with the wall clock, it would fall *after* `asOfDate` and be filtered
out — the PM's answer would be invisible, nothing would recalculate, and Demo A would fail silently.
Overlay artifacts therefore inherit `effectiveDate`, never `recordedAt`. As a bonus this makes `FC_STALE` clear
correctly: a PM answer dated at the close date has an age of 0 days.

`validateDecision` rejects `effectiveDate > config.closeDate`, and `src/app` supplies the default. Without that
bound the exact failure this section exists to prevent returns through user input rather than through the clock.

`Date.now()` and `new Date()` are **banned below `src/app`** (enforced by a grep test) so `replay` stays pure.
Baseline artifacts are stamped from `config.closeDate`.

### 4.8 Money and rounding

`type Money = number` — dollars as an IEEE double. **Intermediates are never rounded.** `round2()` is applied
only at display and at oracle comparison. Rule threshold comparisons use unrounded values. This is why the
oracle ties within `$0.02` rather than exactly.

---

## 5. Client Operating Graph

### 5.1 Shape

```ts
type GraphNode = { id: string; type: NodeType; label: string; projectId: string | null;
                   props: Record<string, string | number | boolean | null>; sourceRefs: SourceRef[] };
type GraphLink = { id: string; type: LinkType; fromId: string; toId: string;
                   sourceRefs: SourceRef[]; derivedBy: 'master_data' | 'reconciliation' | 'human_decision' };
```

`derivedBy: 'human_decision'` has a real producer: the `linkOverlay` of §4.4.

### 5.2 Node types — every one has a named consumer

`COMPANY, DIVISION, PROJECT, PERSON, EMPLOYEE, VENDOR, COST_CODE, BUDGET_LINE, COMMITMENT,
MATERIAL_RECEIPT, AP_INVOICE, JOB_COST_TXN, LABOR_AGGREGATE, PROGRESS_SNAPSHOT, FORECAST_SNAPSHOT,
CHANGE_ORDER, SOV_ITEM, BILLING, EXCEPTION, TASK, REVIEW_DECISION, AGENT, AGENT_ACTION, UNMAPPED_SOURCE`

### 5.3 Link types and their consumers

| Link | Produced by | Consumed by |
|---|---|---|
| `HAS_DIVISION`, `HAS_PROJECT` | master data | portfolio rollup |
| `MANAGED_BY` | master data | task routing, `managerForProject` |
| `HAS_COST_CODE`, `BUDGETS` | master data | cost-code EAC vs current budget |
| `ISSUES` (vendor→invoice) | master data | duplicate detection, AP evidence |
| `BELONGS_TO`, `CODED_TO` | normalization | project / cost-code containment |
| `MATCHES` (invoice→commitment) | **reconciliation** | `remaining_commitment`, `AP_COMMITMENT_OVERRUN`, `AP_COST_CODE_MISMATCH` |
| `POSTS_AS` (invoice→job-cost txn) | **reconciliation** | `AP_MISSING_POSTING` |
| `RECEIVED_AGAINST` (receipt→commitment) | **reconciliation** | `AP_RNI` |
| `MAPS_TO` (change order→SOV item) | **reconciliation** + **human decision** | `CO_MISSING_SOV`, `CO_APPROVED_UNBILLED` |
| `BILLS` (billing→SOV item) | **reconciliation** | billed-to-date, `BILL_RETAINAGE` |
| `MODIFIES` (change order→project) | master data | revised contract value |
| `FORECASTS`, `PROGRESSES` | master data | EAC, labor burn, complete-code check |
| `WORKS_ON` (employee→labor aggregate) | normalization | unposted-labor drill-down |
| `RELATES_TO`, `CREATED`, `ASSIGNED_TO`, `RESOLVES`, `TRIGGERED_BY` | workflow | exception→task→decision→recalculation chain |

**No graph database.** Adjacency is two `Map<string, GraphLink[]>` indexes; traversal is BFS to depth N from a
project node with node-type filters.

### 5.4 Evidence

```ts
type Evidence = {
  nodeIds:    string[];
  sourceRefs: SourceRef[];
  measured:   { label: string; value: number | null;
                unit: 'USD' | 'PCT' | 'PP' | 'DAYS' | 'HOURS' | 'COUNT' }[];
  thresholds: { name: keyof Thresholds; value: number;
                comparator: 'GTE' | 'LTE'; met: boolean }[];
};
```

`thresholds` is a **list**, because 6 of 24 rules fire on two thresholds — `FC_COMPLETE_CODE_REMAINING`
(progress ≥ 99 **and** remaining ≥ $10,000), `BILL_UNDERBILLING` ($100,000 **or** 5% of contract),
`FC_EAC_DETERIORATION`, `CO_LARGE_AGING`, `FC_PM_CHANGE_NO_EXPLANATION`, and `AP_RNI`'s medium/high bands.
A singular field would have forced the second threshold into the narrative string, putting a number outside the
deterministic layer. `met` lets the UI show which condition actually fired. `COUNT` exists so
`LABOR_MISSING_POSTING` can state "40 approved time rows" as a measured value.

---

## 6. Calculations

All from `docs/workflows/FINANCIAL_LOGIC_V0.md`, all pure, all thresholds from `src/config`.

### 6.1 As-of parameterization

Prior-period reconstruction is the *same code path* with `asOfDate = 2026-06-30` and `EMPTY_PROJECTION` —
never current actuals combined with a historical forecast.

### 6.2 Source validity — one definition, on `ReconciledView`

- Valid AP invoice: `approval_status = approved` AND `approved_date <= asOf` AND not a suppressed duplicate.
- Valid CO for contract value: `status = approved` AND `approval_date <= asOf`.
- Duplicate selection: sort by `(vendor_id, invoice_number, invoice_date, invoice_id)`; keep the first,
  suppress the rest.

`isValidInvoice` is parameterised by `asOf` but `suppressedDuplicateIds` deliberately is not: duplicate identity
is a property of the *record pair*, not of the analysis date. Two invoices are either the same document or they
are not, and that does not change because we look at an earlier close. Stated explicitly so nobody later
"fixes" it by making it as-of dependent.

### 6.3 Cost and EAC (cost-code level, summed to project)

```
posted_cost           = Σ job-cost txns for the project through asOf   (includes UNMAPPED)
adjusted_cost_to_date = posted + acceptedApUnposted + acceptedRni + acceptedUnpostedLabor
remaining_commitment  = Σ_po max( max(committed − validInvoiced, 0) − acceptedRni_po , 0 )
EAC                   = adjusted_cost_to_date + remaining_commitment + pm_remaining_uncommitted
```

Double-counting invariants, asserted by tests:

| Adjustment | cost-to-date | remaining commitment | EAC effect |
|---|---|---|---|
| Accepted RNI | +X | −X (same PO, floored at 0) | **0** |
| Accepted AP-unposted | +X | unchanged (the valid invoice already reduced it) | +X |
| Accepted unposted labor | +X | unchanged (labor is not a commitment) | +X unless PM offsets |

### 6.4 Guards

`safeDivide(n, d)` returns `null` when `d === 0`. No `NaN`/`Infinity` may leave `src/calculations`.
Percent complete: `0` when `EAC = 0 and cost = 0`; `null` + `dataQualityError` when `EAC = 0 and cost ≠ 0`.

---

## 7. Exception rule engine

24 rules, one file each, registered in a plain array literal — no plugin loader, no registry, no DI.

```ts
type Rule = {
  id: RuleId; workstream: Workstream; defaultOwnerRole: Role;
  blocking: boolean; blockingScope?: 'CLOSE' | 'FORECAST_WIP';
  evaluate(ctx: RuleContext): DetectedException[];
};

type RuleContext = {
  model: CanonicalModel; view: ReconciledView; projection: DecisionProjection;
  config: V0Config; metrics: ProjectMetrics[]; priorMetrics: ProjectMetrics[];
  resolutionIndex: ResolutionIndex;
};
```

`RuleContext` never exposes raw CSV rows.

### 7.1 Deterministic exception identity, and the subject of every rule

`exceptionId = ${ruleId}:${projectId ?? 'GLOBAL'}:${subjectCanonicalId}`.

The subject is the object the rule *economically reasons about*, which is not always the record the oracle
names. The oracle's `source_record` is therefore compared against `Evidence.sourceRefs`, not against the
subject key (§11).

| Rule | Subject | Example `exceptionId` | Oracle `source_record` |
|---|---|---|---|
| `DQ_PROJECT_MAP` | unmapped source key | `DQ_PROJECT_MAP:GLOBAL:PC-UNKNOWN-88` | `PC-UNKNOWN-88` |
| `DQ_UNMAPPED_COST_CODE` | cost code | `…:P-1005:CC-P-1005-239777` | `JC-00388:239777` |
| `DQ_UNBUDGETED_COST` | cost code | `…:P-xxxx:CC-…` | *(none expected)* |
| `AP_MISSING_POSTING` | invoice | `…:P-1005:AP-INV-00064` | `INV-00064` |
| `LABOR_MISSING_POSTING` | labor aggregate | `…:P-1004:LAB-P-1004-260200` | `PC-7480:260200 unposted labor` |
| `FC_STALE` | project | `…:P-1002:P-1002` | `PC-7633 latest 2026-06-20` |
| `AP_DUPLICATE` | suppressed duplicate invoice | `…:P-1001:AP-INV-00089` | `INV-00089` |
| `AP_COMMITMENT_OVERRUN` | commitment | `…:P-1004:CMT-PO-0023` | `INV-00090` *(in evidence)* |
| `AP_COST_CODE_MISMATCH` | invoice | `…:P-1002:AP-INV-00019` | `INV-00019` |
| `AP_RNI` | commitment | `…:P-1001:CMT-PO-0004` | `PO-0004` |
| `FC_MARGIN_FADE` | project | `…:P-1001:P-1001` | `P-1001` |
| `FC_EAC_DETERIORATION` | project | `…:P-1001:P-1001` | `P-1001` |
| `FC_COST_CODE_OVERRUN` | cost code | `…:P-1001:CC-P-1001-260300` | `260300` |
| `FC_LABOR_BURN` | cost code | `…:P-1001:CC-P-1001-260200` | `260200` |
| `FC_PM_CHANGE_NO_EXPLANATION` | cost code | `…:P-1001:CC-P-1001-260400` | `260400` |
| `FC_PROFIT_RISK_CONCENTRATION` | project | `…:P-1002:P-1002` | `P-1002` |
| `FC_COMPLETE_CODE_REMAINING` | cost code | `…:P-1006:CC-P-1006-220900` | `220900` |
| `CO_LARGE_AGING` | change order | `…:P-1001:CHG-CO-1001-B` | `CO-1001-B` |
| `CO_UNAPPROVED_COST` | change order | `…:P-1001:CHG-CO-1001-B` | `CO-1001-B` |
| `CO_MISSING_SOV` | change order | `…:P-1002:CHG-CO-1002-C` | `CO-1002-C` |
| `CO_APPROVED_UNBILLED` | change order | `…:P-1001:CHG-CO-1001-A` | `CO-1001-A` |
| `BILL_UNDERBILLING` | project | `…:P-1001:P-1001` | `P-1001` |
| `BILL_SOV_MISMATCH` | project | `…:P-1002:P-1002` | `P-1002` |
| `BILL_RETAINAGE` | SOV item | `…:P-xxxx:SVI-…` | *(none expected)* |

`AP_COMMITMENT_OVERRUN` is subject-keyed on the PO (`CMT-PO-0023`) because the overrun is a property of the
commitment, while suppression rule 2 needs the held invoice — which it reaches through
`view.invoicesForCommitment` and the exception's evidence.

### 7.2 Suppression — a pure pass, no upward import

The status reducer lives in `src/domain/taskStatus.ts` as a pure `(exceptionId, decisions) → TaskStatus`.
`replay` builds a prefix-scoped `ResolutionIndex` **before** detection and injects it. Suppression is then
`suppress(detected, resolutionIndex, config) -> { visible, suppressed }` — a single fixed pass, not iterated:

1. `AP_DUPLICATE` suppresses `AP_MISSING_POSTING` for the duplicate invoice, until the duplicate review resolves.
2. **Unresolved** `AP_COMMITMENT_OVERRUN` suppresses `AP_MISSING_POSTING` for the held invoice, regardless of lag age.
3. `DQ_UNMAPPED_COST_CODE` suppresses `DQ_UNBUDGETED_COST` for the same code.
4. `CO_MISSING_SOV` suppresses `CO_APPROVED_UNBILLED` for the same CO, until resolved.
5. Pending invoices never reach `AP_MISSING_POSTING`.

Suppressed exceptions are retained with `suppressedBy` so the UI can explain why no task exists.

**Naming, to avoid r2's ambiguity:** this pass produces the **unsuppressed** set. §7.3's "visible" set is a
different, later concept. The oracle in `expected_rule_counts.csv` compares the **unsuppressed** set at the
zero-decision baseline — which is why `AP_MISSING_POSTING = 1` and not 3.

### 7.3 Exception visibility — one uniform rule

```
visible = detected ∪ ledgerReferenced ∪ clearedInThisReplay
```

Every exception carries `currentlyTriggering: boolean`.

- Detected and unresolved → open task in the queue.
- Detected and resolved → shown with its decision.
- Referenced by a decision but no longer detected → `currentlyTriggering: false`, rendered as RESOLVED with
  "underlying condition no longer present after recomputation". No orphaned decisions.
- **Cleared during this replay but never decided** → retained so the `EXCEPTION_CLEARED` action in the activity
  feed has a live target. This is exactly Demo A's payload: a PM answer about cost code `260400` can clear
  `FC_MARGIN_FADE:P-1001`, an exception nobody ever filed a decision against. Without this clause that
  cross-workstream ripple — the thing V0 exists to prove — would be a dead link in the audit trail.
- Not detected, never decided, never cleared → absent.

The cleared set **accumulates forward** through `previousSnapshot`: an exception cleared at step 2 stays in the
visible set of the final snapshot, so its `EXCEPTION_CLEARED` action still has a live target at the end of the run.

**Out of scope for V0, stated so it is not read as a bug:** confirming or rejecting an `AP_DUPLICATE` finding is
a status-only decision. `DecisionProjection` has no invoice overlay, so an accountant who concludes two invoices
are genuinely distinct cannot restore the suppressed one to valid cumulative invoicing. Doing that properly
would change `remaining_commitment` and possibly `AP_COMMITMENT_OVERRUN`, and belongs with a real AP workflow.

---

## 8. Agents

```ts
type Agent = {
  id: AgentId; name: string; goal: string; workstream: Workstream;
  evidenceInspected: string[];        // named canonical collections it may read
  allowedActions: AgentActionType[];  // enforced at emit, in all environments
  ownedRules: RuleId[];
  run(ctx: AgentRunContext): AgentRunResult;   // { exceptions, tasks, actions }
};
```

**Agents are the sole emitter of `AgentAction`.** An agent emitting an action outside `allowedActions` returns a
typed error from the emit helper — it never throws from a render path.

| Order | Agent | Owns | Routes to |
|---:|---|---|---|
| 1 | Cost Control Agent | `AP_*`, `DQ_*` | Project Accountant |
| 2 | Forecast Agent | `FC_*`, `LABOR_MISSING_POSTING` | PM, Controller |
| 3 | Billing & Change Order Agent | `CO_*`, `BILL_*` | PM, Project Accountant, Controller |
| 4 | Close Orchestrator | no detection rule; owns close readiness and Controller escalation | Controller |

**Ordering is part of the contract:** the three detection agents run first, then the Close Orchestrator, because
close readiness is a function of the blocking tasks the others produce in the same run.

The four agents partition all 24 rules with no gap and no overlap, which is what lets each one diff its own
owned rules against `previousSnapshot` to emit `EXCEPTION_CLEARED`. At `snapshot_0`, `previousSnapshot` is
`null` and no clears are emitted.

Action types: `OBSERVED`, `EXCEPTION_DETECTED`, `TASK_CREATED`, `TASK_ROUTED`, `RESPONSE_INCORPORATED`,
`ANALYSIS_RERUN`, `EXCEPTION_CLEARED`, `ESCALATED`, `CLOSE_STATUS_CHANGED`.

### 8.1 Close Orchestrator escalation has a real identity

The orchestrator raises a blocking Controller review when a human answer moves EAC by
≥ `controllerEacChangeDollar` or margin by ≥ `controllerMarginMovementPercentagePoints`, comparing
`previousSnapshot` with the current one. It uses a reserved pseudo-rule so the task has a resolvable ID:

```
CLOSE_CONTROLLER_REVIEW:P-1001:<triggeringDecisionId>
```

The key is derived from the triggering decision, which is already in the ledger, and is resolved by a later
decision carrying the same key — so it stays ledger-derivable with no circularity. Pseudo-rule exceptions are
excluded from `expected_rule_counts.csv` comparisons and cannot appear in the zero-decision baseline.

### 8.2 LLM adapter boundary

```ts
interface NarrativeAdapter {
  explainException(e: Exception, ctx): string;
  draftQuestion(t: Task, ctx): string;
}
```

V0 ships `DeterministicNarrativeAdapter` — two template functions. **Arithmetic never crosses this boundary**:
the adapter receives already-computed numbers and returns prose.

---

## 9. Task / workflow state machine

States: `OPEN, WAITING_FOR_PM, WAITING_FOR_ACCOUNTANT, WAITING_FOR_CONTROLLER, RESOLVED, ACCEPTED_RISK`.

`OPEN` is transient within a single agent run — a task is created `OPEN` and routed in the same run — so the
audit trail shows `TASK_CREATED` and `TASK_ROUTED` as distinct steps. It is never a resting state.

| From | Action | Required actor | To |
|---|---|---|---|
| `OPEN` | `ROUTE` | agent | `WAITING_FOR_{role}` |
| `WAITING_FOR_PM` | `PM_FORECAST_UPDATE`, `PM_ANSWER` | Project Manager | `RESOLVED` |
| `WAITING_FOR_ACCOUNTANT` | `ACCEPT_ADJUSTMENT`, `REJECT_ADJUSTMENT`, `RECORD_SOV_CORRECTION` | Project Accountant | `RESOLVED` |
| any waiting | `ESCALATE` | PM or Project Accountant | `WAITING_FOR_CONTROLLER` |
| any waiting | `ACCEPT_RISK` | Controller | `ACCEPTED_RISK` |
| `WAITING_FOR_CONTROLLER` | `CONTROLLER_APPROVE` | Controller | `RESOLVED` |

`ACCEPT_RISK` requires a Controller and a written rationale.

### 9.1 What each decision carries

`DecisionPayload` is the point where "what the human actually said" becomes a number, and it is the shared
contract between the UI form, `validateDecision` and `projectDecisions`. It is a discriminated union on `type`:

| `DecisionType` | Payload | Projects into |
|---|---|---|
| `PM_FORECAST_UPDATE` | `lines: { costCode, remainingUncommittedCost, remainingLaborHours }[]`, `comment` | one `ForecastSnapshot` per line in `forecastOverlay`, dated `effectiveDate` |
| `PM_ANSWER` | `answer: string` | nothing — status only |
| `ACCEPT_ADJUSTMENT` | `adjustmentType` (`RNI`, `AP_UNPOSTED`, `UNPOSTED_LABOR`), `subjectId`, `amount`, `note` | one entry in the matching `AdjustmentSet` map |
| `REJECT_ADJUSTMENT` | `reason: string` | nothing — status only |
| `RECORD_SOV_CORRECTION` | `changeOrderId`, `scheduledValue`, `retainagePct` | a `SovItem` in `sovOverlay` **and** a `MAPS_TO` link in `linkOverlay` |
| `ESCALATE` | `reason: string` | nothing — status only |
| `ACCEPT_RISK` | `rationale: string` | an entry in `riskAcceptances` |
| `CONTROLLER_APPROVE` | `note: string` | nothing — status only |

**`PM_FORECAST_UPDATE` carries a set of cost-code lines, not one.** This is what makes `FC_STALE` behave
sensibly: project forecast age is measured from the **oldest** cost code's latest snapshot, so a project's
forecast is only as fresh as its stalest line. Refreshing one of `P-1002`'s ten cost codes must not declare the
whole forecast current while nine lines remain 41 days old. Both readings give the oracle's count of 1 at
baseline, because every project's cost codes share a snapshot date in the source data — so the stricter, more
defensible reading is free.

### 9.2 A decision must be eligible, not merely well-formed

`validateDecision` checks the transition table *and* that the decision's subject is actually a candidate for it.
Without this an accountant could accept an AP-unposted adjustment against an already-posted invoice and
double-count it against `posted_cost`, or against the suppressed duplicate `AP-INV-00089` and inject `$75,920`
of cost that does not exist. `CLAUDE.md` names double-count prevention as a financial safety rule, and this is
the last path by which a legal-looking human decision could produce a wrong number.

| Adjustment | Rejected unless |
|---|---|
| `AP_UNPOSTED` | the invoice has no `POSTS_AS` posting, **and** it is not in `view.suppressedDuplicateIds` |
| `RNI` | an `AP_RNI` exception is currently open on that commitment, and `amount` does not exceed the computed gap |
| `UNPOSTED_LABOR` | the labor aggregate has unposted approved rows, and `amount` does not exceed their computed cost |
| all | `effectiveDate` is on or before `config.closeDate`; the actor holds the role the transition requires |

### 9.3 Tasks are derived but complete

`Task` carries: related exception, assigned role and person, blocking flag, status, **requested input/action**,
evidence, `createdAt`, `updatedAt`. Status is `reduce(transitionTable, decisionsFor(exceptionId))`.
Timestamps follow §4.7.

### 9.4 Validation is on the write path; the reducer is total

`POST /api/decisions` calls `validateDecision(currentState, decision) → Ok | Rejected(reason)` **before**
appending. A rejected decision returns 4xx with the reason and never enters the ledger.

The reducer is then total on any ledger the API produced: decision *i* was validated against the state produced
by decisions `[0..i-1]`, and because the model is frozen and `replay` is deterministic, replaying that prefix
reproduces exactly that state. **Explicit fallback:** an unhandled `(state, action)` pair leaves the status
unchanged and marks that decision `ignored: true` — it never throws. This matters because §9.6 lets tests pass a
hand-written array that bypasses `validateDecision`.

`ignored` is not cosmetic: §2.1's loop filters ignored decisions out **before** `projectDecisions` runs, so a
decision the workflow refused to act on cannot still move a number. Otherwise the ledger and the arithmetic
would disagree — and in this architecture the ledger is the source of truth.

### 9.5 Close readiness

`closeReady(project) = no unresolved blocking task`, where unresolved means not in `{RESOLVED, ACCEPTED_RISK}`.
Severity and blocking remain separate concepts.

### 9.6 Decision ledger

The ledger is **carried by the browser**, not held on the server. `src/workflows/ledgerCodec.ts` encodes the
decision list as gzipped base64url in the `mep-ledger` cookie; the three write routes set it, and pages read it
through `src/components/ledgerServer.ts` and pass it into `engineState`. It is **injected into** `replay`, never
imported by it, so tests pass a plain array. `/api/reset` writes an empty ledger for repeatable demos.

This replaced a module-level in-memory store, which worked on one machine and could not work once the prototype
was hosted: on a serverless host the request that records a decision and the request that renders the next screen
run in different processes, so every answer was accepted and then silently lost. Keeping the ledger with the
viewer makes the server genuinely stateless — which is what the derived-state design was already claiming — and
gives each visitor to a shared link their own portfolio.

Two consequences are deliberate. A cookie is finite, so `withLedger` refuses a write that no longer fits rather
than dropping the oldest decisions and quietly un-answering a question a human already answered; at current
payload sizes a six-decision demo encodes to about 1.5KB against a 3.5KB budget. And a cookie is
client-controlled, so `decodeLedger` shape-checks every entry and treats anything unexpected as an empty ledger —
a decode that threw would take every page down with no way for the visitor to recover.

---

## 10. The four screens

| Route | Screen | Content |
|---|---|---|
| `/` | Finance Command Center | portfolio metrics, close readiness, open risk, waiting-on |
| `/projects/[id]` | Project 360 | Overview, Forecast/WIP, AP & Cost Control, Billing & COs, Activity |
| `/work-queue` | Work Queue | filter by role/workstream/severity/project/status; resolve with evidence |
| `/graph` | Client Operating Graph | project-centred subgraph, type filters, node detail + source evidence |

Server components read `EngineState`; small client components POST a decision and call `router.refresh()`.

**Persona switcher.** The app shell carries an explicit demo persona (PM / Project Accountant / Controller / CFO)
resolved from `master_data/people.csv`, attached to every decision as `actor: { personId, role }`. It is a demo
affordance, not authentication, and is labelled as such in the UI.

Every exception card answers the eight Evidence Rule questions from `CLAUDE.md`.

---

## 11. Testing strategy

| Layer | Tests |
|---|---|
| Config | `v0Config.ts` matches `reference/client_config.json` exactly |
| CSV parser | quoted fields, embedded commas, CRLF, BOM |
| Calculations | contract, EAC, WIP, margin, labor cost; all five `edge_case_fixtures.json` cases |
| Reference oracle | all 12 rows of `expected_baseline_project_metrics.csv` within `$0.02` |
| Rules | exact counts from `expected_rule_counts.csv` against the **unsuppressed baseline set**; exact instances from `expected_seeded_exceptions.csv` matched on rule + project + owner + blocking, with `source_record` compared against `Evidence.sourceRefs` |
| Negative controls | all 6 rows of `expected_negative_controls.csv` |
| Workflow | routing, suppression, PM answer → recompute, RNI invariant, idempotency, escalation, close readiness, illegal transition rejected on the write path |
| Demos | A, B and C end to end as decision lists, asserting the numbers actually move |
| Determinism | `replay` twice with the same ledger yields identical output |
| Architecture | raw-column grep **and** canonical camelCase-field grep (§3.1); no wall-clock reads below `src/app`; no arithmetic in components |
| Graph | every rendered link exists in the canonical link set; every evidence node resolves |

Reference files are a read-only oracle. Application code changes to match them, never the reverse.

---

## 12. Deliberate non-goals for V0

No database, no auth, no ERP integration, no LLM call, no journal entries, no agent framework, no graph DB,
no queue, no websockets, no state-management library, no CSV dependency.

---

## 13. Assumptions

All accounting-interpretation assumptions live in `docs/decisions/ASSUMPTIONS.md` (A-01 … A-07) with dates and
evidence. This section is a pointer only.

---

## 14. Gate 1 finding log

### Revision 1 findings (all resolved in r2, re-verified in the r2 re-check)

| Finding | Severity | Resolution |
|---|---|---|
| Reconciled relationships duplicated as FKs and links | BLOCKER | §4.3 |
| `src/data` below `src/domain` | HIGH | §3 |
| Suppression needs resolution state → cycle | HIGH | §7.2 |
| Two producers of `AgentAction` | HIGH | §2.1, §8 |
| Frozen model vs appended snapshots | HIGH | §4.4 *(completed in r3 — see B-1)* |
| Source-fact / derived-condition taxonomy | HIGH | §7.3 *(completed in r3 — see B-2)* |
| Throwing on illegal transition inside `replay` | HIGH | §9.2 |
| Evidence as node IDs | HIGH | §5.4 *(completed in r3 — see B-4)* |
| `SourceRef.confidence` should be dropped | MEDIUM | **Reviewer withdrew this finding**; field retained, §4.1 |

### Revision 2 findings, resolved in r3 and independently verified

| # | Severity | Finding | Fix |
|---|---|---|---|
| B-1 | HIGH | SOV overlay could not express CO→SOV; `ReconciledView` was not projection-aware and was never constructed in §2.1 | §4.4 adds `linkOverlay`; §4.3 makes it `buildReconciledView(model, projection)`; §2.1 threads `view` through every call |
| B-3 | HIGH | Overlay forecast snapshot's business as-of date unspecified; the only stated rule dated it after the close date, so Demo A would silently not recalculate | §4.7 splits `effectiveDate` (business, defaults to `closeDate`) from `recordedAt` (wall clock); overlays inherit `effectiveDate` |
| A-1 | MEDIUM | §3's import column contradicted §4.3 | §3 grants `data/raw` to layers 5–6; `ReconciledView` declared in `domain`, implemented in `reconciliation` |
| A-2 | MEDIUM | Grep test could not catch the camelCase form the BLOCKER actually took | §3.1 adds a second canonical-field grep and completes the raw-column list |
| A-3 | MEDIUM | No sanctioned path to vendor, so `AP_DUPLICATE` had none | §4.3 whitelists intra-source master-data keys; §4.3 adds three master-data accessors to the view |
| B-2 | MEDIUM | `EXCEPTION_CLEARED` could reference an invisible exception | §7.3 adds `clearedInThisReplay` to the visible set |
| B-4 | MEDIUM | `Evidence.threshold` singular; 6 rules fire on two | §5.4 makes it a list with `comparator`/`met`; adds `COUNT` unit |
| C-1 | MEDIUM | No per-rule subject-key table | §7.1 adds all 24 rows plus the oracle mapping |
| C-2 | MEDIUM | `ResolutionIndex` not shown as per-step | §2.1 builds it prefix-scoped per step |
| C-5 | MEDIUM | Source docs still stated the old object list | Pointer notes added to `DOMAIN_MODEL_V0.md` and `CLIENT_OPERATING_GRAPH.md` |
| C-3 | LOW | Reducer fallback undefined | §9.2 states unknown pairs leave status unchanged and mark `ignored` |
| C-4 | LOW | Agent ordering unstated | §8 makes ordering part of the contract |
| C-6 | LOW | Canonical ID derivation ambiguous | §4.1 states one rule; `AP-`/`SVI-` chosen; `Project` documented as the sole exception |
| C-7 | LOW | `method` vs `derivedBy` overlap | §4.1 distinguishes them in one sentence |
| C-8 | LOW | Two meanings of "visible"; §13→§16 gap | §7.2 renames its output "unsuppressed" and states what the oracle compares; sections renumbered |

### Revision 3 findings, resolved in this revision

| # | Severity | Finding | Fix |
|---|---|---|---|
| N-1 | HIGH | `src/domain` had to name `GraphLink` (via `ReconciledView.links` and `DecisionProjection.linkOverlay`) while `src/graph/core` sat above it — a 3↔4 cycle introduced by the B-1 fix | §3.1: all shared types are declared at layer 3; `src/graph/core` becomes indexing and traversal. The same declare-low rule the design already applied to `ReconciledView`, applied consistently |
| N-2 | MEDIUM | §2.1 never called `computeProjectMetrics` for the current period, so metrics were implicitly agent output | §2.1 computes `metrics_i` per step and passes it into `runAgents`; stated as engine substrate |
| N-3 | MEDIUM | Overlays were arrays, so the "idempotency is structural" claim failed for the two inputs Demos A and C depend on | §4.4 makes all three overlays keyed `Map`s with last-write-wins, consistent with `AdjustmentSet` |
| N-4 | MEDIUM | `ignored: true` bound only the status reducer, so an ignored decision still moved the numbers | §9.4 + §2.1: ignored decisions are filtered before `projectDecisions` |
| N-5 | MEDIUM | No eligibility rule for `ACCEPT_ADJUSTMENT` — an accepted adjustment could double-count a posted or suppressed-duplicate invoice | §9.2 adds a per-adjustment eligibility table to `validateDecision` |
| N-6 | MEDIUM | `DecisionPayload` was referenced but never defined; `FC_STALE` cost-code semantics undecided | §9.1 adds the full payload table; forecast age measured from the **oldest** cost code, so one answer cannot declare a ten-code forecast fresh |
| N-9 | MEDIUM | Two paths reached SOV data; only `sovItemForChangeOrder` was projection-aware | §4.3 adds `sovItemsForProject` / `billingsForProject`; billing rules must use them |
| N-7 | LOW | The whitelist criterion contradicted its own ban list | §4.3 restates it: reconciliation-derived or human-changeable → link; containment and master-data lookup → field |
| N-8 | LOW | `suppressedDuplicateIds` as-of-invariant while `isValidInvoice` is parameterised | §6.2 states duplicate identity is a property of the record pair, deliberately not of the analysis date |
| N-10 | LOW | `effectiveDate` had no stated bound | §4.7: `validateDecision` rejects `effectiveDate > closeDate` |
| N-11 | LOW | "Subject keys are always canonical IDs" false for `DQ_PROJECT_MAP` | §4.1 qualifies it and explains why that one rule cannot have a canonical subject |
| N-13 | LOW | `clearedInThisReplay` not threaded through the loop | §7.3 states the cleared set accumulates forward |
| N-14 | LOW | Rejecting an `AP_DUPLICATE` finding cannot change any number | §7.3 states duplicate confirmation/rejection is status-only in V0, and why |
| N-12 | LOW | Demo C's downstream cascade undocumented, readable as a regression | §4.4 documents the `CO_APPROVED_UNBILLED` cascade as expected behaviour |

---

## 15. Implementation commitments from the Gate 1 pass

The r4 review passed the architecture and asked that these be made as the code is written, rather than as
another document revision. They are binding on the implementation.

### From the three new MEDIUMs

| # | Commitment |
|---|---|
| P-1 | **Overlay identity must be a pure function of the payload**, or structural idempotency is unproven for Demo C. Overlay SOV item id is `SVI-OVERLAY-<changeOrderId>`; every `GraphLink.id` is `<linkType>:<fromId>:<toId>`. Two identical `RECORD_SOV_CORRECTION` decisions must then collide on one key rather than producing two SOV lines and swinging `BILL_SOV_MISMATCH` by `2 × $420,000`. |
| P-2 | **Eligibility is enforced on both paths, from one predicate.** `buildResolutionIndex` applies the §9.2 eligibility table and marks ineligible adjustments `ignored: true`; `validateDecision` reuses the same predicate. Otherwise a hand-written test ledger — which is how the demos are written — can inject the `$75,920` phantom cost §9.2 exists to prevent. |
| P-3 | **`PM_FORECAST_UPDATE.comment` is per line**, not per decision, because `FC_PM_CHANGE_NO_EXPLANATION` is subject-keyed on the cost code. A single decision-level comment would let an explanation about one cost code clear the exception on nine others. |

### From the LOW list

| # | Commitment |
|---|---|
| L-1 | Declare `CanonicalModel`, `ProjectMetrics`, `EngineState` and `Snapshot` in `src/domain` under the same declare-low rule; layers 6 and 7 are not granted `data/normalize`, so `CanonicalModel` must be a layer-3 type for their signatures to typecheck. |
| L-2 | **`FC_STALE` ranges only over cost codes that have a forecast snapshot.** `CC-P-1005-239777` — the unmapped code from `JC-00388` — is a real `CostCode` with no snapshot; including it would give `P-1005` infinite forecast age and produce a count of 2 against the oracle's 1. |
| L-3 | `ReviewDecision` carries `subject: { projectId, canonicalId }` explicitly. Recovering `projectId` by string-splitting `exceptionId` would be parsing a composite key to recover a foreign key — the pattern this architecture bans. |
| L-4 | `riskAcceptances` must have a named consumer or be dropped, held to the same bar as every node and link type. |
| L-5 | State that master-data links (`ISSUES`, `MANAGED_BY`, `WORKS_ON`) are **projected from** the whitelisted field and never independently reconciled, so the field and the link cannot diverge. |
| L-6 | Narrow the `graph/core` import grant to layers 8 and 13. Under the r4 arrangement layers 5–7 need neither adjacency nor BFS, and leaving the grant open gives `src/calculations` a sanctioned way to build its own index and re-join. |
| L-7 | Add `model\.(sovItems\|billings)` under `src/exceptions` to the §11 architecture greps, closing N-9's enforcement gap. |
| L-8 | Split `src/domain` by concern (`entities.ts`, `graph.ts`, `workflow.ts`, `reconciliation.ts`, `ids.ts`, `money.ts`) so it does not become an undifferentiated `types.ts`. |
