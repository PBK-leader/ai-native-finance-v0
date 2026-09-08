# Summit MEP — AI-Native Managed Finance (V0 prototype)

A prototype of an AI + human finance-operations layer for U.S. commercial specialty contractors. It normalizes
fragmented project and accounting data, finds financially meaningful exceptions, gathers the specific human
inputs it cannot infer, and prepares work for Controller review.

**This is a prototype on fictional data.** It produces draft management analysis, not GAAP-compliant
accounting. It posts no journal entries and makes no autonomous accounting decisions.

## Running it

```bash
npm install
npm run dev
```

Then open http://localhost:3000.

```bash
npm run check     # validators + typecheck + lint + tests + production build
```

## The five-minute tour

1. **Command Center** — six live projects, two ready to close, 19 items blocking the rest.
2. Hit **Run a demo → Approved change order missing from the SOV**. Open Central University Science Lab,
   Billing tab: the schedule of values now reconciles, and a previously hidden $420,000 of unbilled approved
   work has surfaced.
3. **Run a demo → Labour deterioration**. Open Riverside Office Tower: forecast cost is up $125,000, margin is
   down, and the Work Queue now holds a Controller review that did not exist before.
4. **Activity tab** on either project — the full chain from what the agent observed to what changed.
5. **Reset** returns everything to the baseline.

## How it is put together

The load-bearing idea: **nothing derived is ever mutated.** There are exactly two pieces of state — the frozen
canonical model built from the source files, and an append-only ledger of human decisions. Every financial
number, exception, task and close-readiness flag is recomputed from those two by one pure function.

That makes several properties structural rather than things the code has to remember:

- Accepting the same adjustment twice cannot double-count it.
- No screen can show a stale number, because there is no cached number to invalidate.
- The audit trail *is* the state, replayed — it cannot drift from what actually happened.
- Every demo is just a list of decisions, so the tests assert exactly what a customer sees.

```
src/config          one typed runtime configuration
src/data/raw        CSV parsing and typed raw rows
src/domain          canonical entities, ids, money/dates, workflow types
src/graph/core      graph indexing and traversal
src/data/normalize  raw rows → frozen canonical model
src/reconciliation  the only module that matches records across systems
src/calculations    deterministic finance maths
src/graph/build     graph projection
src/exceptions      24 rules + suppression precedence
src/agents          four agents
src/workflows       decision ledger, eligibility, replay engine
src/components      presentation only — no arithmetic
src/app             routes
```

## Documentation

| Document | What it covers |
|---|---|
| `docs/decisions/V0_TECHNICAL_DESIGN.md` | The architecture and why each decision was made |
| `docs/decisions/BUILD_LOG.md` | What was built, in order, and what went wrong on the way |
| `docs/decisions/ASSUMPTIONS.md` | Accounting interpretations that need expert validation |
| `docs/decisions/FINAL_TECHNICAL_REVIEW.md` | Independent reviewer verdicts |
| `docs/workflows/FINANCIAL_LOGIC_V0.md` | The financial formulas |
| `docs/workflows/EXCEPTION_RULES_V0.md` | The 24 exception rules |

## Testing

345 tests. The important ones tie to a reference oracle produced independently of this codebase:

| Check | Coverage |
|---|---|
| Baseline project metrics | 12 project/date rows × 11 fields, both dates, within $0.02 |
| Exact rule counts | all 24 rules |
| Seeded exception instances | all 59 — rule, project, source record, owner, blocking flag |
| Negative controls | all 6 — no false positives |
| Edge cases | all 5 zero-denominator fixtures |
| Workflow | 36, including the three required demos end to end |
| Architecture invariants | layering, purity, no arithmetic in the UI |

The reference files under `data/mock/summit_mep/reference/` are a read-only oracle. When the application and
the oracle disagree, the application is wrong.
