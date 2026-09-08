# Multi-Agent Technical Review Protocol

## Purpose

The main Claude Code session is the **Lead Engineer and sole implementation owner**.

Three project subagents act as independent reviewers:

```text
Lead Engineer
├── architecture-reviewer
├── finance-data-reviewer
└── qa-reviewer
```

The goal is independent challenge, not parallel code generation.

Reviewers should find problems.
The Lead Engineer should make the fixes.

## Why reviewers are read-only

Multiple agents editing the same implementation can:
- create conflicting architecture
- hide who owns a decision
- introduce regressions
- make the main session understand less of the code it is managing

Therefore:
- architecture reviewer is read-only
- finance/data reviewer is read-only
- QA reviewer is read-only at the file level and may use Bash only for non-mutating verification

## Review gates

### Gate 1 — Architecture before major implementation

Invoke `architecture-reviewer` before implementing or substantially changing:
- canonical domain model
- Client Operating Graph
- normalization architecture
- reconciliation architecture
- agent/state model
- cross-workstream recomputation design
- major repository structure

Resolve all BLOCKER and HIGH findings before continuing.

### Gate 2 — Finance/data after financial logic

Invoke `finance-data-reviewer` after implementing or materially changing:
- EAC / project economics
- WIP management calculations
- commitments
- AP reconciliation
- RNI/cutoff
- AP-unposted adjustments
- labor reconciliation
- PM forecast logic
- change orders
- SOV/billing
- exception rules
- seeded scenario logic

Resolve all BLOCKER and HIGH findings.

### Gate 3 — QA after each major workstream

Invoke `qa-reviewer` after completing:
1. canonical data + graph foundation
2. Project Forecast & WIP workstream
3. AP & Cost Control workstream
4. Billing & Change Order workstream
5. integrated agent/human workflow
6. final V0

The QA reviewer should run available tests/build/type checks and attack edge cases.

## Correction loop

When a reviewer identifies a BLOCKER or HIGH issue:

1. Lead Engineer explains the issue in plain English.
2. Lead Engineer fixes it.
3. Lead Engineer adds or improves a regression test where practical.
4. The same reviewer re-checks the corrected implementation.
5. Repeat until the BLOCKER/HIGH issue is independently cleared.

Do not accept:
> "I fixed it."

Require independent re-review.

## Reviewer disagreements

Reviewers are advisory, not infallible.

If:
- two reviewers recommend conflicting architectural changes, or
- a reviewer recommendation conflicts with documented product/accounting assumptions,

the Lead Engineer must:

1. stop before making the disputed major change
2. explain the disagreement to the founder in plain English
3. identify the tradeoff
4. recommend one path
5. wait for founder direction if the choice materially changes architecture or product behavior

Do not resolve meaningful reviewer disagreement silently.

## Final cross-review

Before V0 is declared complete:

1. rerun `python3 scripts/validate_mock_data.py`
2. rerun `python3 scripts/validate_reference_metrics.py`
3. invoke all three reviewers independently
4. copy `docs/decisions/FINAL_TECHNICAL_REVIEW_TEMPLATE.md` to `docs/decisions/FINAL_TECHNICAL_REVIEW.md` and populate it

It must contain:

- architecture reviewer verdict
- finance/data reviewer verdict
- QA reviewer verdict
- BLOCKER/HIGH issues found during the build
- corrections made
- remaining MEDIUM/LOW issues
- unresolved assumptions
- known mocked behavior
- known limitations
- tests/build results

V0 cannot be declared complete with an unresolved BLOCKER or HIGH finding from any reviewer.

## Important limitation

Three AI reviewers agreeing does not prove financial or technical correctness.

The stronger safeguards are:
- deterministic financial functions
- independent reference outputs
- seeded mock anomalies
- invariants
- regression tests
- traceable source evidence
- explicit human approval boundaries
- later validation with real contractor finance experts
