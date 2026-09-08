# Final Technical Review

Populated 2026-08-25 by the Lead Engineer, after three independent reviewer passes and the corrections they required.

## Starter-kit validation

- `python3 scripts/validate_mock_data.py`: **PASS** — 22,593 labour rows, max employee-day ≤ 12h, 15 change orders with valid approval chronology, 29 config thresholds, 2 deliberate blank forecast explanations, closed-PO / pending-invoice / rejected-CO / referential-integrity controls all pass.
- `python3 scripts/validate_reference_metrics.py`: **PASS** — 12 project/date baseline rows recomputed independently from the raw CSVs, tying within `$0.02` / 0.02 percentage points.
- Exact exception rule counts: **PASS** — all 24 rules match `expected_rule_counts.csv` exactly.
- Seeded exception instances: **PASS** — all 59 instances in `expected_seeded_exceptions.csv` matched on rule, project, source record, owner and blocking flag.
- Negative controls: **PASS** — all 6 in `expected_negative_controls.csv`, plus four direct assertions.
- Edge-case fixtures: **PASS** — all 5 cases in `edge_case_fixtures.json`.

No reference file was modified at any point. Where the application and the oracle disagreed, the application was wrong and was changed.

## Build reviewed

- **Date:** 2026-08-25
- **Working tree:** not under version control (see Known limitations)
- **Scope reviewed:** complete V0 — canonical model, Client Operating Graph, three workstreams, four agents, workflow state machine, four screens, three required demos.

## Architecture reviewer

- **Verdict:** **PASS**
- **BLOCKER findings:** 1, at the design gate. Reconciled relationships would have existed twice — as foreign keys on canonical entities *and* as graph links — so the EAC arithmetic and the graph explorer could disagree about which invoices count. Resolved before implementation by banning counterparty ids from entities entirely and routing every reconciled relationship through one `ReconciledView`.
- **HIGH findings:** 8 across four design passes plus 1 post-implementation.
  - Design: `src/data` sitting below `src/domain`; suppression needing resolution state (a real cycle); two competing producers of `AgentAction`; "append a snapshot" contradicting the frozen model; an incomplete rule taxonomy; throwing inside `replay` (which would have bricked every screen permanently); evidence typed too narrowly to express ~10 rules; a type-placement cycle inside `src/domain`.
  - Implementation: `ResolveForm` recovering a cost code by string-splitting an exception id, which produced a non-existent cost code for stale-forecast tasks — the resulting forecast landed in the project total but in no cost code's detail, and the exception could never clear.
- **MEDIUM findings:** 12 at design, 6 post-implementation. All addressed.
- **LOW findings:** 13 at design, 7 post-implementation. Substantially all addressed; residuals listed below.
- **Corrections made:** four design revisions before any code was written, then the `forecastTargets` module, the eligibility gate on cost codes, `effectiveProjection` threaded through to the graph, portfolio aggregation moved into the calculation layer, and `computeMovement` unified so the screen and the Controller-escalation control compute movement the same way.
- **Remaining concerns:** none at BLOCKER or HIGH. Re-check quote: *"No unresolved BLOCKER or HIGH. The canonical model carries no reconciled counterparty ids, every relationship is reached through one `ReconciledView`, the graph draws the same link objects the rules consumed and now the same projection the arithmetic used, `replay` is pure and its decision loop evaluates each decision against the state before it, the four agents partition all 24 rules with enforced action sets, and both §3.2 invariants now have tests that can actually fail."*

## Finance/data reviewer

