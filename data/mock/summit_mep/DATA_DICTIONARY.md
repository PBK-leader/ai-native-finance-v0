# Summit MEP Mock Data

All data is fictional.

## Design goal

The dataset simulates several client systems rather than one clean table. The V0 must normalize and reconcile those sources.
Important anomalies are intentional, but the underlying synthetic data should remain physically and temporally plausible.

## File inventory

| File | Rows | Purpose |
|---|---:|---|
| `raw/erp/ap_invoices.csv` | 109 | AP invoice source records with approval/posting states, plus duplicate/overrun/mismatch/missing-posting and pending controls. |
| `raw/erp/commitments.csv` | 44 | PO/subcontract commitments, including one closed/full-invoiced control. |
| `raw/erp/job_cost_transactions.csv` | 442 | Posted project-cost ledger. `cost_type` is economic category; `source_type` identifies AP/Payroll/etc. |
| `raw/erp/material_receipts.csv` | 88 | Receipt detail used for RNI reconciliation. |
| `raw/erp/projects.csv` | 6 | ERP project/job master. |
| `raw/master_data/company.csv` | 1 | Company master / graph root. |
| `raw/master_data/divisions.csv` | 3 | Trade/division master. |
| `raw/master_data/employees.csv` | 270 | Field employee master used by realistic timekeeping rows. |
| `raw/master_data/people.csv` | 11 | PM and finance people used for task routing / graph. |
| `raw/master_data/project_id_map.csv` | 7 | Canonical ↔ ERP ↔ PM project mapping; contains one intentional unmapped PM project. |
| `raw/master_data/vendors.csv` | 11 | Vendor master; every active vendor is used by at least one PO/invoice. |
| `raw/project_management/billings.csv` | 36 | July billing rows where prior billed-to-date = billed_to_date − current_billed. |
| `raw/project_management/change_orders.csv` | 15 | Approved/pending/rejected COs with valid chronology and approval dates. |
| `raw/project_management/cost_code_progress.csv` | 122 | Prior/current physical progress snapshots by cost code. |
| `raw/project_management/pm_forecasts.csv` | 122 | Prior/current PM forecast snapshots; material changes have narratives except two seeded blank-explanation cases. |
| `raw/project_management/project_budgets.csv` | 61 | Original/current cost-code budgets, budgeted labor hours, and budget-revision evidence. |
| `raw/project_management/projects.csv` | 7 | PM project master and overall progress, including one intentionally unmapped source project. |
| `raw/project_management/schedule_of_values.csv` | 36 | SOV including two intentionally missing approved COs. |
| `raw/timekeeping/labor_entries.csv` | 22,593 | Individual employee/day/cost-code time entries. Max 8 regular + 4 overtime; employee-day max 12h; runs through close date. |

## Core joins

- project mapping: `project_id_map`
- invoice → commitment: `commitment_id`
- receipt → commitment: `commitment_id`
- AP posting → invoice: `job_cost_transactions.source_doc_id = ap_invoices.invoice_id`
- labor / forecast / progress / budget connect through project + cost code

## Cost-type versus source-type

`job_cost_transactions.cost_type` is an economic category such as `Labor`, `Material`, `Equipment`, `Subcontract`, `Labor/Material`, or `Other`.

`job_cost_transactions.source_type` identifies the posting source such as `AP`, `Payroll`, or `Other`.

`AP` must never be used as a `cost_type`.

## Labor conventions

Each row in `labor_entries.csv` is an individual employee-day-cost-code entry.

- regular hours per row: <= 8
- overtime hours per row: <= 4
- total hours per employee per day across all rows: <= 12
- overtime labor cost multiplier: 1.5×
- labor data runs through the 2026-07-31 close date

Labor cost formula:
`regular_hours × hourly_cost_rate + overtime_hours × hourly_cost_rate × 1.5`

Selected approved P-1004 labor entries are intentionally not posted to payroll/job cost to seed the missing-labor workflow.

## Budget conventions

- `original_budget` is the original estimating baseline.
- `current_budget` includes approved/reviewed project-budget revisions.
- cost-code overrun compares EAC with `current_budget`.
- P-1004 contains a documented $120K current-budget revision linked to CO-1004-A.

## Forecast comments

`FC_PM_CHANGE_NO_EXPLANATION` means the latest material forecast change has an empty/whitespace comment.

Most material forecast changes contain a short PM narrative. Exactly two current material changes are intentionally blank for the seeded exception.

## Temporal behavior

- close date: 2026-07-31
- prior comparison date: 2026-06-30
- PM forecasts and cost-code progress contain prior/current snapshots
- job-cost, labor, invoice, receipt, CO and billing data are dated so prior-period analysis can be reconstructed

## Deliberate positive anomalies

See `reference/expected_seeded_exceptions.csv` for the complete deterministic exception-instance oracle and `reference/expected_rule_counts.csv` for exact rule counts.

Examples include:
- unmapped project and unmapped cost code
- duplicate invoice
- commitment overrun
- invoice/PO cost-code mismatch
- approved AP invoice missing from job cost
- approved labor missing from payroll/job cost
- three material RNI cases
- stale PM forecast
- labor burn ahead of progress
- EAC deterioration and margin fade
- material forecast changes with blank explanation
- aging pending COs and costs incurred on unapproved work
- approved CO missing from SOV
- underbilling and SOV mismatches
- a 100%-progress cost code with remaining forecast

## Deliberate negative / contrast controls

See `reference/expected_negative_controls.csv`.

Important cases:
- `PO-0020`: closed and fully invoiced; should have zero remaining commitment and no RNI
- `PC-7791 / 229950`: zero labor budget/hours, no activity; denominator-safe control
- `CO-1003-C`: rejected CO; excluded from revised contract and SOV requirements
- `INV-00109`: pending invoice; excluded from valid invoicing/posting checks
- retainage rows reconcile within tolerance

Additional zero-denominator calculation fixtures live in `reference/edge_case_fixtures.json` rather than polluting the realistic client project set.

## Reference files

- `expected_baseline_project_metrics.csv`: pre-human-adjustment baseline outputs for 2026-06-30 and 2026-07-31
- `expected_seeded_exceptions.csv`: complete expected deterministic exception instances at the current close date
- `expected_rule_counts.csv`: exact expected count by rule
- `expected_negative_controls.csv`: cases that should not trigger selected rules
- `edge_case_fixtures.json`: synthetic calculation-only edge cases
- `client_config.json`: machine-readable dates, thresholds, and overtime multiplier

## Validation

Before application work, run:

`python3 scripts/validate_mock_data.py`

`python3 scripts/validate_reference_metrics.py`

Both should pass before Claude Code starts implementation.

## Warning

This is synthetic workflow data, not a proprietary Sage/Procore export schema and not accounting advice.
