# Rifare development

## Requirements and actual commands

The starter requires Git and Python 3.10+ (standard library only). Git Bash is recommended for shell examples on Windows. No application dependency manager or container runtime is configured yet.

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

There is no running API, web application, database, worker queue, commerce adapter, model integration or deployment. Product build/start/test/migration commands and source module layout are M00-G05/M00-G06 work. Do not claim that a documentation directory is an implementation or invent successful startup commands.

## Worktrees and evidence

Set your own local Git identity; the bootstrap uses an explicitly nonpersonal identity and future commits require explicit configuration. Discover state with `git status`, `git branch --show-current` and `git worktree list`.

```sh
git worktree add ../Rifare-M00-G01 -b goal/M00-G01 main
cd ../Rifare-M00-G01
python3 tools/verify.py
```

Record ownership before starting. Code isolation is not runtime isolation: future instances need separate ports, databases, storage, queues, callback destinations and provider accounts. Qualify that behavior during the owning goal.

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
all retained helper tests. See [support-envelope checks](docs/SUPPORT-ENVELOPE.md).

## M00-G02 benchmark contracts

```sh
python3 tools/check_release_benchmark.py --root .
python3 -m unittest discover -s tests -p test_release_benchmark.py -v
```

Full verification includes this proposal check and every retained helper test.
The [benchmark guide](docs/RELEASE-BENCHMARK.md) documents frozen enrollment,
source/configuration separation, exact denominators and trusted-baseline limits.
[Fixture commands](tests/fixtures/release-benchmark/COMMANDS.md) run the entirely
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

[Distribution review](docs/DISTRIBUTION-REVIEW.md) gives exact clean-candidate staging
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
