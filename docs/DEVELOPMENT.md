# Rifare development

## Routine development: small checks by default

The owner requested fewer regression tests during development. Use this workflow
for ordinary edits and local batches of goals, as recorded in
[ADR-0032](decisions/0032-focused-development-tests.md).

```sh
make test                                      # default: affected whole test files
make test-plan                                 # show selected and deferred scope; run nothing
make test-smoke                                 # fixed 54-case core smoke
python3 tools/dev_tests.py --files tests/development/money.test.mts
python3 tools/dev_tests.py --since main         # also include committed branch changes
make test-full                                 # explicitly requested full local diagnostic
```

`make` itself and the editor's default test task use the same changed-file
profile. Without Make, use `python3 tools/dev_tests.py`; on Windows use
`py -3 tools/dev_tests.py`. Run once after a coherent set of edits. Add another
small check only to resolve a concrete remaining risk. Routine development uses
focused review; full regression, repeat fault campaigns and restoration audits
are explicit integration/milestone/release checkpoint activities. A local batch
of five development goals does not automatically trigger those broad activities.
Formal acceptance retains the required full evidence and independent reviews.

The default plan selects at most **60 cases across four whole files**, with a
**single 60-second deadline** for the invocation. Changed test files come first,
then nearby importing tests and explicit path mappings. Selection includes staged,
unstaged and nonignored untracked files. `--since REF` adds committed changes
since the merge base. Browser wrappers, nested catalog runs and controller/harness
self-tests are deferred until explicitly selected. A clean checkout, unmatched
change or affected file that cannot fit the budget uses the labeled smoke fallback.
The fixed smoke comprises 26 money, 20 skill-contract and eight dependency-intake
cases. Missing registered test files fail rather than becoming a smoke pass.

Inspect `--plan` when changing a shared helper or unfamiliar area. The report
lists every selected file, its reason, deferred files and unmapped paths. Static
imports and mappings are a feedback aid, not a proof of complete impact coverage.
New tests can run before registration; their IDs are marked exploratory. Dynamic
case expansion above the planned limit fails the development result and stops
subsequent files. Use `--files`, `--max-tests`, `--max-files` or `--timeout` only
for a deliberate larger scope; the default never escalates or retries itself.

Native commands run sequentially. Unit/database tests retain the existing
network-deny hook; runtime tests retain their established loopback-fixture access.
Failures, missing/duplicate IDs, skipped or cancelled cases and timeouts cannot
produce a passing development report. Timed-out process trees are stopped. Each
run keeps fresh XML, logs and `report.json` under ignored `evidence/development/`.
A selected pass always records `full_regression: false` and `goal_accepted: false`.

Use an installed Node version supported by `package.json`. To select a local
executable, use `--node /path/to/node`, `RIFARE_DEV_NODE`, or
`git config rifare.devNode /path/to/node`; otherwise Node is found on `PATH`.
Host-specific executable paths are not committed. The original native runners,
registrations, fixtures, baselines and package scripts remain available. Full
trusted acceptance follows [its guide](TRUSTED-REGRESSION-GATE.md).

## Requirements and explicit diagnostic commands

The starter requires Git and Python 3.10+ (standard library only). Git Bash is recommended for shell examples on Windows. The explicit smoke profile additionally requires Node with its bundled npm; see the M00-G05 section below. No target-stack container runtime is qualified.

```sh
python3 tools/verify.py                         # starter and document-contract checks
python3 tools/validate_plan.py --root .         # IDs, dependencies and retained criteria
python3 -m unittest discover -s tests -v        # planning/helper/repository tests
python3 tools/check_repository.py --root .      # layout, JSON, internal links and initial state
python3 tools/render_plan.py --root .           # regenerate planning views
python3 tools/check_generated.py --root .       # fail on stale generated views
git diff --check
```

On Windows with the Python launcher, substitute `py -3` for `python3`. `make verify` and `make render` are optional conveniences where Make exists; the Python commands are canonical. Run from the repository root. Checks do not download dependencies or call providers.

`tools/check_regression_inventory.py` is a fail-closed helper for a future trusted runner integration. Its baseline hash must be supplied from an independently protected ref/workflow. The empty product baseline is not suitable for product acceptance. See `docs/REGRESSION-STRATEGY.md`.

## What is not configured

The original M00-G05 diagnostic profile supplies isolated API/worker/plain-browser processes using SQLite. Substantial commerce modules, fixture adapters and model interfaces have since landed; see [architecture](ARCHITECTURE.md). The actual PostgreSQL/React application and its target-host qualification remain open. Default target startup fails closed; use the explicit diagnostic and demo commands for current local behavior.

## Worktrees and evidence

