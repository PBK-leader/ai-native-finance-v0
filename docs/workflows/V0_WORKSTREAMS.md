# V0 Workstreams

## 1. Project Forecast & WIP Close

### Goal
Prepare a project financial view for Controller review.

### Inputs
- project master
- budget and budgeted labor hours
- job-cost ledger
- commitments
- AP and receipts
- cumulative labor/time
- prior and current PM forecast snapshots
- cost-code progress
- change orders
- SOV/billings

### Agent flow
1. Build current project financial picture.
2. Compare current vs prior forecast.
3. Compare labor-hours burn vs cost-code progress.
4. Identify missing/stale assumptions.
5. Ask PM only for information that cannot be inferred from systems.
6. Incorporate PM response into a proposed forecast.
7. Recalculate EAC/margin/WIP.
8. Route material changes to Controller.

### Output
- current EAC and margin
- prior-vs-current movement
- cost-code drivers
- labor risk
- draft WIP/billing position
- unresolved forecast tasks
- close-ready status

---

## 2. AP & Cost Control

### Goal
Find costs that are duplicated, miscoded, unposted, received-but-not-invoiced or otherwise not represented correctly in project economics.

### Inputs
- AP invoices
- commitments
- material receipts
- job-cost transactions
- cost-code/budget master
- labor entries

### Agent flow
1. Match invoice → commitment.
2. Match invoice → job-cost posting.
3. Detect probable duplicates first.
4. Detect commitment overrun using cumulative approved non-duplicate invoices.
5. Detect cost-code mismatch.
6. Detect RNI from receipts minus invoiced amounts.
7. Detect approved AP not posted after lag.
8. Detect approved labor not posted after lag.
9. Route to Project Accountant.
10. Incorporate accepted adjustments and rerun downstream analysis.

### Important double-counting rule
Different adjustments affect EAC differently:
- RNI/cutoff adjustment moves known committed cost into cost-to-date and normally does not change EAC if the full commitment was already included.
- AP-approved-but-not-posted adjustment adds missing cost-to-date but does not reduce remaining commitment again if the commitment's invoiced amount already included that invoice.
- Unposted labor adjustment adds missing cost-to-date and can increase EAC unless the PM forecast is explicitly changed to offset it.

---

## 3. Billing & Change Order Readiness

### Goal
Find contract/billing gaps and commercially risky change work.

### Inputs
- original contract
- approved/pending COs
- approval dates
- SOV
- billings
- draft earned revenue
- project forecast
- incurred CO cost

### Agent flow
1. Reconcile revised contract to SOV.
2. Detect approved CO missing from SOV.
3. Detect approved CO remaining unbilled after threshold.
4. Detect aging pending COs.
5. Detect material cost incurred on pending/unapproved CO.
6. Detect material underbilling.
7. Route factual/commercial questions to PM.
8. Route billing/data issues to Project Accountant.
9. Escalate material judgment to Controller.

### Output
- SOV reconciliation
- approved-but-unbilled exposure
- pending CO exposure
- underbilling
- blocking tasks
