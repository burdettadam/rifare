# Rifare plans and current state

## Current integrated development

The reviewed M00 foundation and M01-G01 through M01-G05 remain intact.
Under [ADR-0013](docs/decisions/0013-portable-read-workflows.md), M01-G06 through
M01-G10 add fixture-tested Shopify reads, current knowledge provenance, portable
skill resources, typed merchant profiles and canonical read/task HTTP interfaces.
Read [the implementation guide](docs/PORTABLE-READ-WORKFLOWS.md),
[review](docs/PORTABLE-READ-REVIEW.md), and
[integration record](work/integrations/portable-read-workflows.json).

The five modules require no model framework or additional npm dependency. Do not
restart the implementations merely because initial planning says not_started;
work records distinguish useful integrated code from full goal acceptance.

## Remaining qualifications

M00's target PostgreSQL/React stack is still unfinished. The owner-authorized
ordering exception permits early diagnostic implementations, not full acceptance
of M00-G99 or its dependent product goals. The unchanged acceptance ledger records
full accepted goals; the integration ledger records useful merged contributions.
No independent review, external account or target evidence has been invented.

Continue target-stack repair from the accumulated main, retaining the new domain
contracts and all tests. Qualify the PostgreSQL repository and served React journey
rather than relabeling SQLite and static HTML. The next product packets begin at
M01-G11 (the next original packet); missing provider access must remain
explicit. Do not build another acceptance framework instead of the target or
product implementation. No later goal is automatically assigned by these notes.

## Source of truth

`planning/goals.json`, test specifications, milestone coverage and benchmark
contracts retain their original meaning. Generate cards with the existing renderer;
use work records for assignment and progress. Native Git, ordinary commands and
existing skills remain the workflow. No scheduler or mandatory model was added.
