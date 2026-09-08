# Exception Rules V0

## General

Every exception has:
- rule ID
- exception ID
- project
- workstream
- severity
- blocking flag
- title
- explanation
- dollar/operational impact where available
- evidence/source references
- recommended next action
- owner
- status

All thresholds come from `docs/product/V0_CONFIG.md` / the single typed runtime config.

## Rule precedence / suppression

Avoid noisy duplicate tasks.

1. `AP_DUPLICATE`:
   - exclude the suppressed duplicate invoice from valid cumulative invoicing
   - suppress `AP_MISSING_POSTING` for that duplicate until duplicate review is resolved

2. `AP_COMMITMENT_OVERRUN`:
   - if an invoice is held because it would exceed the commitment, suppress `AP_MISSING_POSTING` for that invoice while the overrun exception remains unresolved, regardless of posting-lag age

3. `DQ_UNMAPPED_COST_CODE` versus `DQ_UNBUDGETED_COST`:
   - when the cost code itself is unmapped, emit `DQ_UNMAPPED_COST_CODE`
   - suppress `DQ_UNBUDGETED_COST` until mapping is resolved
   - use `DQ_UNBUDGETED_COST` only for a **mapped** cost code whose current budget is zero / missing and material cost exists

4. `CO_MISSING_SOV`:
   - suppress a separate `CO_APPROVED_UNBILLED` task for the same CO until the SOV issue is resolved
   - project-level `BILL_SOV_MISMATCH` may remain visible as a grouped reconciliation status but should link to the underlying missing-CO exception instead of creating redundant tasks

5. Pending/non-approved AP invoices:
   - do not create `AP_MISSING_POSTING` until approved and outside posting lag

Related exceptions may coexist when they represent genuinely different economic risks.

---

# Data / reconciliation rules

## DQ_PROJECT_MAP — Project mapping mismatch
**Severity:** HIGH  
**Blocking:** yes

Source project cannot map to a canonical project.

## DQ_UNMAPPED_COST_CODE — Unmapped cost code
**Severity:** HIGH  
**Blocking:** yes

A project-mapped transaction/forecast of at least `unmappedCostCodeDollar` uses a cost code that cannot map to the project budget.

Keep the amount in the project total under `UNMAPPED`.

## DQ_UNBUDGETED_COST — Unbudgeted cost activity
**Severity:** HIGH  
**Blocking:** yes

A **mapped** cost code with current budget = 0 has posted/accepted cost of at least `unbudgetedCostDollar`.

Do not emit when the code itself is unmapped.

## AP_MISSING_POSTING — AP-to-job-cost missing posting
**Severity:** HIGH  
**Blocking:** yes

Approved, valid, non-duplicate invoice older than `apPostingLagDays` has no corresponding job-cost posting and is not being held by a higher-precedence unresolved over-commitment exception.

## LABOR_MISSING_POSTING — Labor-to-job-cost missing posting
**Severity:** HIGH  
**Blocking:** yes

Approved labor older than `laborPostingLagDays` is not represented in payroll/job cost.

## FC_STALE — Stale PM forecast
**Severity:** MEDIUM  
**Blocking:** Forecast/WIP only

Latest forecast snapshot is older than `forecastStaleDays`.

---

# AP & cost control

## AP_DUPLICATE — Probable duplicate invoice
**Severity:** HIGH  
**Blocking:** yes

Exact vendor + invoice number duplicate in V0.

## AP_COMMITMENT_OVERRUN — Commitment overrun
**Severity:** HIGH  
**Blocking:** yes

Cumulative valid approved non-duplicate invoices linked to a PO exceed committed amount by at least `commitmentOverrunDollar`.

Do not compare one historical invoice against a final remaining-PO snapshot.

## AP_COST_CODE_MISMATCH — Invoice cost-code mismatch
**Severity:** MEDIUM  
**Blocking:** yes

Invoice cost code differs from the matched commitment cost code.

