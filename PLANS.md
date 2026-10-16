# Rifare plans and current state

## Current integrated development

The reviewed M00 diagnostic foundation remains intact. Under the owner's
five-goal instruction and prior [ADR-0012](docs/decisions/0012-five-goal-local-implementation.md),
M01-G01 through M01-G05 now have native local implementations and regression tests.
Read [the foundation guide](docs/COMMERCE-FOUNDATION.md) and
[the review](docs/COMMERCE-REVIEW.md). The integration ledger is
[work/integrations/five-goal-commerce.json](work/integrations/five-goal-commerce.json).

The five modules are tenant-scoped resources, verified customer access, encrypted
opaque secret handles, current read capability discovery, and a deterministic
store simulator. They operate without an AI provider or external commerce account.
The test registry adds their obligations without deleting prior ones. Do not
restart these implementations merely because the original planning snapshot
still says not_started; live decisions are recorded under work/.

## Remaining qualifications

M00's target PostgreSQL/React stack is still unfinished. The owner-authorized
ordering exception permits early diagnostic implementations, not full acceptance
of M00-G99 or its dependent product goals. The unchanged acceptance ledger records
full accepted goals; the integration ledger records useful merged contributions.
No independent review, external account or target evidence has been invented.

Continue target-stack repair from the accumulated main, retaining the new domain
contracts and all tests. Qualify the PostgreSQL repository and served React journey
rather than relabeling SQLite and static HTML. The next product packets begin at
M01-G06 (native read-only store integration); missing provider access must remain
explicit. Do not build another acceptance framework instead of the target or
product implementation. No later goal is automatically assigned by these notes.

## Source of truth

`planning/goals.json`, test specifications, milestone coverage and benchmark
contracts retain their original meaning. Generate cards with the existing renderer;
use work records for assignment and progress. Native Git, ordinary commands and
existing skills remain the workflow. No scheduler or mandatory model was added.
