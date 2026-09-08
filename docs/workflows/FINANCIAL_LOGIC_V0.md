# Financial Logic V0

## Purpose

These calculations are simplified management logic for a prototype. They are not authoritative accounting policy.

All arithmetic must be deterministic code.

Use dates and thresholds from `docs/product/V0_CONFIG.md`.

## Source-validity rules

### Valid AP invoice for commitment / project analysis
An invoice is valid for cumulative commitment analysis only when:
- `approval_status = approved`
- approval date is on or before the analysis date
- it is not the suppressed duplicate in an exact duplicate group

Pending/non-approved invoices remain visible as source objects but do not reduce remaining commitment, create posted cost, or trigger AP-missing-posting.

### Valid change order for contract value
Only `status = approved` with approval date on or before the analysis date increases revised contract value.

Pending and rejected COs do not increase revised contract value.

## Contract

`revised_contract_value = original_contract_value + sum(valid approved change_order_value)`

## Cost buckets

### Posted cost
Sum all project-mapped job-cost transactions through the analysis date.

If the project maps correctly but the cost code does not, the cost still belongs in the **project total** under an `UNMAPPED / NEEDS CLASSIFICATION` bucket. Do not drop it from EAC.

### AP approved but not posted
An approved invoice may already reduce the commitment's remaining balance even if the job-cost posting is absent.

If the human accepts an AP-unposted management adjustment:
- add the invoice amount to adjusted cost-to-date
- do not subtract it from remaining commitment again when valid invoicing already reduced that commitment

### Received not invoiced (RNI)
Compute from detail:

`received_value_to_date = sum(valid receipts through analysis date)`

`invoice_value_to_date = sum(valid linked invoices through analysis date)`

`rni_candidate = max(received_value_to_date - invoice_value_to_date, 0)`

If accepted:
- add accepted RNI to adjusted cost-to-date
- subtract the accepted RNI amount from remaining commitment to prevent double counting

**RNI invariant:** if the full economic obligation was already represented in the commitment, accepting RNI normally changes cost-to-date / draft WIP timing but does not, by itself, increase EAC.

### Unposted labor
Approved labor not yet represented in payroll/job cost can be accepted as a management close adjustment.

Labor cost:

`labor_cost = regular_hours × hourly_cost_rate + overtime_hours × hourly_cost_rate × overtime_multiplier`

For Summit MEP V0:

`overtime_multiplier = 1.5`

If accepted:
- add estimated labor cost to adjusted cost-to-date
- do not reduce commitments
- EAC can increase unless the PM remaining forecast is explicitly reduced

## Adjusted cost-to-date

`adjusted_cost_to_date = posted_cost + accepted_ap_unposted + accepted_rni + accepted_unposted_labor + other_accepted_management_adjustments`

Keep adjustment types separate and idempotent. The same source item cannot create the same accepted adjustment twice.

## Remaining commitment

For each PO:

`valid_invoiced = cumulative valid linked invoices`

`remaining_commitment_before_rni = max(committed_amount - valid_invoiced, 0)`

`remaining_commitment_after_rni = max(remaining_commitment_before_rni - accepted_rni, 0)`

A closed/full-invoiced PO should have zero remaining commitment.

## PM remaining uncommitted cost

This field means:
> expected future cost not already incurred and not already represented by a commitment.

Do not require it to cover commitments.

## EAC

At cost-code level:

`EAC = adjusted_cost_to_date + remaining_commitment_after_rni + pm_remaining_uncommitted_cost`

Project EAC is the sum across cost codes, including `UNMAPPED` project-mapped costs.

## Profit and margin

`projected_profit = revised_contract_value - EAC`

If revised contract value > 0:

`projected_margin = projected_profit / revised_contract_value`

Otherwise projected margin is `null / not applicable`.

Original margin uses **original budget**, not current/revised cost-code budget:

`original_margin = (original_contract_value - original_budget_cost) / original_contract_value`

If original contract value = 0, original margin is `null / not applicable`.

## Draft WIP management view

If EAC > 0:

`percent_complete = adjusted_cost_to_date / EAC`, capped to 0–100%.

If EAC = 0 and adjusted cost-to-date = 0, percent complete = 0%.

If EAC = 0 but adjusted cost-to-date != 0, flag inconsistent data and do not divide.

`draft_earned_revenue = revised_contract_value × percent_complete`

`billing_position = billed_to_date - draft_earned_revenue`

Positive = overbilled.
Negative = underbilled.

These are draft management metrics, not autonomous GAAP revenue recognition.

## Prior-month reconstruction

To calculate prior EAC at `2026-06-30`:
- include job-cost postings through the prior date
- use valid AP/receipt activity through the prior date
- calculate remaining commitment from cumulative valid invoices through the prior date
- use the latest PM forecast snapshot available on or before the prior date
- include only COs approved on or before the prior date
- use billed-to-date as of the prior date

Do not combine current actuals with a historical PM forecast and call it prior EAC.

## Labor burn

Use cost-code-level:
- budgeted labor hours
- cumulative approved labor hours through the analysis date
- PM remaining labor hours
- physical progress by cost code

Indicators:

`hours_consumed_pct = actual_hours / budgeted_hours`

`forecast_hours = actual_hours + pm_remaining_labor_hours`

`forecast_hours_over_budget_pct = forecast_hours / budgeted_hours - 1`

When budgeted labor hours = 0, percentage indicators are `null / not applicable`.

Compare hours-consumed percentage with cost-code physical progress only when the denominator is valid.

## Budget basis

- `original_budget` preserves original estimating/baseline economics.
- `current_budget` reflects approved/reviewed project budget revisions.
- Cost-code overrun exceptions compare EAC with **current budget**.
- Budget revision fields should retain the reason and linked change order when applicable.

## Reference baseline

`expected_baseline_project_metrics.csv` is explicitly **pre-human-adjustment** baseline output:
- `posted_cost_to_date` is the ledger amount before accepted simulated AP/RNI/labor adjustments
- `baseline_eac` is the pre-adjustment EAC
- downstream simulated human decisions are expected to produce different values