Set your own local Git identity; the bootstrap uses an explicitly nonpersonal identity and future commits require explicit configuration. Discover state with `git status`, `git branch --show-current` and `git worktree list`.

```sh
git worktree add ../Rifare-M20-G04 -b goal/M20-G04 development
cd ../Rifare-M20-G04
python3 tools/dev_tests.py
```

The command above illustrates the next recorded commerce direction; substitute the assigned scope and actual reviewed base. Record ownership before starting. Code isolation is not runtime isolation: instances need separate ports, databases, storage, queues, callback destinations and provider accounts. Qualify that behavior during the owning goal.

Raw reports/recordings go under ignored `evidence/<goal-id>/<candidate-sha>/`. Run `git status --short` and `git diff --cached` before committing. Retain only concise work decisions and source-controlled fixtures. Preserve durable review links and required release records before deleting owned temporary evidence after closure.

## Local-first review and optional CI

Use local checks for iteration. The included GitHub workflow is **manual-dispatch only**, read-only, with no release, model or deployment steps. It does not run on pushes or pull requests. Hosting, protected branches, required checks and account permissions are not established in this local repository. Configure them through an authorized adoption decision.

## Restore

The working-tree archive includes Git history. Alternatively, clone the accompanying `Rifare.bundle` with native Git, then run `python3 tools/verify.py`. A bundle clone points `origin` to the local bundle; remove that file-backed origin before configuring any separately authorized hosted remote.

```sh
git clone /path/to/Rifare.bundle Rifare
cd Rifare
git remote remove origin
python3 tools/verify.py
```

Run environment/version-specific qualification again on an untested host. Restore from this checkpoint does not recover live accounts, production data or external evidence because none are included.

## M00-G01 document contracts

```sh
python3 tools/check_support_envelope.py --root .
python3 tools/check_support_envelope.py --root . --scenarios tests/fixtures/support-envelope/scenarios.json
python3 -m unittest discover -s tests -p test_support_envelope.py -v
```

These commands check proposed scope and meaningful regression cases, not native
commerce effects or human approval. Full `verify.py` includes this contract and
all retained helper tests. See [support-envelope checks](SUPPORT-ENVELOPE.md).

## M00-G02 benchmark contracts

```sh
python3 tools/check_release_benchmark.py --root .
python3 -m unittest discover -s tests -p test_release_benchmark.py -v
```

Full verification includes this proposal check and every retained helper test.
The [benchmark guide](RELEASE-BENCHMARK.md) documents frozen enrollment,
source/configuration separation, exact denominators and trusted-baseline limits.
[Fixture commands](../tests/fixtures/release-benchmark/COMMANDS.md) run the entirely
synthetic arithmetic example without a provider or application. Product gates,
consent, source attestations and independent acceptance remain unperformed.

## M00-G03 inventory and distribution review

```sh
python3 tools/check_distribution.py --root .
python3 tools/check_distribution.py --root . --public-release
python3 -m unittest discover -s tests -p test_distribution.py -v
```

Public-release preflight intentionally exits 1 until real decisions and qualification
exist. It is not included as a required passing check in `verify.py`. No network or
package installation is needed. The test suite uses temporary Git repositories and
filesystem link-rejection cases; rerun on the target host rather than inferring
cross-platform qualification. The current observed host is Linux.

[Distribution review](DISTRIBUTION-REVIEW.md) gives exact clean-candidate staging
commands and independently retained manifest/baseline hash requirements. Add every
new source path to its reviewed inventory component. Private local files stay outside
source; force-added ignored paths still fail. License and profile changes require
independent review; do not edit fixtures to bypass a failing obligation.

## Adopted workflow and completion checks

M00-G01 through M00-G03 have current delegated decisions in ADR-0004; their
proposal-only helper reports remain historical artifact checks, not live task state.
Use `work/accepted-goals.json` for current development acceptance. The pinned
workflow contract and current adoption status are in `docs/WORKFLOW-ADOPTION.md`.

```sh
python3 tools/check_workflow.py --root .
python3 -m unittest discover -s tests -p test_workflow.py -v
```

These are read-only checks, not a new worker command protocol. Native Git creates
worktrees. The checker never merges, locks, schedules or releases. Evidence must
be separately pinned to the accepted policy base; see `docs/WORKFLOW-CHECKS.md`.
No global initializer or named model/client is required for these commands.

## M00-G05 synthetic runtime slice

Read [local environment instructions](LOCAL-ENVIRONMENT.md) and the
[test/evidence mapping](RUNTIME-TESTS.md) before starting.

