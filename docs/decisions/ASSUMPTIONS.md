# Assumptions

## Starter-kit assumptions

- All mock data is fictional.
- V0 calculations are management-view simplifications, not accounting advice.
- Pending COs are not automatically added to revised contract value.
- PM remaining cost means remaining **uncommitted** cost.
- Accepted management adjustments do not modify raw CSV source files.
- Project/cost-code progress is management information, not authoritative accounting evidence.
- Close readiness is a workflow status, not an audit opinion.
- V0 thresholds are fictional customer-policy defaults and should be configurable later.

---

## Implementation interpretations (added 2026-08-24)

These were settled by independently re-deriving the seeded oracle from the raw CSVs before writing application
code (see `BUILD_LOG.md`, Phase 0). Each one changes results, so each is recorded rather than left implicit.
All still require validation with a real contractor finance expert.

### A-01 — `FC_PROFIT_RISK_CONCENTRATION` measures incurred cost, not requested value

**Assumption.** "Pending CO cost exposure" is the sum of `cost_incurred_to_date` on pending change orders,
compared against current projected profit — not the requested CO value and not the estimated cost.

**Evidence.** With incurred cost, exactly two projects breach the 10% threshold — `P-1002` (`$180,000` /
`$1,193,029` = 15.1%) and `P-1004` (`$160,000` / `$1,264,727` = 12.7%) — matching `expected_rule_counts.csv`
(2) and `expected_seeded_exceptions.csv` (EX-056, EX-057). Using requested value yields four instances.

**Why it is also the right economics.** Money already spent on unapproved work is the money genuinely at risk.
An unapproved CO's requested value is a negotiating position, not an exposure.

### A-02 — Original margin uses `erp/projects.csv:original_budget_cost`

**Assumption.** `original_margin = (original_contract_value − original_budget_cost) / original_contract_value`,
taking `original_budget_cost` from the ERP project master.

**Evidence.** For `P-1001`: `(5,000,000 − 4,100,000) / 5,000,000 = 18.00%`, and projected margin is `11.86%`,
giving the `6.14` percentage-point fade in EX-053. In this data set the ERP figure equals the sum of the
original cost-code budgets in `project_budgets.csv`, so the two readings agree — but the ERP master is the
stated basis, per `FINANCIAL_LOGIC_V0.md` ("original margin uses **original budget**").

**Open question for a domain expert.** On a real job these two can diverge once the estimate is re-based. Which
one the customer considers "original" is a policy choice that should become configurable.

### A-03 — Prior-period billed-to-date is `billed_to_date − current_billed`

**Assumption.** At the `2026-06-30` comparison date, billed-to-date per SOV line is the July row's
`billed_to_date` minus its `current_billed`.

**Evidence.** `billings.csv` carries a single `2026-07` period row per SOV line; `DATA_DICTIONARY.md` states
"prior billed-to-date = billed_to_date − current_billed". `scripts/validate_reference_metrics.py` uses the same
derivation to reproduce the reference baseline.

**Limitation.** This works only because the mock data has one billing period. Real billing history would be
queried by period, and the code is written to take an `asOfDate` so that substitution is local.

### A-04 — `FC_STALE` is treated as blocking

**Assumption.** A stale PM forecast blocks close readiness.

**Evidence.** `expected_seeded_exceptions.csv` EX-058 marks it `blocking = True`.
`EXCEPTION_RULES_V0.md` describes the blocking scope more narrowly as "Forecast/WIP only".

**Resolution.** The exception is `blocking: true` with `blockingScope: 'FORECAST_WIP'` retained on the record,
so the narrower reading is preserved in data and can be honoured later without re-deriving anything. For V0,
close readiness depends on the forecast/WIP workstream, so the two readings coincide.

### A-05 — Controller review raised after a material human-driven change is blocking

**Assumption.** When a human answer moves EAC by ≥ `$100,000` or margin by ≥ `2.0` percentage points, the Close
Orchestrator raises a blocking Controller review task that must be approved (or the risk explicitly accepted)
before the project is close-ready.

