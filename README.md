# Rifare

Merchant-owned commerce operations with tailorable skills and independently
replaceable platforms, agents and models.

**Current checkpoint: fifteen commerce goals have local diagnostic implementations.**
The latest five add task-bound MCP reads, a no-model manual status page, a provider-neutral
read runner, two synthetic-tested provider wire adapters and a separately written
Python orchestrator. Existing tenant isolation, verification, vault, platform reads,
skills, profiles and portable tasks remain intact.

**This is still the SQLite diagnostic implementation.** PostgreSQL/React,
live Shopify/model qualification and the actual served-browser journey remain open.
No model, payment or messaging service was called. Component tests and provider wire
fixtures are labeled explicitly and do not qualify external services.

[Agent access and commands](docs/AGENT-ACCESS.md) ·
[Current review](docs/AGENT-ACCESS-REVIEW.md) ·
[Delegated authority](docs/decisions/0014-agent-access-and-runners.md) ·
[Earlier portable reads](docs/PORTABLE-READ-WORKFLOWS.md).
Full goal acceptance remains separate from approved local integration.

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

For the new commerce diagnostic (Ctrl-C to stop its own instance):

```sh
node --experimental-strip-types tools/dev-commerce.mts
```

Visit `/status` for the no-model manual page.

Its output identifies the loopback URL and private local session file. Credentials
are not printed or embedded in the UI. Use that session to inspect the two
synthetic stores. See the foundation guide for the optional external wrapping key.

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

The previous checkpoint had 758 checks. This batch adds 72, for 830 registered
checks: 502 Python/helper, 300 native runtime, 15 unit harness, 7 database harness
and 6 retained browser-component checks. The 300 runtime cases include seven new
manual-screen component cases. Final source-bound execution and restoration results
are recorded in the separate delivery report. The live served-screen qualification
is a separate command and remains blocked by the host policy. No test is relabeled
as a live model evaluation.

Controllers remain read-only and do not authenticate people, sandbox native code,
merge branches or authorize releases. Models and external agents remain replaceable
by design; none has been falsely counted as an independently qualified integration.

## Source retention and publication

The project ZIP contains a standalone `.git` history. The bundle can be cloned:

```sh
git clone -b main /path/to/Rifare-agent-access.bundle Rifare
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
The current registry has 830 executable checks: all 758 prior checks plus
72 agent-access/read-runner regressions. Delegated local integration review
is complete; full target-stack qualification remains open.
All 676 commerce scenarios remain planning specifications.

## Integrated M00 qualification

The original M00-G99 assessment used 565 checks. The integrated source retains
those checks, adds 17 review regressions and reuses the same evidence controllers.
The milestone remains blocked by target-stack qualification and unaccepted
prerequisites; a green diagnostic run is not milestone acceptance. See
[qualification and repair order](docs/M00-QUALIFICATION.md) and
[the exact existing-goal repair checklist](work/qualification/M00.json).
Target-stack repair resumes M00-G05 on the accumulated source. M01-G01 through
M01-G15 are implemented for local diagnostic integration, not full qualification.

## Immediate engineering priority

Resume **M00-G05** from this `main`: implement and install the target React/PostgreSQL
stack, then extend M00-G06 to the actually served application. Preserve the existing
830 diagnostic and commerce tests. Do not add more governance machinery merely to postpone
this implementation. The [qualification guide](docs/M00-QUALIFICATION.md) separates
these engineering gaps from the completed local integration review.
