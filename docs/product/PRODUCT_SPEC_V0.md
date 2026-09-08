# Product Spec V0

## Product in one sentence

A prototype AI + human finance-operations layer for commercial specialty contractors that reconciles fragmented project/accounting data, finds financially meaningful exceptions, gathers missing human inputs, and prepares work for Controller review.

## What V0 must prove

1. We can normalize realistic multi-system contractor data.
2. We can find cross-system issues that a simple accounting dashboard misses.
3. We can coordinate human follow-up through an agentic workflow.
4. A human decision can change downstream finance outputs.
5. Three finance workstreams can share one canonical operating model.
6. The Client Operating Graph is useful context, not decoration.

## Workstreams

1. Project Forecast & WIP Close
2. AP & Cost Control
3. Billing & Change Order Readiness

## Primary users

### Controller / CFO
Wants trustworthy project economics, fewer spreadsheets, fewer low-value review tasks, and early warnings.

### Project Manager
Wants a few specific questions rather than a finance spreadsheet.

### Project Accountant
Wants prioritized exceptions, source evidence and a clear next action.

## Core demo paths

### Demo A: Labor forecast deterioration
- Forecast Agent detects labor burn ahead of cost-code progress.
- PM gets a targeted remaining-labor question.
- PM updates remaining labor/cost and adds a comment.
- Proposed EAC and margin recalculate.
- Material change routes to Controller.

### Demo B: Received-not-invoiced equipment
- Cost Control Agent links receipt(s), PO and AP invoice(s).
- It identifies an RNI/cutoff candidate.
- Project Accountant accepts or rejects the proposed cutoff adjustment.
- Accepted RNI moves cost from remaining commitment into adjusted cost-to-date.
- EAC/final margin should normally remain unchanged if the full commitment was already included.
- Draft percent complete, earned revenue/WIP and billing position can change.
- Activity log shows the full chain.

### Demo C: Change-order / billing risk
- Billing Agent finds either an approved CO absent from the SOV or a large pending CO with incurred cost.
- Task routes to the appropriate human.
- Project remains not close-ready while a blocking issue is unresolved.

## Main V0 screens

Keep the V0 to four primary screens.

### 1. Finance Command Center
Show portfolio status:
- close readiness
- projected profit
- margin movement
- underbilling
- pending CO exposure
- RNI/cutoff candidates
- high-severity tasks
- who the system is waiting on

### 2. Project 360
Tabs/sections:
- Overview
- Forecast/WIP
- AP & Cost Control
- Billing & Change Orders
- Activity

Show:
- contract and COs
- budget / posted cost / adjustments / commitments / PM remaining uncommitted cost / EAC
- prior vs current forecast
- labor indicators
- SOV/billing
- exceptions/tasks
- audit trail

PM/accountant/controller actions can occur inside role-specific panels on this page.

### 3. Work Queue
Filter by:
- assigned role/person
- workstream
- severity
- project
- status

Every task shows evidence, proposed action, blocking status and activity.

### 4. Client Operating Graph
Project-centered graph explorer with object filters and a details panel.

## Agentic loop

`Observe → Detect → Create task → Route → Human response → Incorporate → Recalculate → Resolve or escalate`

The loop must be visible in the UI and audit log.

## Design principle

A dashboard is not enough.

Every important issue should answer:
1. What happened?
2. Why does it matter?
3. What source records support it?
4. How much is potentially affected?
5. Who should act?
6. What should they do?
7. Is it blocking close?
8. What changes after resolution?

## Out of scope

V0 does not prove:
- live ERP integration
- production security
- autonomous accounting
- automated journal posting
- production-grade GAAP WIP
- live communications
- full ERP replacement
- full outsourced finance operation

It should be good enough for serious customer interviews and workflow validation.
