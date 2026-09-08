# External Review Resolution

This document records how the final starter kit addressed the external review of the prior package.

## Overall assessment

The review's central conclusion was correct: the prior financial tie-outs were internally clean, but several synthetic-data and test-oracle issues would have made the V0 less credible and could have confused Claude Code's reviewers.

The final package therefore preserves the core finance model while improving data plausibility, rule configuration, test-oracle completeness, and documentation consistency.

## Resolution by review item

| # | Review finding | Decision | Final action |
|---|---|---|---|
| 1 | Labor rows physically impossible | Correct, critical | Regenerated labor as individual employee/day/cost-code rows; max 8 regular + 4 OT, max 12 employee-day; expanded employee master; labor runs through close date. |
| 2 | CO approved before submitted | Correct, critical | Corrected dates and recomputed `days_open`; validation script fails on approval-before-submission. |
| 3 | Seeded exception oracle incomplete | Correct, critical | `expected_seeded_exceptions.csv` is now a complete deterministic positive-instance oracle; added exact `expected_rule_counts.csv`, negative controls, and edge fixtures. |
| 4 | Overtime multiplier undocumented | Correct, critical | Documented `1.5×` in config, financial logic, data dictionary, and machine-readable config. |
| 5 | Missing thresholds | Correct, critical | Added explicit thresholds for commitment overrun, unmapped cost code, unbudgeted cost, plus completed-code forecast consistency. |
| 6 | Forecast-change-without-explanation too noisy | Correct, critical | Defined missing explanation as blank/whitespace; gave material forecast changes narratives except exactly two seeded blanks. |
| 7 | Unmapped vs unbudgeted duplicate exception | Correct | Added precedence: unmapped-code exception suppresses unbudgeted-cost until mapping resolves. |
| 8 | `cost_type=AP` mixes source and economic type | Correct | Reclassified job-cost rows to economic cost types; `AP` remains only as `source_type`. |
| 9 | Baseline name/meaning ambiguity | Correct | Added `metric_stage=pre_human_adjustments`; documented baseline semantics explicitly. |
| 10 | P-1004 budget increase unexplained / budget basis unclear | Correct | Moved the revision to a semantically aligned cost code, added revision reason + linked CO, and defined current-budget vs original-budget use. |
| 11 | Billing positions looked back-solved / implausible | Correct | Rebuilt billing history with less extreme prior positions, non-round positions, and more credible July billing volumes. |
| 12 | INV-00090 sits on posting-lag boundary | Correct | Moved approval to 2026-07-29 and broadened precedence: unresolved over-commitment suppresses missing-posting regardless of age. |
| 13 | Missing contrast cases | Correct | Added closed/full-invoiced PO, zero-labor-budget code, 100%-progress remaining-forecast case, rejected CO, pending invoice, negative-control oracle, and calculation edge fixtures. |
| 14 | Labor stops before close date | Correct | Labor data now runs through 2026-07-31. |
| 15 | Three inconsistent folder names | Correct | Standardized documented repository root to `mep-finance-v0`; final zip contains that root. |
| 16 | Folder doc lists files/folders absent | Correct | Added root README, research folder, customer-discovery folder, and validation scripts; tree/doc now agree. |
| 17 | Audit gives stale CLAUDE.md line count | Correct hygiene issue | Removed fragile exact line-count claim. |
| 18 | Final-review template not wired | Correct | Completion gate now explicitly copies/populates the template. |
| 19 | CLAUDE.local ships in zip despite gitignore | Not a product defect; privacy risk | Kept it because this is the founder's personal starter kit, but marked it PRIVATE and added remove-before-sharing warnings. |
| 20 | V-P02 orphan vendor | Correct hygiene issue | Assigned V-P02 to a real plumbing equipment commitment/invoices. |
| 21 | Zero-denominator behavior unspecified | Correct | Added explicit denominator guards and dedicated `edge_case_fixtures.json`. |

## Additional final safeguards

Two standard-library validation scripts now run before coding:
- `scripts/validate_mock_data.py`
- `scripts/validate_reference_metrics.py`

The first checks physical/temporal/data integrity.
The second independently recomputes baseline metrics from raw CSVs without importing application code.

Both must pass before implementation and before final V0 completion.