## AP_RNI — Received not invoiced
**Severity:** MEDIUM/HIGH  
**Blocking:** yes at material threshold

Cumulative receipt value minus valid cumulative invoice value:
- MEDIUM at `rniMediumDollar`
- HIGH at `rniHighDollar`

---

# Forecast / project economics

## FC_MARGIN_FADE — Margin fade
**Severity:** HIGH

Current projected margin is at least `marginFadePercentagePoints` below original project margin.

## FC_EAC_DETERIORATION — Month-over-month EAC deterioration
**Severity:** HIGH

Current EAC exceeds correctly reconstructed prior EAC by:
- at least `eacDeteriorationDollar`, OR
- at least `eacDeteriorationPctContract` of revised contract value

## FC_COST_CODE_OVERRUN — Cost-code overrun
**Severity:** MEDIUM/HIGH

Cost-code EAC exceeds **current budget** by more than `costCodeOverrunPct`.

## FC_LABOR_BURN — Labor burn ahead of progress
**Severity:** HIGH

When budgeted labor hours > 0:

`hours_consumed_pct - physical_progress_pct >= laborBurnAheadProgressPercentagePoints`

## FC_PM_CHANGE_NO_EXPLANATION — Large PM forecast change without explanation
**Severity:** MEDIUM

Current PM remaining-cost assumption changes by:
- at least `pmChangeCommentDollar`, OR
- at least `pmChangeCommentPct` versus prior value

AND the **current** comment is empty/whitespace after trimming.

If prior value = 0, use the dollar threshold only.

## FC_PROFIT_RISK_CONCENTRATION — Profit-risk concentration
**Severity:** MEDIUM/HIGH

Pending CO cost exposure is at least `pendingCoCostPctProjectedProfit` of current projected profit.

If projected profit <= 0, route to Controller as inherently material rather than dividing by zero.

## FC_COMPLETE_CODE_REMAINING — Complete cost code still has remaining forecast
**Severity:** MEDIUM

Cost-code physical progress is at least `completeCostCodeProgressPct` while PM remaining uncommitted cost is at least `completeCostCodeRemainingForecastDollar`.

This is a forecast-consistency question, not an accounting entry.

---

# Change orders / billing

## CO_LARGE_AGING — Large aging pending CO
**Severity:** MEDIUM/HIGH

Pending CO meets both:
- requested value >= `pendingCoDollar`
- days open >= `pendingCoDays`

## CO_UNAPPROVED_COST — Cost incurred on unapproved change
**Severity:** HIGH  
**Blocking:** yes

Pending CO has incurred cost >= `unapprovedCoIncurredCostDollar`.

Rejected COs are excluded.

## CO_MISSING_SOV — Approved CO missing from SOV
**Severity:** HIGH  
**Blocking:** yes

Approved CO has no SOV item.

## CO_APPROVED_UNBILLED — Approved CO unbilled after threshold
**Severity:** MEDIUM/HIGH

Approved CO has:
- unbilled value >= `approvedCoUnbilledDollar`
- days since approval >= `approvedCoUnbilledDays`

Suppress while `CO_MISSING_SOV` for the same CO is unresolved.

## BILL_UNDERBILLING — Material underbilling
**Severity:** MEDIUM/HIGH

Negative billing position exceeds:
- `underbillingDollar`, OR
- `underbillingPctContract` of revised contract value

## BILL_SOV_MISMATCH — SOV does not reconcile to revised contract
**Severity:** HIGH  
**Blocking:** yes

SOV total differs from revised contract beyond `sovToleranceDollar`.

Group with underlying missing-CO exceptions when they explain the mismatch.

## BILL_RETAINAGE — Retainage inconsistency
**Severity:** MEDIUM

Billed-line retainage differs from expected SOV retainage beyond `retainageToleranceDollar`.

---

# Close readiness

A project is not close-ready while any blocking task is unresolved.

Severity and blocking are separate concepts.