```sh
npm ci --offline --ignore-scripts
npm run dev:smoke                  # foreground; prints actual loopback URLs
npm run stop:smoke                 # separate terminal in the same worktree
python3 tools/verify.py --runtime  # planning + Python helpers + Node smoke tests
```

The process launcher is a local product start/stop script, not an agent scheduler.
No paid services, model keys or production accounts are used. Root npm metadata
contains no dependency packages. PostgreSQL, React and OS-level outbound network
isolation remain unqualified; `npm run dev` exits 2 rather than substituting smoke.

## M00-G06 native test harness

```sh
python3 tools/test_harness.py --layer unit
python3 tools/test_harness.py --layer database
python3 tools/test_harness.py --layer browser
python3 tools/test_harness.py --layer all --reverse
python3 tools/verify.py --runtime --harness
```

The [test-harness guide](TEST-HARNESS.md) specifies the host browser requirement,
diagnostic-only scope, frozen fixtures, deny-by-default network boundary, exact
native test-ID checks, and source-bound reports. Node's existing package/lock
remain unchanged. The browser suite runs Chromium against in-memory source and a
fake response boundary; it does not qualify a served React/PostgreSQL application.
M00-G05/M00-G06 remain unaccepted pending their full prerequisites and reviews.

## M00-G07 trusted regression controller

Run the new controller self-tests locally:

```sh
python3 -m unittest discover -s tests -p test_regression_gate.py -v
```

For full retained-obligation enforcement, use the [external-controller guide](TRUSTED-REGRESSION-GATE.md)
and [test map](REGRESSION-TEST-MAP.md). It executes the native suites using
separately pinned verifier/baseline bytes. Do not treat candidate-owned verification
scripts or copied pass reports as a trusted baseline. M00-G05/M00-G06 target-stack
qualification and independent reviews remain open; this preparatory goal does not
change their acceptance or authorize a release.

## M00-G08 commit-bound evidence

The [evidence gate](EVIDENCE-GATE.md) captures a fresh pinned native run and
verifies source/configuration/artifact identity against an external request and
receipt. Acceptance checks reuse the governing workflow and require separately
trusted review inputs. No automatic acceptance, merge, release or new dependency.

```sh
python3 -m unittest discover -s tests -p test_evidence_gate.py -v
```

Full verification discovers these tests automatically. For candidate evidence,
use the separately exported controller and independently retained pins described
in the guide; candidate-authored checks alone are not an external trust anchor.

## Portable order-status reads

The [read-workflow guide](PORTABLE-READ-WORKFLOWS.md) documents the installed
skill, profiles, authenticated OpenAPI surface and independent Python HTTP client.
Run the same diagnostic server; it provisions no live Shopify connection. The
new tests use the existing native runner and add no dependency or agent service.
Full verification includes their registered IDs. Qualification and local merge
remain different states; see the current integration record.

## Agent access and grounded status assistance

Read [the current guide](AGENT-ACCESS.md). The diagnostic server additionally
serves `/status` and `/mcp`. Provider adapters are disabled unless explicitly installed
by server-local configuration; the manual/REST/MCP path needs no model.

```sh
node --experimental-strip-types tools/demo-assistance.mts openai
node --experimental-strip-types tools/demo-assistance.mts anthropic
```

Both demonstrations use only synthetic wire fixtures and an in-memory database.
Actual served-browser qualification is a separate command documented in the guide;
a host-policy failure is not a skip or passing component result.

## Return resolution diagnostics

Use the changed-file profile for routine edits and explicit native/full commands
for the checkpoint being assessed. The module
contract, golden original-payment fixtures, same-source recovery, bounded calls and
headless demo are described in [RETURN-RESOLUTION.md](RETURN-RESOLUTION.md).
The financial source is a separate synthetic database, never a real account. No
additional package installation or model provider is required.

## M06 final local return-depth assessment

```sh
node --experimental-strip-types tools/demo-return-depth.mts
node --experimental-strip-types --test --test-concurrency=1 tests/development/return-depth-integration.test.mts
```

The first command requires a clean committed checkout and prints ten disposable
synthetic journeys with the relevant canonical/native ledgers, source pins,
original operation identities and declared-cost limitations. It accepts no
credentials or provider options. The shared HTTP service exposes the review
page at `/return-assistance`; its native-source features need the explicit
fixture sources passed to `startCommerceServer`. HTTP routes are documented in
[assistance operations](RETURN-ASSISTANCE-OPERATIONS.md).

The permanent browser tests bridge components to the actual loopback API. This
is separate from direct served-browser or target-host qualification. Use the
unchanged external regression controller and protected baseline supplied with
the cumulative evidence for final integration. Do not regenerate those controls
from the candidate or count an IPC-restricted file wrapper as native test cases.
