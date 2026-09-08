# CLAUDE.md

## Project
We are building V0 of an AI-native managed finance product for U.S. commercial specialty contractors, initially electrical and mechanical/HVAC/plumbing contractors.

The long-term company vision is to run much of the accounting and finance operation beneath the customer's CFO using software agents, India-based finance operators, and controller-level human review.

V0 is a prototype. It must demonstrate believable workflow depth without pretending to be production accounting software.

## Read before major work
For the initial build, read:
- `docs/vision/VISION.md`
- `docs/vision/CLIENT_OPERATING_GRAPH.md`
- `docs/product/PRODUCT_SPEC_V0.md`
- `docs/domain/DOMAIN_MODEL_V0.md`
- `docs/workflows/V0_WORKSTREAMS.md`
- `docs/workflows/FINANCIAL_LOGIC_V0.md`
- `docs/workflows/EXCEPTION_RULES_V0.md`
- `docs/product/V0_CONFIG.md`
- `docs/decisions/ASSUMPTIONS.md`
- `data/mock/summit_mep/DATA_DICTIONARY.md`

When changing a specific area later, reread the relevant document rather than relying on memory.

## Starter-kit validation
Before implementation and again before final completion, run:
- `python3 scripts/validate_mock_data.py`
- `python3 scripts/validate_reference_metrics.py`

Both must pass.

The reference exception/count/negative-control files are an exact V0 oracle for the supplied mock data. Do not silently modify them to make application tests pass.

## V0 workstreams
V0 demonstrates three connected workstreams:
1. Project Forecast & WIP Close
2. AP & Cost Control
3. Billing & Change Order Readiness

A resolved issue in one workstream should be able to change downstream analysis in another.

## Foundational architecture
Normalize raw source exports into a canonical domain model.

Build a Client Operating Graph using explicit typed objects, links, source references, tasks, decisions, and agent actions.

The graph is an operating context, not merely a visualization.

Do not use a dedicated graph database in V0. Use normal TypeScript domain objects and explicit link structures.

Agents and exception rules should operate on the canonical model, not independently rejoin raw CSV files.

## What makes V0 agentic
Agents must follow an explicit loop:

`observe → detect → create evidence-backed task → route → wait for human → incorporate response → rerun affected analysis → resolve or escalate`

V0 agents:
- Close Orchestrator
- Cost Control Agent
- Forecast Agent
- Billing & Change Order Agent

Agent decisions may be deterministic in V0.

Do not build fake chatbots just to look agentic.

## Human authority
Project Manager owns operational facts and forward-looking project assumptions.

Project Accountant owns routine investigation, reconciliation, cutoff preparation, and data-quality resolution.

Controller owns material accounting judgment and final close review.

CFO consumes portfolio-level insight and makes management decisions.

No autonomous accounting sign-off.

## Financial safety rules
- Financial arithmetic must be deterministic code.
- Never use an LLM for arithmetic.
- Never claim the prototype is GAAP-compliant.
- Never post journal entries.
- Never make irreversible accounting changes.
- Treat WIP/revenue calculations as draft management analysis for V0.
- Keep source evidence and human decisions auditable.
- Prevent double counting between posted cost, AP-not-posted adjustments, RNI/cutoff adjustments, commitments, and PM remaining uncommitted cost.
- Follow `docs/workflows/FINANCIAL_LOGIC_V0.md`.

## Technical defaults
Use:
- Next.js
- TypeScript
- Tailwind
- local mock source files
- deterministic calculation/reconciliation modules
- explicit workflow state machine
- lightweight tests

Keep dependencies minimal.

Do not add yet:
- live ERP integrations
- database
- Supabase
- n8n
- authentication
- payment execution
- live payroll
- bank access
- production deployment architecture
- large agent frameworks

## Repository boundaries
Keep separate modules for:
- source loading
- canonical domain objects
- graph
- calculations
- reconciliation
- exception rules
- agents
- workflow/task state
- configuration
- UI

Do not bury financial logic in React components.

Do not create a nested Git repository.

## Evidence rule
Every exception must show:
- what happened
- why it matters
- dollar/operational impact where available
- source records
- rule triggered
- recommended next action
- assigned role
- current status


## Independent review gates
The main Claude session is the Lead Engineer and implementation owner.

Use project subagents in `.claude/agents/` as independent reviewers:
- `architecture-reviewer`
- `finance-data-reviewer`
- `qa-reviewer`

Read and follow `docs/product/MULTI_AGENT_REVIEW_PROTOCOL.md`.

Reviewers do not own implementation. The Lead Engineer fixes findings and asks the reviewer to re-check.

Do not declare V0 complete with an unresolved BLOCKER or HIGH reviewer finding.

If reviewers materially disagree, explain the conflict to the founder before making the disputed major architectural/product change.

## Testing
Before declaring work complete:
1. Run unit tests.
2. Run workflow/integration tests.
3. Run production build.
4. Fix failures.
5. Compare exact positive instances, rule counts, negative controls, and edge fixtures against reference data.
6. Explain remaining assumptions and mocked behavior.

Tests must cover:
- financial math
- cross-source reconciliation
- exception rules
- agent routing/state
- human response → recalculation
- close-ready status

## Working style
For meaningful changes:
1. Explain the customer problem being solved.
2. State the intended change.
3. Implement it.
4. Test it.
5. Explain the result in plain English.

If accounting meaning is unclear, do not invent policy. Record the assumption in `docs/decisions/ASSUMPTIONS.md`.
