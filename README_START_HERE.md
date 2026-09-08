# Start Here

1. Unzip the package. The repository folder should be named `mep-finance-v0`.
2. Open a terminal **inside that repository folder**.
3. Before Claude Code, run:
   - `python3 scripts/validate_mock_data.py`
   - `python3 scripts/validate_reference_metrics.py`
4. Both checks should pass.
5. Start Claude Code in the repository root.
6. Paste `FIRST_PROMPT.md`.
7. Claude should first explain the domain/graph/workflow plan and run the independent architecture gate before major implementation.

## Important files
- `CLAUDE.md`: shared durable project rules
- `CLAUDE.local.md`: **private personal working preferences; do not share this file casually**
- `CLAUDE.local.example.md`: shareable template with no personal details
- `FIRST_PROMPT.md`: first build instruction
- `docs/product/MULTI_AGENT_REVIEW_PROTOCOL.md`: reviewer hierarchy/gates
- `data/mock/summit_mep/DATA_DICTIONARY.md`: mock source-data semantics
- `data/mock/summit_mep/reference/`: positive/negative test oracle and config

## Independent reviewer agents
Project subagents live under `.claude/agents/`:
- `architecture-reviewer`
- `finance-data-reviewer`
- `qa-reviewer`

The main Claude Code session remains the Lead Engineer and sole implementation owner. Reviewers challenge the work rather than editing in parallel.

## Privacy note
`CLAUDE.local.md` contains a personal communication preference and is gitignored. It is intentionally included in this personal starter kit, but remove it before sending the repository/zip to anyone else.

## Goal
Build a believable customer-demo V0, not production accounting software.
