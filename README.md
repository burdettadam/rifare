# Rifare

Merchant-owned commerce operations with tailorable skills and independently replaceable platforms, agents and model providers.

**Status: Git-tracked planning starter. No commerce application is implemented.** This checkpoint supplies the contracts, goals, skills, examples and checks needed to begin bounded development. It does not accept any product milestone, qualify an integration or authorize a release.

## Start

1. Read [AGENTS.md](AGENTS.md), [PLANS.md](PLANS.md) and [DEVELOPMENT.md](DEVELOPMENT.md).
2. Run `python3 tools/verify.py`. These are offline planning/helper checks, not application tests.
3. Open [the goal catalogue](WORKER-GOALS.html) or [its Markdown index](WORKER-GOALS.md).
4. Begin with [M00-G01](goals/M00/M00-G01.md), following [the first dispatch](docs/FIRST-DISPATCH.md).

Use Python 3.10 or newer. On Windows, use Git Bash for Git/shell examples; `py -3 tools/verify.py` also runs the Python checks from PowerShell. No package installation, API keys, containers or model subscription are needed for this starter.

## Development steering

| Material | Purpose |
|---|---|
| [ROADMAP.md](ROADMAP.md) | Thirteen outcome-based milestones; M07 is the first qualified post-purchase v1. |
| [planning/goals.json](planning/goals.json), [goals/](goals/) | 190 worker goals plus 13 integrated acceptance gates. |
| [planning/test-specifications.json](planning/test-specifications.json) | 676 designed acceptance/regression specifications; all product results remain `not_run`. |
| [planning/backlog.json](planning/backlog.json) | 151 requirements with stable IDs and retained acceptance criteria. |
| [planning/requirement-coverage.json](planning/requirement-coverage.json) | Every requirement mapped to contributing goals and its acceptance gate. |
| [planning/capability-targets.json](planning/capability-targets.json) | 44 proposed capabilities, delivery modes and scope boundaries. |
| [docs/SKILL-ARCHITECTURE.md](docs/SKILL-ARCHITECTURE.md), [examples/](examples/) | Merchant/platform tailoring examples; not executable commerce behavior. |
| [.agents/skills/](.agents/skills/) | Two model-neutral development workflow skills, adapted from the pinned git-agent workflow. |
| [skills/](skills/) | Optional execution/review rubrics used within that workflow, not a second scheduler. |
| [docs/EVIDENCE-CONTRACT.md](docs/EVIDENCE-CONTRACT.md) | Exact-candidate proof and independent acceptance. |
| [docs/REGRESSION-STRATEGY.md](docs/REGRESSION-STRATEGY.md) | Cumulative behavior protection and meaningful failure proof. |
| [work/](work/) | Tracked source/progress decisions; raw reports and recordings stay ignored. |

The JSON planning contracts are canonical. Cards/catalogue are generated. Live progress belongs in tracked work records, not by rewriting an unexecuted specification into a passing result. Regenerate views with `python3 tools/render_plan.py --root .` after an approved planning change, then rerun verification.

## Git and recovery

The distributed working-tree archive contains `.git`, a `main` branch and an initial commit. The accompanying Git bundle can be cloned into a clean checkout. There is no configured remote and no publication or hosted branch protection is claimed.

```sh
git status
git log -1 --oneline

# Set your own repository-scoped identity before your first commit.
git config user.name "Your Name"
git config user.email "your-address@example.com"

# Create the first worktree only when the goal is assigned.
git worktree add ../Rifare-M00-G01 -b goal/M00-G01 main
```

Do not run initialization again just to begin work. The recorded workflow is already readable in the checkout. [Workflow adoption](docs/WORKFLOW-ADOPTION.md) identifies its source and remaining client verification.

## Boundaries

AI proposes actions; Rifare must enforce identity, permissions, policy, money, inventory and approvals. All supported operations must eventually work without AI. A portable skill is not an authority grant. Two models inside one runner are not proof of independent agent support.

Current checks validate the plan and helper behavior only. They do not execute the 676 product specifications. The empty accepted-product baseline intentionally cannot pass a product-release inventory check.

The intended distribution is open source, but the project's license/publication decision remains M00-G03. [LICENSE-STATUS.md](LICENSE-STATUS.md) is not a software license grant. The retained upstream workflow notice is in [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).
