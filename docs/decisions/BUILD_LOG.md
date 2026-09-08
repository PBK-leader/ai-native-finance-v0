# Build Log

Running record of what was built, in what order, and why. Newest entries at the bottom.

---

## 2026-08-24 — Phase 0: starter-kit validation

Ran both required validation scripts before writing any application code.

```
python3 scripts/validate_mock_data.py       -> MOCK DATA VALIDATION: PASS
python3 scripts/validate_reference_metrics.py -> REFERENCE METRIC VALIDATION: PASS
```

Then independently re-derived the seeded exception oracle from the raw CSVs in throwaway Python, to be sure
the application would be built against a correctly understood target rather than a guessed one. Every count in
`expected_rule_counts.csv` was reproduced:

| Check | Result |
|---|---|
| Duplicate invoice | `INV-00089` (`V-E03` / `V-E03-00001`, later invoice date than `INV-00001`) — 1 |
| Commitment overrun | `PO-0023` over by `$35,000` via `INV-00090` — 1 |
| RNI gaps ≥ `$20,000` | `PO-0004 $120,000`, `PO-0010 $230,000`, `PO-0032 $155,000` — 3 |
| Approved-unposted invoices | `INV-00064`, `INV-00089` (duplicate → suppressed), `INV-00090` (overrun → suppressed) → 1 exception |
| Unposted approved labor | 40 rows, `PC-7480 / 260200`, `$17,752`, 2026-07-24→27 → 1 grouped exception |
| Unmapped cost code | `JC-00388` / `239777` on `P-1005`, `$38,500` — 1 |
| Cost-code overruns > 10% of current budget | 20, matching the seeded list cost code for cost code |
| Labor burn | `P-1001 260200` (65.0% vs 52%), `P-1001 260400` (62.5% vs 50%) — 2 |
| SOV mismatch | `P-1002 −$85,000`, `P-1004 −$420,000` — 2 |
| Margin fade | `P-1001` only: 18.00% original → 11.86% projected = 6.14pp — 1 |
| EAC deterioration | `P-1001 +$527,908`, `P-1002 +$471,515`, `P-1004 +$368,723` — 3 |
| Profit-risk concentration | pending-CO **incurred cost** vs projected profit: `P-1002 15.1%`, `P-1004 12.7%` — 2 |

Two interpretation questions were settled by this exercise rather than by guessing:

1. `FC_PROFIT_RISK_CONCENTRATION` measures pending-CO **cost incurred to date**, not requested CO value.
   Using requested value produces 4 instances, not the 2 the oracle requires.
2. `FC_MARGIN_FADE` original margin uses `erp/projects.csv:original_budget_cost`, which in this data set equals
   the sum of the original cost-code budgets.

---

## 2026-08-24 — Phase A: organize, configure, design

**Repository.** Kept the existing directory as the root. Verified the layout matches
`docs/product/FOLDER_STRUCTURE.md`; the `src/` and `tests/` subfolders already existed as placeholders.
No nested Git repository created. The directory is currently not a Git repository at all — noted for the
founder rather than acted on, since initializing version control is their call.

**`.gitignore`.** Confirmed `CLAUDE.local.md` is ignored. Added `out/` and `*.tsbuildinfo`.

**Toolchain.** Next.js 15 (App Router) + TypeScript (strict, `noUncheckedIndexedAccess`) + Tailwind 4 + Vitest.
No database, no state library, no agent framework, no graph database.

- Next.js was installed at `15.5.4`, which npm flagged for CVE-2025-66478, and immediately upgraded to the
  patched `15.5.23` backport. Staying on the 15 line avoids a Next 16 migration inside V0.
- Three remaining `npm audit` highs are all in `sharp`, an optional transitive image-optimization dependency of
  Next that this prototype never invokes (no `next/image` usage). Recorded, not force-upgraded.

**Configuration module.** `src/config/v0Config.ts` is the one typed runtime configuration, transcribed from
`docs/product/V0_CONFIG.md`. A unit test will assert it agrees with
`data/mock/summit_mep/reference/client_config.json` so the two cannot drift.

