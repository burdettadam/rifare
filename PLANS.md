# Rifare plans and current state

## State at this checkpoint

M00-G01 is prepared for review; see [its work record](work/records/M00-G01.md).
The continuation request authorizes preparatory M00-G02 proposal/check work on that
unaccepted base; see [the M00-G02 record](work/records/M00-G02.md). Neither goal is accepted,
and no dependency or reviewer requirement is waived. No product goal is accepted. `planning/goal-state.json` is an initial unstarted snapshot, not an automatically maintained task database. The first proposed goal is [M00-G01](goals/M00/M00-G01.md).

## Sources of truth

[ROADMAP.md](ROADMAP.md) explains direction. `planning/roadmap.json` defines milestones. `planning/goals.json` and `planning/test-specifications.json` define bounded contracts. `planning/requirement-coverage.json` preserves conjunctive requirement ownership. The requirement/scenario baselines under `reference/` protect original acceptance text.

`WORKER-GOALS.html`, `WORKER-GOALS.md`, `goals/`, `milestones/` and the dependency-wave/initial-queue files are derived views. Update canonical inputs under accepted change control and regenerate them. The catalogue deliberately does not claim live completion.

## Assignment and live progress

The integration owner assigns one dependency-ready goal and exact write scope. Copy `templates/GOAL-WORK-RECORD.md` to `work/records/<goal-id>.md`. Record the named writer, branch/worktree, base, included candidate revisions, accepted dependencies, evidence links, blockers and next action.

Workers update their branch record; the integration owner owns the integrated record. Use `not_started`, `in_progress`, `blocked`, `ready_for_review`, `needs_changes`, `accepted`, `cancelled` or `superseded` with actual evidence. An author may request acceptance, never declare it. Preserve terminal reasons and replacement links.

Dependencies are necessary but not sufficient: scope, permissions, credentials, independent reviewers, capacity and nonoverlapping file ownership must also exist. Static waves are not a calendar, worker assignment or authorization.

## Next sequence

Obtain the owner's actual M00-G01 support-envelope decision and required independent reviews.
Review the prepared M00-G02 benchmark/pilot proposal only against the accepted scope. M00-G02 through M00-G04 can then proceed where their concrete ownership does not conflict. Repository scaffolding here does not preaccept the workflow-adoption, environment or test-harness product goals.

Use [FIRST-DISPATCH.md](docs/FIRST-DISPATCH.md), [the worker contract](docs/WORKER-CONTRACT.md) and [dispatch rules](docs/DISPATCH-AND-PARALLELISM.md). No autonomous dispatcher is included.
