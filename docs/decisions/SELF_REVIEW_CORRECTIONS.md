# Self-Review Corrections

This file summarizes major corrections made across the iterative starter-kit design.

For the latest external-review resolution, see:
`docs/decisions/EXTERNAL_REVIEW_RESOLUTION.md`.

## Major design corrections retained in the final kit

1. RNI moves known cost from commitment to cost-to-date without automatically increasing EAC.
2. AP-unposted, RNI, and unposted-labor adjustments have separate double-counting treatment.
3. Prior EAC is reconstructed from prior-date activity and historical forecast snapshots.
4. Labor analysis uses budgeted hours and cost-code physical progress.
5. Commitment overrun uses cumulative valid non-duplicate invoices.
6. Rule precedence suppresses duplicate/noisy tasks.
7. PM remaining cost is explicitly uncommitted cost.
8. Project-mapped/unmapped-cost transactions remain in project totals.
9. Client Operating Graph includes business objects, source evidence, human decisions, and agent actions.
10. Approved-CO billing logic has valid approval dates.
11. Runtime thresholds/assumptions have one configuration source.
12. Mock data includes healthy, improving, and risk cases plus explicit negative controls.
13. Shared `CLAUDE.md` stays focused; personal communication preferences live in private `CLAUDE.local.md`.
14. Four primary V0 screens prevent shallow UI sprawl.
15. Independent reviewer agents challenge architecture, finance/data, and QA without editing in parallel.
16. Synthetic data/reference validation now runs before Claude Code implementation.