**Design.** Wrote `docs/decisions/V0_TECHNICAL_DESIGN.md` and submitted it to the architecture gate.
The central decision is a **derived-state architecture**: the only mutable state is an append-only
decision ledger, and everything financial is recomputed by a pure `replay(model, config, ledger)` function.
This makes adjustment idempotency, audit trail integrity and "no stale numbers" structural rather than
something the code has to remember to do.

---

## 2026-08-25 — Gate 1 cleared after four rounds

The architecture gate took four passes. Findings raised and resolved: **1 BLOCKER, 8 HIGH, 12 MEDIUM, 13 LOW**.
Final verdict: **PASS WITH ISSUES**, no unresolved BLOCKER or HIGH.

The four that mattered most, in plain terms:

| Round | Finding | Why it would have hurt |
|---|---|---|
| r1 | Reconciled relationships would have existed twice — as fields on entities *and* as graph links | The EAC maths and the graph explorer could disagree about which invoices count. Fixed by banning counterparty ids from entities entirely. |
| r2 | An accountant's SOV correction could never reach the code that needed it | Demo 3 would have marked its task resolved while the blocking exception kept firing. |
| r2 | The overlay forecast snapshot had no business date rule | Demo 1 would have silently recomputed nothing — the PM's answer would have been dated after the close and filtered out. |
| r3 | A type-placement cycle inside `src/domain` | Would have been baked into the first module written. |

`docs/decisions/V0_TECHNICAL_DESIGN.md` §14 is the full finding-to-fix log; §15 lists the commitments carried
into implementation.

---

## 2026-08-25 — Phases B, C and D: engine complete and tied to the oracle

**325 tests passing.** The financial core is verified against the independent reference oracle:

| Check | Result |
|---|---|
| Baseline project metrics | 12 project/date rows × 11 fields, both dates, within `$0.02` |
| Exact rule counts | all 24 rules |
| Seeded exception instances | all 59, matched on rule + project + source record + owner + blocking |
| Negative controls | all 6 |
| Workflow / demo tests | 36, including all three required demos |

### What was built

- `src/domain` — canonical entities, branded ids, money/date helpers, the pure task-status reducer, and every
  shared type declaration (split by concern, not one `types.ts`).
- `src/data/normalize` — raw rows to a deeply frozen canonical model. Labour is pre-aggregated from 22,593
  time entries into per-cost-code buckets so the replay loop stays cheap.
- `src/reconciliation` — the only module that reads counterparty keys; emits them as graph links behind one
  `ReconciledView`.
- `src/calculations` — contract, cost, EAC, margin, draft WIP, all denominator-guarded.
- `src/exceptions` — 24 rules in five workstream files plus the suppression pass.
- `src/agents` — four agents with goals, declared evidence scope, and enforced action sets.
- `src/workflows` — decision projection, eligibility, and the `replay` engine.

### Three problems found by tests rather than by review

1. **`CO_APPROVED_UNBILLED` never detected change orders missing from the SOV**, so the documented suppression
   rule was dead code. Now detected then suppressed, which is what makes the Demo 3 cascade work.
2. **Stale-forecast and unposted-labour exceptions never cited their PM-system project key.** A project
   accountant searching Procore for `PC-7480` would have found nothing. Evidence widened.
3. **Every decision was being judged against a state that already included its own effect**, so the first SOV
   correction rejected itself as "already applied" and silently dropped. The replay loop now evaluates each
   decision once, against the state immediately before it.

The third was the significant one: it was silent, and it broke a demo without failing anything obvious.

---

## 2026-08-25 — Phase E: the four screens

Next.js App Router, server components reading the engine, small client components posting decisions.

