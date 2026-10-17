# Rifare

Merchant-owned commerce operations with tailorable skills and independently replaceable platforms, agents and models.

## Current development checkpoint: M06 local return depth

M06-G01 through M06-G14 now have bounded local diagnostic implementations: catalog
exchanges, mixed resolution, original bundle money, gift choices, repeated-exchange
history, paired refunds and final fees, instant-exchange obligations, reviewable
risk assistance, qualified destinations, customer-confirmed prevention and versioned
merchant policy packs. The M06-G99 assessment remains blocked for formal acceptance.

Read [M06 assessment](docs/M06-QUALIFICATION.md),
[assistance operations](docs/RETURN-ASSISTANCE-OPERATIONS.md),
[qualified destinations](docs/QUALIFIED-RETURN-DESTINATIONS.md) and
[policy packs](docs/RETURN-POLICY-PACKS.md). Earlier support, return, edit and
regression capabilities remain in the accumulated source.

```sh
python3 tools/verify.py --runtime --harness
node --experimental-strip-types tools/demo-return-depth.mts
```

The headless command requires a clean committed checkout. It creates disposable
synthetic source ledgers and prints the integrated journeys, original operation
IDs, every relevant ledger entry and declared cost limits. It makes no provider
calls. Final controller results and separate nonauthor reviews accompany the
handoff; repository documentation does not replace that exact-candidate evidence.

The runtime remains a SQLite diagnostic with synthetic protocol sources.
PostgreSQL/React, connected providers, merchant evaluation and formal milestone
acceptance remain unqualified. M07 has not been started. The later sections retain
earlier diagnostic commands.

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

Visit `/status` for the no-model order-status page or `/configuration` for
configuration drafts and boundary simulations. Draft edits do not publish policy.

Its output identifies the loopback URL and private local session file. Credentials
are not printed or embedded in the UI. Use that session to inspect the two
synthetic stores. See the foundation guide for the optional external wrapping key.

For an isolated in-memory case/approval demonstration:

```sh
node --experimental-strip-types tools/demo-execution.mts
node --experimental-strip-types tools/demo-execution.mts --serve
```

The second command prints the `/execution` URL and private temporary credential
file. Only a synthetic local case-plan marker can change; no money is moved.

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

The previous checkpoint had 1059 checks. This batch adds 108, for 1167 registered
checks: 506 Python/helper, 633 native runtime, 15 unit harness, 7 database harness
and 6 retained browser-component checks. Final source-bound execution and
restoration results are recorded in the separate delivery report. The actual
served-browser, target-stack and installed-model qualifications remain open.

Controllers remain read-only and do not authenticate people, sandbox native code,
merge branches or authorize releases. Models and external agents remain replaceable
by design; none has been falsely counted as an independently qualified integration.

## Source retention and publication

The project ZIP contains a standalone `.git` history. The bundle can be cloned:

```sh
git clone -b main /path/to/Rifare-execution-controls.bundle Rifare
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
The current registry has 1059 executable checks: all 945 prior checks plus
114 policy, manifest, layered-settings, editor and installation regressions. Delegated local integration review
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
stack, then extend M00-G06 to the actually served application. Preserve the entire registered
diagnostic and commerce regression inventory. Do not add more governance machinery merely to postpone
this implementation. The [qualification guide](docs/M00-QUALIFICATION.md) separates
these engineering gaps from the completed local integration review.

## Policy and skill customization

See [the current guide](docs/POLICY-CUSTOMIZATION.md) for M02-G03 through M02-G07.
Run the existing commerce diagnostic and open `/configuration` to edit/simulate a
draft without a model. Publication review is a request, not automatic activation.
`node --experimental-strip-types tools/demo-customization.mts` demonstrates the
policy lifecycle, undo and a vetted instruction bundle in memory.

## Durable operation reliability

M02-G13 through M02-G17 add diagnostic event deduplication, durable outgoing work,
stable operation identities, source-bound reconciliation and minimized receipts.
See [the implementation guide](docs/OPERATION-RELIABILITY.md) and
[the review](docs/OPERATION-RELIABILITY-REVIEW.md).

```sh
node --experimental-strip-types tools/demo-reliability.mts
```

The demo makes no network/model/payment call. PostgreSQL/React and live-provider
qualification remain open; unknown outcomes never authorize speculative retries.

## Worker control and recovery diagnostic

```sh
node --experimental-strip-types tools/demo-worker-controls.mts
node --experimental-strip-types tools/demo-worker-controls.mts --serve
```

The serving variant prints the `/exceptions` URL and a private temporary session
file. Unknown outcomes can be reconciled without resending. No live credential,
provider, message or payment effect is configured. Ctrl-C removes the temporary
session file and stops only that instance. The browser checks are component/API
bridge tests, not direct served-browser or React qualification.

## Mixed refund, credit and exchange diagnostic

```sh
node --experimental-strip-types tools/demo-return-resolution.mts
```

The headless demo uses two isolated in-memory databases, original paid amounts,
one-use approvals and source-bound reconciliation. No model or external call is
needed. See [the guide](docs/RETURN-RESOLUTION.md) for the authenticated endpoints
and explicitly unsupported financial and inventory operations.

For the new headless, in-memory inventory/carrier demonstration:

```sh
node --experimental-strip-types tools/demo-return-fulfillment.mts
```
