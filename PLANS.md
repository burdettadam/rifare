# Rifare plans and current state

## Accepted development work

M00-G01, M00-G02, M00-G03 and M00-G04 are accepted for local development under the owner's
explicit delegation and BOOTSTRAP-LOCAL-01. Their original branches are merged
into `main` without rewriting their source commits. See
[the decision](docs/decisions/0004-delegated-development-authority.md) and
[acceptance ledger](work/accepted-goals.json). Independent reviews were not run;
the exception is disclosed. No product milestone or runtime is qualified.

M00-G04 is accepted and merged with its branch preserved. M00-G05 is next and remains unstarted. Existing proposal
JSON and the initial `planning/goal-state.json` remain immutable historical
specifications; their pending/unstarted fields do not override work records.

## Sources of truth

`planning/goals.json`, `planning/test-specifications.json`, roadmap, coverage and
reference baselines define the preserved contracts. Render goal cards with the
existing command; do not edit generated cards alone. Live assignments and decisions
belong under `work/`, not in a new scheduler or task database.

## Development sequence

Use the accepted scope, benchmark and licensing direction as the planning baseline.
Start M00-G05 on its own worktree when assigned, using the merged main. Keep future application,
runtime isolation and test-harness work in M00-G05/M00-G06. Acceptance means the
particular documented development outcome, not live product feature completion.