| Route | Screen |
|---|---|
| `/` | Finance Command Center — portfolio, close readiness, waiting-on, cutoff candidates |
| `/projects/[id]` | Project 360 — Overview, Forecast & WIP, AP & Cost Control, Billing & COs, Activity |
| `/work-queue` | Work Queue — filters as URL params so a filtered queue is a shareable link |
| `/graph` | Client Operating Graph — project-centred, depth-limited, click-through node inspector |

**Persona switcher.** The workflow genuinely enforces role authority — only a Controller can accept a risk —
so the shell carries an explicit demo persona resolved from `master_data/people.csv`. Labelled in the UI as a
demo affordance, not authentication.

**Verified running, not just building.** The dev server was exercised over HTTP end to end:

- Command Center shows $37.3M contract, 2 of 6 projects close-ready, 59 open items, 19 blocking.
- Demo 3 through the live API: SOV moved from `($420,000) variance` to **Reconciles**, the change order flipped
  to "On SOV: Yes", and the activity trail showed detect → open → route → human decision → two clears.
- Demo 1 through the live API: EAC $4.54M → $4.66M, margin 11.9% → 9.4%, and a Controller review task appeared
  with `EAC before / EAC after / movement $125,000 / margin movement 2.43 pts` as evidence.
- `POST /api/reset` returned the portfolio exactly to 59 open / 19 blocking.

## 2026-08-25 — Enforcement tests for the architecture invariants

The design committed to three invariants that were documented but not enforced. Comments are not controls, so
they are now tests (`tests/unit/architecture.test.ts`):

1. No reconciled counterparty id outside the data and reconciliation layers — checked in **both** the raw
   snake_case form and the canonical camelCase form, because the camelCase form is what the original design
   defect actually took and a raw-column grep would have missed it entirely.
2. No wall-clock reads below `src/app`, and no mutation of the frozen model.
3. No financial arithmetic in components or routes.
4. No module imports from a higher layer.

**It caught a real violation on its first run.** `src/graph/build/buildGraph.ts` (layer 8) was importing
`AGENTS` and the `Snapshot` type from `src/agents` (layer 10) — an upward import, and precisely the L-1
commitment from the Gate 1 review that I had skipped. Fixed by declaring `Snapshot`, `CloseReadiness` and a
new `AgentDescriptor` in `src/domain/engine.ts` and passing agent descriptors into the graph projection
instead of importing them.

Also added `tests/unit/edgeCases.test.ts` covering all five `edge_case_fixtures.json` cases plus guard
behaviour for non-finite inputs and over-100% completion.

**345 tests passing.** Typecheck, lint and production build all clean.

---

## 2026-08-25 — Completion gate: three independent reviews and the corrections they forced

All three reviewers ran against the finished build. **403 tests now pass** (up from 345), and every
BLOCKER and HIGH finding is fixed with a regression test.

### Verdicts

| Reviewer | Verdict | Findings |
|---|---|---|
| Architecture | **PASS** | 1 HIGH, 6 MEDIUM, 7 LOW — HIGH and all but three LOWs fixed |
| Finance / data | **PASS WITH ISSUES** | 0 BLOCKER, 0 HIGH, 6 MEDIUM, 5 LOW — all six MEDIUMs fixed. **Double-counting verdict: CLEAN** |
| QA (adversarial) | **PASS WITH ISSUES** | 2 BLOCKER, 2 HIGH, 7 MEDIUM — all BLOCKERs and HIGHs fixed and independently re-verified |

### The finding that mattered most

QA found that **a material forecast change could reach close-ready with no Controller approval.** The
escalation task appeared correctly, then silently vanished on the *next* decision — any decision, on any
project — after which the project reported itself ready to close with the elevated forecast intact, and the
escalation was permanently un-actionable through the API.

Root cause: tasks are rebuilt from scratch on every replay step. A rule-derived exception re-detects itself
because the underlying source fact is still there. A Controller review has no rule behind it — it exists
because of one specific past decision — so nothing re-created it. Fixed by carrying it forward on every pass
and letting the resolution index decide its status.

This is the product's single strongest claim ("no material change reaches the books without a Controller
looking at it"), and it was broken in a way that produced no error, no failing test, and a plausible-looking
screen. It took an adversarial reviewer appending an unrelated decision to find it.

