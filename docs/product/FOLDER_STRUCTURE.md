# Repository Structure

```text
mep-finance-v0/
├── CLAUDE.md
├── CLAUDE.local.md          # private, gitignored
├── CLAUDE.local.example.md  # shareable template
├── FIRST_PROMPT.md
├── README.md
├── README_START_HERE.md
├── FILE_MANIFEST.md
├── .gitignore
├── .claude/
│   └── agents/
│       ├── architecture-reviewer.md
│       ├── finance-data-reviewer.md
│       └── qa-reviewer.md
├── docs/
│   ├── vision/
│   ├── product/
│   ├── domain/
│   ├── workflows/
│   ├── research/
│   ├── customer_discovery/
│   └── decisions/
├── data/
│   └── mock/
│       └── summit_mep/
│           ├── raw/
│           │   ├── erp/
│           │   ├── project_management/
│           │   ├── timekeeping/
│           │   └── master_data/
│           ├── reference/
│           └── DATA_DICTIONARY.md
├── src/
│   ├── app/
│   ├── components/
│   ├── domain/
│   ├── graph/
│   ├── data/
│   ├── calculations/
│   ├── reconciliation/
│   ├── exceptions/
│   ├── agents/
│   ├── workflows/
│   └── config/
├── prompts/
├── scripts/
│   ├── validate_mock_data.py
│   └── validate_reference_metrics.py
└── tests/
    ├── unit/
    └── integration/
```

## Purpose
- `.claude/agents`: independent architecture, finance/data, and adversarial QA reviewers
- `docs/vision`: long-term company/Operating Graph thesis
- `docs/product`: V0 product scope, config, folder/review protocol
- `docs/domain`: canonical object/link model
- `docs/workflows`: finance logic, exception rules, and workstreams
- `docs/research`: industry/domain research
- `docs/customer_discovery`: interview guides and anonymized workflow notes
- `docs/decisions`: assumptions, reviews, and build decisions
- `data/mock`: fictional multi-system customer source data + reference oracle
- `src/domain`: canonical TypeScript entities
- `src/graph`: objects/links/traversal and graph projection
- `src/data`: source loaders / normalization
- `src/calculations`: deterministic finance math
- `src/reconciliation`: cross-system matching
- `src/exceptions`: rule engine
- `src/agents`: agent decision logic
- `src/workflows`: task/state orchestration
- `src/config`: typed runtime configuration
- `scripts`: source-data/reference sanity checks
