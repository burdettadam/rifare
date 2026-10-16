> Current checkpoint: M00-G01 through M00-G03 merged and accepted for local development under [delegated authority](docs/decisions/0004-delegated-development-authority.md). M00-G04 supplies the adopted workflow and completion checks. Consult the acceptance ledger for its integrated state. Historical pending proposal fields are not current task state. No product runtime is implemented.

# Rifare

Merchant-owned commerce operations with tailorable skills and independently replaceable platforms, agents and model providers.

**Status: Git-tracked planning starter. No commerce application is implemented.** This checkpoint supplies the contracts, goals, skills, examples and checks needed to begin bounded development. It does not accept any product milestone, qualify an integration or authorize a release.

## Start

1. Read [AGENTS.md](AGENTS.md), [PLANS.md](PLANS.md) and [DEVELOPMENT.md](DEVELOPMENT.md).
2. Run `python3 tools/verify.py`. These are offline planning/helper checks, not application tests.
3. Open [the goal catalogue](WORKER-GOALS.html) or [its Markdown index](WORKER-GOALS.md).
4. Read [current acceptance](work/accepted-goals.json) and the assigned work record. After M00-G04 integration, the next goal is [M00-G05](goals/M00/M00-G05.md); do not restart accepted goals.

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

# Create the next worktree only when the goal is assigned.
git worktree add ../Rifare-M00-G05 -b goal/M00-G05 main
```

Do not run initialization again just to begin work. The recorded workflow is already readable in the checkout. [Workflow adoption](docs/WORKFLOW-ADOPTION.md) identifies its source and remaining client verification.

## Boundaries

AI proposes actions; Rifare must enforce identity, permissions, policy, money, inventory and approvals. All supported operations must eventually work without AI. A portable skill is not an authority grant. Two models inside one runner are not proof of independent agent support.

Current checks validate planning, document contracts and helper behavior. Three M00-G01 specification IDs are now bound to executable document tests; no commerce runtime qualification is executed. The empty accepted-product baseline intentionally cannot pass a product-release inventory check.

The licensing direction is selected in ADR-0004; applying exact license texts and candidate-specific public-release qualification remain separate publication prerequisites. [LICENSE-STATUS.md](LICENSE-STATUS.md) is not a software license grant. The retained upstream workflow notice is in [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).

## First goal implementation

M00-G01 now has a [charter](docs/CHARTER.md), a [versioned support envelope](planning/support-envelope.json),
an [executable contract guide](docs/SUPPORT-ENVELOPE.md), and permanent
document-contract tests. See [the work record](work/records/M00-G01.md) for live
state and review blockers. Original planning views and initial-state snapshots
remain unchanged; they do not represent completion. Current acceptance and the bounded bootstrap review exception are in ADR-0004; historical pending fields below are not the current development state. No commerce runtime or product release is implemented.

## Next goal implementation

M00-G02 adds a [versioned benchmark](planning/release-benchmark.json),
[scenario inventory](planning/benchmark-scenarios.json),
[scoring and regression guide](docs/RELEASE-BENCHMARK.md), and
[bounded pilot proposal](docs/PILOT-PLAN.md). Its offline scorer checks frozen
cohort membership and independent hand-calculated synthetic outcomes. It neither
implements a commerce feature nor authenticates live evidence. See
[the current work record](work/records/M00-G02.md) for the exact prerequisite and
review boundaries. M00-G01 remains awaiting acceptance; no pilot is authorized.

## M00-G03 licensing and source review

The [licensing proposal](docs/LICENSING.md), [component inventory](planning/component-inventory.json),
[merchant data boundary](docs/MERCHANT-DATA-BOUNDARY.md) and
[distribution checks](docs/DISTRIBUTION-REVIEW.md) are prepared on the goal branch.
No license or public release is approved. `python3 tools/check_distribution.py --root .`
checks local source completeness; adding `--public-release` deliberately blocks.
See [the M00-G03 work record](work/records/M00-G03.md) for actual candidate evidence.

## Adopted development workflow

[The adoption record](docs/WORKFLOW-ADOPTION.md) maps goal IDs to native Git
branches/worktrees, the two checked-in skills, evidence and review roles.
[Workflow checks](docs/WORKFLOW-CHECKS.md) cover current source/configuration,
writer assignments, independent review records and exact release scope. They
never perform operations or authenticate identities. No product runtime or
mandatory agent/model framework has been added.
