# FIRST CLAUDE CODE PROMPT — BUILD V0

Read:
- `CLAUDE.md`
- `docs/product/MULTI_AGENT_REVIEW_PROTOCOL.md`
- the three files under `.claude/agents/`
- the files listed in `CLAUDE.md` under "Read before major work"

Also inspect all source/reference files under `data/mock/summit_mep/`.

I am a non-technical founder. Build a believable V0, keep the codebase understandable, and explain major decisions in plain English.

## Phase 0 — Validate the starter kit before coding

Run:

```bash
python3 scripts/validate_mock_data.py
python3 scripts/validate_reference_metrics.py
```

Both must pass before feature implementation.

Treat these reference files as the independent mock-data oracle:
- `expected_baseline_project_metrics.csv`
- `expected_seeded_exceptions.csv`
- `expected_rule_counts.csv`
- `expected_negative_controls.csv`
- `edge_case_fixtures.json`

Do not "fix" application code by changing the reference files unless the founder explicitly approves a documented change to the product/data assumptions.

## Mandatory independent reviewer protocol

You are the **Lead Engineer** and sole implementation owner.

Review agents:
- `architecture-reviewer`
- `finance-data-reviewer`
- `qa-reviewer`

They review; they do not own implementation.

### Architecture gate
Before implementing or materially changing the canonical domain model, Client Operating Graph, normalization/reconciliation architecture, or agent/state architecture:

1. Write the proposed design.
2. Invoke `architecture-reviewer`.
3. Fix every BLOCKER/HIGH finding.
4. Reinvoke the reviewer to verify material fixes.
5. Then proceed.

### Finance/data gate
After implementing or materially changing:
- project economics / EAC / draft WIP
- commitments / AP / RNI / unposted adjustments
- labor reconciliation
- forecasts
- change orders
- SOV/billing
- exception rules

invoke `finance-data-reviewer`, fix BLOCKER/HIGH findings, add regression tests, and require independent re-check.

### QA gate
Invoke `qa-reviewer` after:
- canonical data + graph foundation
- each major workstream
- integrated agent/human workflow
- final V0

### Reviewer disagreement
If reviewers materially conflict, or a reviewer recommendation conflicts with documented product/finance logic, explain the disagreement to me before making the disputed major change.

## Phase A — Organize and explain

1. Inspect the current repository.
2. Keep this directory as the repository root; do not create a nested repository.
3. Verify the structure in `docs/product/FOLDER_STRUCTURE.md`.
4. Confirm `CLAUDE.local.md` is gitignored.
5. Create `docs/decisions/BUILD_LOG.md`.
6. Create one typed runtime configuration module from `docs/product/V0_CONFIG.md`.

Before feature coding, show me:
- folder tree
- canonical domain model
- Client Operating Graph object/link types
- the three workstreams
- agent/task state model
- major assumptions

Then run the architecture gate.

## Phase B — Canonical data + Client Operating Graph

Build source loaders and normalization first.

Treat CSVs as exports from different systems.

Canonicalize:
- company/division
- projects
- people/employees/vendors
- cost codes/budget lines
- commitments/receipts/invoices/job-cost transactions
- labor entries
- change orders/SOV/billings
- forecast/progress snapshots
- exceptions/tasks/actions/decisions

Create explicit typed links defined in the domain/graph docs.

Agents and rules operate on the canonical model, not ad-hoc raw CSV joins.

Do not use Neo4j in V0.

## Phase C — Three connected workstreams

Implement:
1. Project Forecast & WIP Close
2. AP & Cost Control
3. Billing & Change Order Readiness

Follow `FINANCIAL_LOGIC_V0.md`, `EXCEPTION_RULES_V0.md`, and the single config.

Non-negotiables:
- deterministic arithmetic
- source-evidence traceability
- adjustment idempotency
- no AP/RNI/labor double counting
- prior-period reconstruction uses prior-date source activity
- PM remaining cost is uncommitted cost
- cost-code overrun uses current budget
- original margin uses original budget
- unresolved mapped-project/unmapped-cost transactions remain in project totals
- pending/non-approved invoices do not reduce commitments
- rejected COs do not increase revised contract
- rule precedence/suppression prevents duplicate tasks
- zero denominators never produce NaN/Infinity

## Phase D — Agentic workflow

Implement:
- Close Orchestrator
- Cost Control Agent
- Forecast Agent
- Billing & Change Order Agent

Each agent has:
- goal
- evidence inspected
- allowed actions
- task creation
- routing
- workflow state
- audit events

Use a clear TypeScript state machine.

Visible loop:

`detect → create task → wait for human → incorporate response → recompute → resolve/escalate`

No live LLM is required. Keep an adapter boundary for later language-model summaries/question drafting/free-text interpretation.

## Phase E — Four primary screens

### Finance Command Center
Portfolio metrics, close readiness, open risk, waiting-on status.

### Project 360
Sections/tabs:
- overview
- forecast/WIP
- AP & cost control
- billing/change orders
- activity

### Work Queue
Filter and resolve agent-created tasks with evidence.

### Client Operating Graph
Project-centered graph with filters and node details/source evidence.

For every exception show:
- what happened
- why it matters
- dollars affected when available
- evidence
- owner
- next action
- blocking status
- current state

## Phase F — Required end-to-end demos

### Demo 1 — Labor deterioration
PM response changes remaining labor/cost assumptions → EAC/margin recompute → material change may create Controller review.

### Demo 2 — Received-not-invoiced equipment
Accountant accepts RNI → adjusted cost-to-date / draft WIP / billing position change.

Do **not** change final EAC/margin solely because known committed cost moved from remaining commitment into cost-to-date.

### Demo 3 — Change-order / billing issue
Blocking CO/SOV issue prevents close-ready status until resolved or explicitly accepted/escalated.

## Testing

Write unit tests for calculations, reconciliation, exception rules, zero-denominator guards, and source validity.

Write integration/workflow tests for:
- agent task creation/routing
- suppression/precedence
- PM response → recomputation
- RNI acceptance without double counting
- AP-unposted adjustment idempotency
- labor-unposted adjustment idempotency
- Controller escalation
- close-ready state
- graph source/link integrity

Use:
- `expected_rule_counts.csv` for exact baseline rule counts
- `expected_seeded_exceptions.csv` for exact positive instances
- `expected_negative_controls.csv` for no-false-positive controls
- `edge_case_fixtures.json` for calculation edge cases

## Completion gate

Before declaring V0 complete:

1. rerun both Python starter-kit validation scripts
2. run all unit/workflow tests
3. run type checking/lint/build
4. invoke all three reviewers independently
5. resolve every BLOCKER/HIGH finding
6. copy `docs/decisions/FINAL_TECHNICAL_REVIEW_TEMPLATE.md` to `docs/decisions/FINAL_TECHNICAL_REVIEW.md`
7. populate it with reviewer verdicts, issues, fixes, remaining MEDIUM/LOW items, assumptions, mocked behavior, and test/build results
8. update `BUILD_LOG.md`
9. tell me exactly what works, what remains mocked, and the five most important browser checks

V0 is not complete while any reviewer has an unresolved BLOCKER or HIGH finding.
