# Rifare plans and current state

## Accepted development work

M00-G01, M00-G02, M00-G03 and M00-G04 are accepted for local development under the owner's
explicit delegation and BOOTSTRAP-LOCAL-01. Their original branches are merged
into `main` without rewriting their source commits. See
[the decision](docs/decisions/0004-delegated-development-authority.md) and
[acceptance ledger](work/accepted-goals.json). Independent reviews were not run;
the exception is disclosed. No product milestone or runtime is qualified.

M00-G04 is accepted and merged with its branch preserved. M00-G05 has a partial
diagnostic runtime on its branch. M00-G06 has preparatory diagnostic test-harness work under ADR-0007. M00-G07
has preparatory trusted-regression-controller work under ADR-0008. M00-G08 adds preparatory evidence capture/checks under ADR-0009. These four
goals remain unaccepted and main remains unchanged. Existing proposal
JSON and the initial `planning/goal-state.json` remain immutable historical
specifications; their pending/unstarted fields do not override work records.

## Sources of truth

`planning/goals.json`, `planning/test-specifications.json`, roadmap, coverage and
reference baselines define the preserved contracts. Render goal cards with the
existing command; do not edit generated cards alone. Live assignments and decisions
belong under `work/`, not in a new scheduler or task database.

## Development sequence

Use the accepted scope, benchmark and licensing direction as the planning baseline.
Continue target-stack qualification on M00-G05 and preparatory harness work only
within ADR-0007 and regression-controller preparation within ADR-0008 and evidence preparation within ADR-0009. Keep future application,
runtime isolation and test-harness work in M00-G05/M00-G06. Acceptance means the
particular documented development outcome, not live product feature completion.

## M00-G99 assessment checkpoint

ADR-0010 authorizes bounded integrated qualification without accepting the missing
prerequisites. No additional test/evidence framework is introduced. The assessment
branch retains G05-G08; main and the accepted ledger remain unchanged. Current
blockers and the M00-G05-first repair sequence are in
[the qualification guide](docs/M00-QUALIFICATION.md) and
[repair record](work/qualification/M00.json).
