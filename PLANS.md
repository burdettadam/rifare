# Rifare plans and current state

## Current integrated development

M01-G01 through M01-G10 and all earlier M00 work remain intact. Under ADR-0014,
M01-G11 through M01-G15 add task-bound MCP reads, a manual no-model status page,
provider-neutral read assistance, two separately encoded provider wire contracts,
and independent deterministic Python orchestration. Read [the guide](docs/AGENT-ACCESS.md)
and [review](docs/AGENT-ACCESS-REVIEW.md). No new framework or npm dependency is required.

## Remaining qualifications

M00's target PostgreSQL/React stack is still unfinished. The owner-authorized
ordering exception permits early diagnostic implementations, not full acceptance
of M00-G99 or its dependent product goals. The unchanged acceptance ledger records
full accepted goals; the integration ledger records useful merged contributions.
No independent review, external account or target evidence has been invented.

Continue target-stack repair from the accumulated main, retaining the new domain
contracts and all tests. Qualify the PostgreSQL repository and served React journey
rather than relabeling SQLite and static HTML. The next product packets begin at
M01-G16 (the next original packet); missing provider access must remain
explicit. Do not build another acceptance framework instead of the target or
product implementation. No later goal is automatically assigned by these notes.

## Source of truth

`planning/goals.json`, test specifications, milestone coverage and benchmark
contracts retain their original meaning. Generate cards with the existing renderer;
use work records for assignment and progress. Native Git, ordinary commands and
existing skills remain the workflow. No scheduler or mandatory model was added.