- **Verdict:** **PASS WITH ISSUES**
- **Double-counting verdict:** **CLEAN** — *"I could not construct a sequence of decisions that counts the same obligation twice."*
- **Seeded scenario status:** exact counts PASS, exact instances PASS, negative controls PASS, edge fixtures PASS. The reviewer re-derived P-1001 at both dates entirely from source without using the oracle as an input, and every figure tied.
- **BLOCKER findings:** none.
- **HIGH findings:** none.
- **MEDIUM findings:** 6, all fixed.
  1. Labour hours returned a fabricated `0` for any as-of date other than the two configured ones, which would have reported "0% of hours consumed against 52% progress" — a confident, precise, wrong number. Now returns `null` and the labour-burn rule skips.
  2. `FC_PROFIT_RISK_CONCENTRATION` stated the exposure backwards, implying a downside that the forecast already absorbed. Rewritten to describe unrecovered sunk cost with upside conditional on approval.
  3. `AP_COMMITMENT_OVERRUN` suppressed *every* invoice on an over-committed PO, so one genuinely stale invoice could hide behind an unrelated overrun. Now suppresses only the invoices past the committed amount.
  4. `LABOR_MISSING_POSTING` aged a cost-code group by its *newest* unposted entry, so one recent timecard could hide forty stale ones. Now selects the late subset and ages from the oldest.
  5. `DQ_PROJECT_MAP` was marked blocking but blocked nothing, because it belongs to no project. Portfolio-level close readiness added; a project whose own items are clear now reports `heldByPortfolioIssue`.
  6. `AP_COST_CODE_MISMATCH` evaluated pending and suppressed-duplicate invoices, raising a blocking exception about a document the model had already declared invalid. Now restricted to valid invoices.
- **LOW findings:** 5. Fixed: severity split-points still hard-coded (partially — see residuals), evidence comparators not matching the code (`GT` added), stale-forecast prose contradicting its own measurement. Recorded rather than fixed: prior-period commitment relief (now assumption A-08), the vacuous NC-02 control.
- **Corrections made:** all six MEDIUMs, plus regression tests for each. Assumption A-08 added.
- **Remaining concerns:** none at BLOCKER or HIGH. The reviewer's closing note is worth repeating: *"None of these change a seeded count, which is exactly why the passing test suite did not surface them."*

## QA reviewer

- **Verdict at first pass:** **FAIL** — 2 BLOCKER, 2 HIGH.
- **Verdict after re-check:** **PASS WITH ISSUES** — all four independently confirmed closed using the reviewer's own harness, not my tests.
- **Tests:** `npx vitest run` → **403 passing**, 10 files.
- **Type check:** `npx tsc --noEmit` → clean.
- **Lint:** `npm run lint` → no warnings or errors.
- **Production build:** `npm run build` → succeeds, 8 routes.
- **BLOCKER findings:** 2, both fixed.
  1. **A material forecast change could reach close-ready with no Controller approval.** A blocking Controller escalation silently disappeared on the *next* decision — any decision, on any project — after which the project reported itself ready to close with the elevated forecast intact, and the escalation was permanently un-actionable through the API. Root cause: tasks were rebuilt from scratch each replay step and the Controller review has no rule behind it to re-detect it. Fixed by carrying the review forward on every pass, with the resolution index deciding its status.
  2. **The test suite was red** at the moment of review, due to a stale assertion that contradicted the newly added portfolio-blocking behaviour. Fixed.
- **HIGH findings:** 2, both fixed.
  1. **Untyped JSON corrupted the arithmetic into string concatenation.** Posting `amount: "120000"` was accepted; every `+=` downstream became string concatenation, EAC became a 28-character string that coerced back to a plausible number, and the project reported a 43.4% margin that was simply wrong. Fixed with a runtime validator at the HTTP boundary and an `isMoney()` guard in `checkEligibility` so the replay path is protected independently.
  2. **A `NaN` forecast value propagated into the domain and silently disabled `FC_MARGIN_FADE` and `FC_EAC_DETERIORATION`** — corrupting the forecast was also the way to switch off the two rules that watch it. Same fix; regression test asserts both rules still fire.
