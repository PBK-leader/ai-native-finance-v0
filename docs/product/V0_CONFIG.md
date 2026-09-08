# V0 Configuration

These are prototype defaults for the fictional Summit MEP client.

Use one typed configuration module in code so thresholds and calculation assumptions are not scattered across rules.

## Dates
- close date: `2026-07-31`
- prior comparison date: `2026-06-30`

## Calculation assumptions
- overtime labor-cost multiplier: `1.5×`
- pending/unapproved invoices do **not** reduce commitments or count as posted cost
- rejected change orders do **not** increase revised contract value
- cost-code overrun compares forecast EAC with **current budget**
- original project margin compares original contract value with **original budget**

## Materiality / thresholds
- PM forecast stale: > 21 days
- AP posting lag: > 3 calendar days after approval
- labor posting lag: > 3 calendar days after approved work date
- unmapped cost-code materiality: >= $10,000
- unbudgeted cost activity: >= $10,000
- commitment overrun: >= $10,000
- margin fade: >= 3.0 percentage points
- EAC deterioration: >= $100,000 OR >= 2.5% of revised contract value
- cost-code overrun: > 10% of current cost-code budget
- labor burn ahead of progress: hours-consumed % > cost-code progress % by 10 percentage points
- RNI medium: >= $20,000
- RNI high: >= $75,000
- large pending CO: >= $50,000 and >= 30 days open
- unapproved CO incurred cost: >= $25,000
- approved CO unbilled: >= $25,000 and >= 14 days since approval
- material underbilling: > $100,000 OR > 5% of revised contract value
- SOV reconciliation tolerance: $100
- retainage tolerance: $500
- material PM forecast change requiring explanation: >= $50,000 OR >= 10%
- pending CO cost exposure concentration: >= 10% of current projected profit
- Controller review for forecast change: EAC change >= $100,000 OR margin movement >= 2.0 percentage points
- completed cost code inconsistency: progress >= 99% AND remaining PM forecast >= $10,000

## Denominator guards
Never return `NaN` or `Infinity`.

- if revised contract value = 0, projected/original margin is `null / not applicable`
- if EAC = 0, percent complete is:
  - 0% when adjusted cost-to-date is also 0
  - otherwise flag invalid/inconsistent data and do not divide
- if budgeted labor hours = 0, labor-consumed percentages are `null / not applicable`; do not emit labor-burn exception solely from that ratio
- percentage-change rules with a zero prior value use the dollar threshold only

## PM explanation rule
"Without explanation" means the **current** PM comment is empty or whitespace after trimming.

Placeholder existence is not enough. The mock data intentionally contains only two material current forecast changes with blank comments.

## Important
These are demo rules, not accounting-policy recommendations.

Later they should be customer-configurable and may themselves become policies/nodes in the Client Operating Graph.
