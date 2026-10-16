# Rifare

Merchant-owned commerce operations with tailorable skills and independently
replaceable platforms, agents and models.

**Current checkpoint: reviewed diagnostic code integrated into `main`.** All
M00-G01 through M00-G08 source contributions and the M00-G99 assessment are retained,
along with their original branches. The latest integration fixes source-identity
and expired-worker-lease defects and adds 17 permanent regression tests.

**This is not the completed PostgreSQL/React application.** The runnable profile
is `smoke-sqlite`: separate local API, worker, HTML/JavaScript UI, SQLite migrations,
queues and attachments. There are no live commerce integrations. Default target
startup still fails explicitly rather than substituting this diagnostic.

[The integration review](docs/INTEGRATION-REVIEW.md) records the findings and decision.
[ADR-0011](docs/decisions/0011-delegated-review-and-integration.md) records delegated
local merge authority. [The integration ledger](work/integrations/2026-10-16.json)
is separate from [full goal acceptance](work/accepted-goals.json). M00-G05 through
M00-G08 remain target-incomplete; their partial status no longer blocks retaining
and developing the reviewed source on `main`.

## Start

```sh
git status
git log --graph --oneline --all -12
python3 tools/verify.py
python3 tools/check_workflow.py --root .
```

The planning commands above use Git and Python 3.10+ with the standard library.
The optional smoke runtime also requires Node and npm; see its prerequisites below.
No API keys, paid model, container runtime or global initializer is required
for these diagnostic commands. Windows users can use `py -3`; cross-platform
qualification has not been performed by this checkpoint's Linux checks.

Read [AGENTS.md](AGENTS.md), [GOVERNANCE.md](GOVERNANCE.md), [PLANS.md](PLANS.md)
and [DEVELOPMENT.md](DEVELOPMENT.md). The delivered checkout is on `main`.
Resume target-stack repair from this accumulated source, not an older goal branch.
Check `git worktree list` before claiming a writer or starting another instance.

For the explicit diagnostic runtime:

```sh
npm ci --offline --ignore-scripts
python3 tools/verify.py --runtime --harness
npm run dev:smoke
# In a second terminal in the same worktree:
npm run stop:smoke
```

`npm run dev` exits 2 until the target React/PostgreSQL setup is qualified.
The smoke profile does not silently replace that target.

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
| [M00-G04 work record](work/records/M00-G04.md) | Accepted workflow foundation. |
| [M00-G05 work record](work/records/M00-G05.md) | Partial runtime outcome, actual checks and remaining blockers. |
| [Local environment](docs/LOCAL-ENVIRONMENT.md) | Runtime commands, isolation, recovery and qualification boundaries. |

The goal cards/catalogue are generated from planning JSON. Live decisions belong
under `work/`. Raw evidence stays ignored. No task database, worker scheduler,
custom Git command protocol or mandatory agent provider has been added.

## Verified development boundary

The accepted `main` baseline has 289 Python planning/helper/workflow tests. The
M00-G05 branch adds 8 manifest-intake tests and 44 native Node diagnostic tests.
That M00-G05 verification ran 297 Python tests plus 44 Node tests, without skips.
Runtime cases exercise two linked worktrees, separate SQLite databases and queues,
local attachments, migrations, instance-bound stopping, restart persistence,
external-request denial and a clean offline install from the zero-package lock.
They do not establish PostgreSQL behavior, React rendering, OS-wide egress
containment, commerce qualification or independent review. Interactive Chromium
navigation was blocked by the execution host's browser policy; no visual pass is
claimed. Exact logs and fault demonstrations remain in ignored review evidence.

The workflow checker is read-only. It does not authenticate identities, grant
permissions, lock OS writers, merge branches or create releases. The global
initializer and a specific agent client were not executed. Actual client/host
qualification and target-stack startup remain separate work.

## Source retention and publication

The project ZIP contains a standalone `.git` history. The bundle can be cloned:

```sh
git clone -b goal/M00-G05 /path/to/Rifare-M00-G05.bundle Rifare
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

## Deterministic diagnostic tests

M00-G06 adds frozen synthetic fixtures, native unit/SQLite tests and in-memory
Chromium component checks. Run `python3 tools/verify.py --runtime --harness` on a
host meeting the [test-harness requirements](docs/TEST-HARNESS.md). Unit/database
layers need no added npm dependencies; browser tests require the separately
installed Playwright/Chromium tooling. These results do not close target-stack
qualification or grant goal acceptance. See [the current work record](work/records/M00-G06.md).

## Candidate-bound evidence

M00-G08 adds a separately pinned evidence capture/verifier. It runs the retained
native regression controller, records source/configuration/artifact identity and
checks external review facts without granting acceptance. See
[the evidence guide](docs/EVIDENCE-GATE.md) and
[the current work record](work/records/M00-G08.md).
The current registry has 565 executable diagnostic/helper checks: 466 retained
and 99 new. Full target-stack qualification and independent review remain open.
All 676 commerce scenarios remain planning specifications.

## Integrated M00 qualification

The M00-G99 assessment reuses the existing 565-check suite and evidence controllers.
The milestone remains blocked by target-stack qualification and unaccepted
prerequisites; a green diagnostic run is not milestone acceptance. See
[qualification and repair order](docs/M00-QUALIFICATION.md) and
[the exact existing-goal repair checklist](work/qualification/M00.json).
The next implementation work resumes M00-G05 on the accumulated source; M01 is not started.

## Immediate engineering priority

Resume **M00-G05** from this `main`: implement and install the target React/PostgreSQL
stack, then extend M00-G06 to the actually served application. Preserve the existing
582 diagnostic/helper tests. Do not add more governance machinery merely to postpone
this implementation. The [qualification guide](docs/M00-QUALIFICATION.md) separates
these engineering gaps from the completed local integration review.
