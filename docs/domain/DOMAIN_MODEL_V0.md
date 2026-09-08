# Domain Model V0

> **Implementation note (2026-08-24).** The V0 build deviates from this document in four places, each argued in
> `docs/decisions/V0_TECHNICAL_DESIGN.md` §4.2 and §5.2: `Agent` is an application object rather than a canonical
> entity; `LaborAggregate` is the graph-facing form of `Labor Entry`; `ProgressSnapshot` is added as a first-class
> entity; and `UnmappedSource` is an evidence record rather than an entity. Read the design document alongside
> this one.

## Canonical entities

### Organization
- Company
- Division

### People
- Person
- Employee
- Agent

### Project finance
- Project
- Cost Code
- Budget Line
- Forecast Snapshot

### Procurement/AP
- Vendor
- Commitment
- Material Receipt
- AP Invoice
- Job Cost Transaction

### Labor
- Labor Entry

### Revenue/billing
- Change Order
- SOV Item
- Billing

### Workflow
- Exception
- Task
- Review Decision
- Agent Action

## Important modeling rules

### Source identity
Raw source IDs remain source references. Canonical IDs are separate.

Example:
- canonical project: `P-1002`
- ERP job: `J-23981`
- PM project: `PC-7633`

### Cost-code identity
A canonical project cost code links:
- budget line
- job-cost transactions
- commitment
- invoice
- labor
- PM forecast
- progress

### Forecast snapshots
Forecast is time-varying.

Do not model "the forecast" as one mutable row only.

A Forecast Snapshot needs:
- project
- cost code
- as-of date
- remaining uncommitted cost
- remaining labor hours where relevant
- PM comment
- source/author

### Adjustments
Do not overwrite raw source data when a human accepts a review item.

Store a separate Review Decision / management adjustment in workflow state and recompute the derived view.

### Tasks
Task needs:
- related exception(s)
- assigned role/person
- blocking flag
- status
- requested input/action
- evidence
- created/updated timestamps

## Workflow states

Recommended:
- OPEN
- WAITING_FOR_PM
- WAITING_FOR_ACCOUNTANT
- WAITING_FOR_CONTROLLER
- RESOLVED
- ACCEPTED_RISK

`ACCEPTED_RISK` means a human explicitly chose to proceed without resolving the underlying business issue. Preserve the evidence/audit trail.