**Rationale.** `PRODUCT_SPEC_V0.md` Demo A requires "material change routes to Controller", and `CLAUDE.md`
requires no autonomous accounting sign-off. Making it blocking is what makes the requirement visible rather
than advisory.

**Note.** This task uses a reserved pseudo-rule ID (`CLOSE_CONTROLLER_REVIEW`) and is excluded from
`expected_rule_counts.csv` comparisons, because it can only exist after a human decision and the oracle
describes the pre-decision baseline.

### A-06 — Unposted labor is grouped per project and cost code

**Assumption.** `LABOR_MISSING_POSTING` raises one exception per `(project, cost code)`, not one per time entry.

**Evidence.** `expected_rule_counts.csv` expects 1 instance, while the data contains 40 unposted approved rows
(`PC-7480` / `260200`, `$17,752`, work dates 2026-07-24 to 2026-07-27). EX-059 names the subject as
`PC-7480:260200 unposted labor`. The 40 individual rows are retained as evidence `sourceRefs`.

### A-07 — Duplicate invoice selection keeps the earliest record

**Assumption.** Within a `(vendor, invoice number)` group, sorting by
`(vendor_id, invoice_number, invoice_date, invoice_id)` keeps the first row and suppresses the rest.

**Evidence.** This makes `INV-00089` (invoice date 2026-07-19) the suppressed duplicate of `INV-00001`
(2026-07-10), matching EX-003, and is the same rule
`scripts/validate_reference_metrics.py` applies when computing valid cumulative invoicing.

**Limitation.** V0 detects exact vendor + invoice-number duplicates only. Near-duplicate detection (same
vendor, same amount, similar date) is deliberately out of scope and would need a human-review workflow.

### A-08 — At the prior close, remaining commitment is the full PO balance on every purchase order

**Assumption.** Only invoices relieve a commitment in the V0 model. No invoice in `ap_invoices.csv` is dated
before 2026-07-10, so at the `2026-06-30` comparison date valid cumulative invoicing is `$0` on every PO and
remaining commitment equals the full committed amount.

**Evidence.** `P-1001` prior remaining commitment is exactly `$1,625,000`, the sum of its seven POs. Meanwhile
prior posted cost of `$1,536,081` sits on the same cost codes, carried by `HIST-*` and `Payroll` postings whose
`source_type` is deliberately not `AP`.

**Why it probably does not distort the data.** The `HIST-*` document ids and non-AP source type indicate the
pre-July cost was not performed under those purchase orders, and `commitments.csv:erp_invoiced_to_date_snapshot`
independently confirms all PO invoicing is July — the ERP's own figure ties to our derived cumulative invoicing
on every PO except the deliberately over-committed `PO-0023`.

**Limitation to state when demoing.** To whatever extent pre-July cost *was* performed under those POs, prior
EAC carries the same obligation twice. The three `FC_EAC_DETERIORATION` magnitudes
(`$527,908` / `$471,515` / `$368,723`) should therefore be read as directional rather than precise.

### A-09 — Two known gaps deferred out of V0

Recorded so they are not silently forgotten.

1. **A backdated forecast update resolves its task without changing anything.** If a `PM_FORECAST_UPDATE`
   carries an `effectiveDate` earlier than the latest existing snapshot for that cost code, the overlay is
   correctly filtered out by "latest snapshot on or before as-of" — but the task still closes. Unreachable
   through the UI, which always stamps the close date; reachable through a hand-written ledger. The fix is a
   lower bound in `checkTransition`.
2. **Change-order incurred cost is not reconciled against job cost.** Nothing verifies whether
   `change_orders.cost_incurred_to_date` is already represented in `job_cost_transactions`. The
   `FC_PROFIT_RISK_CONCENTRATION` narrative assumes it is. If it is not, EAC omits real incurred cost — a
   different and more serious problem. This needs a domain expert's answer before the rule's wording can be
   relied on.