### The other three that produced wrong numbers silently

1. **String amounts corrupted the arithmetic.** Posting `amount: "120000"` — an ordinary client mistake — was
   accepted, every `+=` downstream became string concatenation, and the project reported a 43.4% margin that
   was simply wrong. Now rejected at the HTTP boundary and, independently, on the replay path.
2. **A `NaN` forecast value silenced the two rules that watch the forecast.** Every comparison against `NaN`
   is false, so corrupting the forecast was also the way to switch off margin fade and EAC deterioration.
3. **Labour hours returned a fabricated `0`** for any as-of date other than the two configured ones, which
   would have reported "0% of hours consumed against 52% progress". Now returns `null`, and the rule skips.

### What was added rather than merely fixed

- `tests/integration/hardening.test.ts` — 20 regression tests, one per reviewer finding.
- `tests/integration/properties.test.ts` — **200 randomly generated hostile ledgers** asserting four
  invariants: replay never throws, every metric stays a finite number, close readiness is never true while
  blocking work is unsettled, and replay is deterministic. This is the test that looks for the *next* defect
  rather than the last one; the reviewer's own fuzzing is what found two of the HIGHs.
- `tests/unit/architecture.test.ts` — the layering test was tightened from "must import downward" to encoding
  the actual grant table, which immediately found four real violations including one in the calculation layer.
- `src/app/api/validateBody.ts` — runtime narrowing of untrusted JSON at the decision boundary.
- `src/calculations/portfolio.ts` — portfolio roll-ups moved out of page components, which surfaced a unit bug
  (days and percentage points being added to dollars) that only became visible once the arithmetic left the view.

### Final verification, dev server stopped

```
python3 scripts/validate_mock_data.py        PASS
python3 scripts/validate_reference_metrics.py PASS
npx tsc --noEmit                              clean
npm run lint                                  no warnings or errors
npx vitest run                                403 passing, 10 files
npm run build                                 succeeds, 8 routes
```

---

## 2026-08-25 — Guided demo mode, after founder feedback

**Feedback:** "I don't feel it's very intuitive and understand to do demo of this platform."

Fair, and a real product gap rather than a misunderstanding. The original "Run a demo" control loaded a
scenario silently and left you on whatever screen you were already on. Nothing said what had changed, where to
look, or what to say. It only worked for someone who already knew the construction-finance workflow and had
built the thing — which is the opposite of what a demo tool is for.

### What was added

**A guided walkthrough** (`src/workflows/demoScript.ts`, `src/components/DemoGuide.tsx`) — nine narrated
steps that drive the product themselves. Each step:

- loads the ledger state that beat of the story needs,
- navigates to the right screen,
- gives **what to say** as speech rather than documentation,
- gives **point at this** — the two or three things on screen that just changed,
- gives **why it matters** — the commercial "so what".

It lives in the app shell so it survives navigation, keeps its position in `localStorage`, has a progress rail
you can jump around in, minimises to a pill, and resets the ledger on exit.

The story it tells: six jobs and nobody can close → nineteen blocking items with evidence → a $420,000 change
order missing from the billing schedule → fixing it reveals unbilled revenue → the system asks a PM one
specific question → a material change is held for Controller sign-off → cutoff done without double counting →
a full close reaching ready → the operating graph as the reason customer two is cheaper than customer one.

**Plain-English framing on every screen.** Each of the four now opens with "What this answers:" in the
language a finance lead would use — for example the Command Center answers *"Can we close the books this
month, and if not, what is in the way and who are we waiting on?"*

### Verified in the browser, not just built

Clicked through the live app: the guide renders with all nine steps, jumping to "The fix" loaded the scenario
and navigated to the P-1004 billing tab where the schedule of values had moved from a `($420,000)` variance to
**Reconciles** with the change order showing **On SOV: Yes**, and Exit restored the baseline.

403 tests, typecheck and lint all still pass.
