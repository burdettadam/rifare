# Rifare

**Current work: M00-G05 is partial, not accepted.** A real, explicit synthetic smoke environment is available. PostgreSQL/React target setup remains blocked. [Start the local diagnostic](docs/LOCAL-ENVIRONMENT.md).

Merchant-owned commerce operations with tailorable skills and independently
replaceable platforms, agents and models.

**Current checkpoint:** M00-G01 through M00-G04 are accepted for local development
and merged into `main`. Their branches and original commits are retained.
**No commerce application is implemented.** M00-G05 is next; it has not started.

The owner delegated project decisions. [ADR-0004](docs/decisions/0004-delegated-development-authority.md)
records the adopted scope, benchmark, licensing direction and narrow bootstrap
review exception. [The acceptance ledger](work/accepted-goals.json) is current.
Original pending proposal fields and initial planning snapshots remain historical
records, not the live task state. No independent review or product qualification
is claimed from the bootstrap exception.

## Start

```sh
git status
git log --graph --oneline --all -12
python3 tools/verify.py
python3 tools/check_workflow.py --root .
```

Use Git and Python 3.10+ with the standard library. No API keys, paid model,
application package manager, container runtime or global initializer is required
for the current commands. Windows users can use `py -3`; cross-platform
qualification has not been performed by this checkpoint's Linux checks.

Read [AGENTS.md](AGENTS.md), [GOVERNANCE.md](GOVERNANCE.md), [PLANS.md](PLANS.md)
and [DEVELOPMENT.md](DEVELOPMENT.md). When the next goal is assigned:

```sh
git worktree add ../Rifare-M00-G05 -b goal/M00-G05 main
```

Set your own repository-local Git identity before authoring your own commits.
Do not restart accepted goals or infer assignments from the initial ready queue.

## Development material

| Material | Purpose |
|---|---|
| [Roadmap](ROADMAP.md) | 13 milestones, including the later qualified product release. |
| [Goal catalogue](WORKER-GOALS.html) / [Markdown](WORKER-GOALS.md) | 190 worker goals and 13 acceptance gates. |
| [Canonical goals](planning/goals.json) | Stable contracts and dependencies, not live task status. |
| [Test specifications](planning/test-specifications.json) | 676 planned scenarios; commerce results remain not-run. |
| [Requirement coverage](planning/requirement-coverage.json) | All 151 original requirements remain represented. |
| [Charter](docs/CHARTER.md) | Adopted first-release support envelope. |
| [Benchmark](docs/RELEASE-BENCHMARK.md) | Cohorts, denominators, numerical gates and pilot requirements. |
| [Licensing](docs/LICENSING.md) | Selected component-scoped direction and publication boundary. |
| [Workflow adoption](docs/WORKFLOW-ADOPTION.md) | Actual instruction versions, native commands and tested limits. |
| [Workflow checks](docs/WORKFLOW-CHECKS.md) | Candidate-bound tests/reviews, writer ownership and release scope. |
| [Skill architecture](docs/SKILL-ARCHITECTURE.md) | Merchant/platform-tailorable product skills, separate from development skills. |
| [Regression strategy](docs/REGRESSION-STRATEGY.md) | Retained behavior and meaningful fault proof. |
| [M00-G04 work record](work/records/M00-G04.md) | Implemented outcome, evidence and delegated acceptance. |

The goal cards/catalogue are generated from planning JSON. Live decisions belong
under `work/`. Raw evidence stays ignored. No task database, worker scheduler,
custom Git command protocol or mandatory agent provider has been added.

## Verified development boundary

The integrated suite has 289 executable planning/helper/workflow tests: 239
retained tests and 50 M00-G04 tests. Six deliberately broken workflow changes
were caught by behavioral assertions. Native Git worktrees and two separate
loopback fixture servers were exercised; this is not product database/queue or
provider isolation. Tests use explicitly synthetic reviewers where needed.

The workflow checker is read-only. It does not authenticate identities, grant
permissions, lock OS writers, merge branches or create releases. The global
initializer and a specific agent client were not executed. Actual client/host
qualification and product startup remain separate work.

## Source retention and publication

The project ZIP contains a standalone `.git` history. The bundle can be cloned:

```sh
git clone -b main /path/to/Rifare-M00-G04.bundle Rifare
cd Rifare
git remote remove origin
python3 tools/verify.py
```

There is no hosted remote, release tag or public publication. The selected
licensing direction is AGPL-3.0-only for the future application and Apache-2.0
for separable SDKs, public skills/templates and original developer documentation.
Existing MIT-derived notices are retained. Exact license application and a
candidate-specific distribution review remain necessary before public release;
[LICENSE-STATUS.md](LICENSE-STATUS.md) is not itself a software license grant.
Private merchant material and raw review evidence do not belong in source.
