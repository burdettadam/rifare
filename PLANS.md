# Rifare plans and current state

## Integrated source

M00-G01 through M00-G04 retain their prior development acceptance. Source from
M00-G05 through M00-G08 and the M00-G99 assessment has been reviewed and integrated
into local `main` under [ADR-0011](docs/decisions/0011-delegated-review-and-integration.md).
All original branches and their commits remain available. The integration includes
two corrected review findings and 17 new regression cases.

The [review report](docs/INTEGRATION-REVIEW.md) and
[integration ledger](work/integrations/2026-10-16.json) record this decision.
The unchanged [acceptance ledger](work/accepted-goals.json) records full accepted
goals, not every merged partial contribution. No reviewer identity was fabricated.

## Remaining implementation

M00-G05's diagnostic environment is useful and merged; its PostgreSQL/React target
is not complete. M00-G06 has deterministic SQLite/browser-component tests, not a
qualified served React application. G07/G08 helpers are merged and tested but do
not create absent target evidence or a production security boundary. M00-G99
therefore remains target-qualification-blocked, not merge-blocked.

**Next implementation: resume M00-G05 from current `main`.** Preserve G06-G08 code
and tests. Implement the target stack and qualify its migrations, UI/API/worker
journey and two-worktree isolation, then complete G06's connected tests and rerun
M00-G99. No new milestone or acceptance framework is assigned by this review.

## Sources of truth

`planning/goals.json`, `planning/test-specifications.json`, the roadmap, coverage
and reference baselines retain the original contracts. Initial proposal states
are historical snapshots, not current dispatch state. Generate cards with the
existing renderer; record assignments and decisions under `work/`. Use native
Git, maintained commands and existing skills. Real qualification is never inferred
from a merge, a high test count or owner delegation.