- **MEDIUM findings:** 7. Fixed: 10 dangling `EMP-*` evidence node ids (employees were cited as evidence but never created as graph nodes); human-created forecast snapshots absent from the graph; the work-queue headline mixing units and multi-counting; `/api/demo` throwing a 500 on a malformed body; `decisionStore.all()` handing out its live array. Outstanding: backdated `effectiveDate`, and three of five edge-case fixtures exercising a copy of the logic rather than the engine.
- **Corrections made:** all BLOCKER and HIGH findings, plus five of seven MEDIUMs, each with a regression test in `tests/integration/hardening.test.ts`.
- **Re-check evidence (reviewer's own harness, not mine):** the escalation now survives an unrelated decision, five further noise decisions, and resolves to `RESOLVED` on Controller approval; string, `NaN` and `Infinity` amounts are all rejected with the margin back at the correct 11.86%; both forecast-watching rules confirmed still firing; 0 dangling evidence node ids across three ledger states (was 10); **300 fresh hostile ledgers with a readiness-monotonicity invariant — 0 throws, 0 violations.**
- **What held under attack, per the reviewer:** determinism exact across repeated replays; **300 hostile ledgers produced zero throws**; idempotency correct across all three adjustment types; adjustments larger than the underlying balance rejected; accrual against an already-posted invoice or the suppressed duplicate rejected; suppression precedence releasing correctly; `ACCEPTED_RISK` handled properly; prior-period reconstruction genuinely decision-free; the graph inventing no unsupported links; `null` never rendered as zero.

## Cross-review summary

### BLOCKER/HIGH issues found and fixed

| Issue | Reviewer | Fix | Regression test | Re-review result |
|---|---|---|---|---|
| Reconciled relationships duplicated as FKs and links | Architecture | Entities carry no counterparty ids; one `ReconciledView` | `architecture.test.ts` (two greps) | RESOLVED |
| `src/data` below `src/domain` | Architecture | Three-level split | `architecture.test.ts` layering | RESOLVED |
| Suppression needing resolution state (cycle) | Architecture | Pure reducer in `src/domain`; index injected | `ruleCounts.test.ts` | RESOLVED |
| Two producers of `AgentAction` | Architecture | Agents sole emitter | `hardening.test.ts` | RESOLVED |
| Frozen model vs appended snapshots | Architecture | `DecisionProjection` overlays | `workflow.test.ts` | RESOLVED |
| Incomplete rule taxonomy | Architecture | `detected ∪ ledgerReferenced ∪ cleared` | `workflow.test.ts` | RESOLVED |
| Throwing inside `replay` | Architecture | Validation on the write path | `workflow.test.ts` | RESOLVED |
| Evidence type too narrow | Architecture | Widened to nodes + refs + measured + thresholds | `ruleCounts.test.ts` | RESOLVED |
| `src/domain` ↔ `src/graph/core` cycle | Architecture | Types declared at layer 3 | `architecture.test.ts` layering | RESOLVED |
| Cost code recovered by string-splitting an id | Architecture | `forecastTargets` + eligibility gate | `hardening.test.ts` | RESOLVED |
| Controller review vanishing → false close-ready | QA | Orchestrator carries reviews forward | `hardening.test.ts` (3 tests) | RESOLVED — verified across a 5-stage lifecycle plus 5 noise decisions |
| Red test suite | QA | Stale assertion updated | — | RESOLVED — 403 green |
| String amounts corrupting EAC | QA | `validateBody` + `isMoney()` | `hardening.test.ts` (5 tests) | RESOLVED |
| `NaN` forecast disabling two rules | QA | `isMoney()` guard | `hardening.test.ts` | RESOLVED |

## Remaining MEDIUM/LOW issues

| Issue | Severity | Decision | Follow-up |
|---|---|---|---|
| Backdated `effectiveDate` resolves a task but changes nothing | MEDIUM | Deferred, recorded as assumption A-09 — unreachable through the API, which always stamps the close date | Add a lower bound in `checkTransition` |
| Edge-case fixtures testing a copy of the logic | MEDIUM | **Fixed** — `percentComplete` exported from the calculation layer, and the two rule cases now drive `detectExceptions` | — |
| `dollarExposure` still double-counts the P-1004 $420,000 | LOW | Accepted — the treble-count is now a double-count; `BILL_SOV_MISMATCH` keys on the project, not the change order | Link the mismatch to its underlying CO exception |
| Resolved Controller review flagged `currentlyTriggering` | LOW | **Fixed** — now derived from the resolution index | — |
| `dollarExposure` de-duplicates two of three views of the same money | LOW | Accepted — a full subject hierarchy is beyond V0; the figure is labelled "value affected" | Model subject relationships if the number becomes load-bearing |
| Severity split-points (`* 4`, `>= 0.25`) hard-coded in rule bodies | LOW | Accepted — no count impact, but they do drive triage order | Move to `Thresholds` |
| NC-02 negative control can pass vacuously under substring matching | LOW | Accepted — the labour half has a direct assertion elsewhere | Resolve oracle tokens to canonical ids |
| `BudgetLine.linkedChangeOrderId` populated but never read | LOW | Accepted | Delete or consume |
| `actionEmitter` throws where the design specified a typed error | LOW | Accepted — fail-fast is defensible for a programming error | Reconcile code and doc |
| Overlay `MAPS_TO` links resolved by regex-stripping id prefixes | LOW | Accepted | Iterate `sovOverlay` directly |
| `deepFreeze` Map-mutator override is clever machinery | LOW | Accepted — it works and is commented | Consider simplifying |

## Assumptions still requiring domain validation

All recorded in `docs/decisions/ASSUMPTIONS.md` (A-01 … A-08) with evidence and the alternative considered. The ones that most need a real contractor CFO's eye:

- **A-01** — profit-risk exposure measured as pending-CO *incurred cost* rather than requested value. Confirmed by the oracle and defensible economically, but the basis is a policy choice.
- **A-02** — original margin computed from the ERP project master's `original_budget_cost`. **P-1004 sits 0.26 percentage points from triggering margin fade**, so if this basis ever diverges from the sum of cost-code budgets the rule count changes with no obvious cause.
- **A-04** — `FC_STALE` treated as blocking, with `blockingScope` retained but not yet honoured separately.
- **A-06 / A-07** — labour grouping and duplicate-selection tie-breaks. The finance reviewer suggests preferring "posted first, then earliest date" for duplicates, since a purely lexicographic tie-break could in principle suppress the record that already posted.
- **A-08** — at the prior close, no invoice in the data predates 2026-07-10, so remaining commitment is the full PO balance on every purchase order. The three EAC-deterioration magnitudes should be read as directional rather than precise.
- Whether `change_orders.cost_incurred_to_date` is represented inside `job_cost_transactions` is **not** reconciled by the implementation. If it is not, EAC omits real incurred cost.

## Behaviour still mocked

- **All data is fictional.** Five simulated source systems as CSV exports; no ERP, PM, payroll or banking integration.
- **No LLM is called.** Every explanation is a deterministic template over computed numbers. The design's `NarrativeAdapter` boundary was dropped as ceremony for V0; narrative is built inline in each rule.
- **No authentication.** The persona switcher is a demo affordance, labelled as such. Role authority *is* genuinely enforced by the workflow — only a Controller can accept a risk — but anyone can choose to be the Controller.
- **The decision ledger is in memory.** It survives dev hot-reloading but not a server restart, and is not shared across processes.
- **No journal entries, no postings, no payments, no irreversible action of any kind.**
- **Agent decisions are deterministic.** There is no learning, no ranking model, no natural-language interpretation of free text.
- **`FC_STALE` blocking scope** is recorded on the record but not honoured separately from a full close block.

## Known limitations

- **Not GAAP.** Every WIP and revenue figure is draft management analysis. The footer says so on every screen.
- **Duplicate detection is exact-match only** (same vendor, same invoice number). Near-duplicates — same vendor, same amount, similar date — are out of scope and would need their own review workflow.
- **Confirming or rejecting a duplicate is status-only.** Restoring a suppressed invoice to valid cumulative invoicing would change remaining commitment and possibly the overrun exception; that belongs with a real AP workflow.
- **Prior-period reconstruction supports the two configured dates.** Labour is pre-aggregated for those dates only; any other as-of date now correctly reports "not aggregated" rather than zero.
- **The repository is not under version control.** No Git repository exists in this directory. Recommended before any further work.
- **Three `npm audit` highs** in `sharp`, an optional transitive image-optimisation dependency of Next that this prototype never invokes.

## Completion decision

V0 may be declared complete only if:
- all three reviewers have no unresolved BLOCKER/HIGH findings
- configured tests/checks pass or any unavailable check is explicitly documented
- known accounting assumptions remain labeled as assumptions
- no prototype output is represented as authoritative GAAP accounting

**Final status:** **COMPLETE.**

- Architecture: **PASS**
- Finance / data: **PASS WITH ISSUES** (no BLOCKER, no HIGH; double-counting CLEAN)
- QA: **PASS WITH ISSUES** after re-check (both BLOCKERs and both HIGHs independently confirmed closed)

No unresolved BLOCKER or HIGH finding from any reviewer. Verified with the dev server stopped and `.next`
cleared: **403 tests passing** across 10 files, type check clean, lint clean, production build succeeds across
8 routes, and both Python validators pass. No output is represented as GAAP accounting, and every accounting
interpretation is recorded as a labelled assumption in `ASSUMPTIONS.md`.
