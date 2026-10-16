# ADR-0012 — Five-goal local implementation and integration

## Authority and order

The owner requested the next five goals after the reviewed main checkpoint and
previously delegated decisions, review and local merges. The delegated maintainer
assigns M01-G01 through M01-G05, in that order, from the integrated source. One
writer owns the batch worktree. This decision is committed before implementation.

M00's PostgreSQL/React qualification is still absent. A fresh environment probe
found no PostgreSQL or Docker and registry name resolution was unavailable. Do
not repeatedly create more acceptance tooling instead of implementing features.
The five bounded modules may be implemented, tested and merged against the
existing explicit SQLite diagnostic environment while qualification is open.
This is an exception to implementation ordering, not an acceptance of M00-G99 or
of its dependents, and does not rewrite their goal packets or exit criteria.

## Limits

Use native TypeScript/Node and the current database adapter without new package
dependencies. Preserve the PostgreSQL/React target, every previous assertion,
recorded threshold and no-production boundary. No live messages, providers,
commerce writes, model calls, account changes, publication or releases are
assigned. Qualification is local diagnostic only. No fake external attestations.

The maintainer will perform an explicit security and regression self-review and
record limitations. DELEGATED-LOCAL-03 permits this five-goal nonrelease
integration without impersonating independent reviewers. It cannot authorize
production acceptance or change passing criteria. Protected changes outside
additive registrations, the source inventory, and its explicit count field
require a separate documented reason. Existing controller code stays unchanged.

## Assigned ownership

`packages/commerce/`, `migrations/commerce/`, `apps/commerce-api/`,
`tools/dev-commerce.mts`, `tests/development/commerce*`,
`docs/COMMERCE-FOUNDATION.md`, and the five `work/records/M01-G*.md` records.
Integration may add its decision/ledger, update current-state entry points and
append the exact new test inventory. The product planning snapshots are retained.

Goal qualification and merged-code status remain separate. The next target-stack
repair must reuse these modules and their tests, not discard them or count SQLite
observations as PostgreSQL evidence.
