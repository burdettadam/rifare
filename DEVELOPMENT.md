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
