# ADR-0013 — Portable read workflows, skills and external clients

The owner assigned the next five goals and has delegated decisions, review and
local integration. From main 5a17248, assign M01-G06 through M01-G10 to one writer
on the goal/next-five-read-workflows branch. This authority checkpoint precedes
implementation. Scope: narrowly bounded Shopify reads, current source-provenance
retrieval, portable skill content, typed merchant profiles, and canonical REST
reads/task context. Reuse existing server authority, vault and native tooling.

The established implementation-order exception continues for this diagnostic
batch: unresolved M00 PostgreSQL/React qualification does not prevent local
implementation, but remains required for full milestone acceptance. Shopify
transport may be implemented and tested with synthetic wire responses; no live
store credentials or native-record evidence are available or invented. Live
transport is off unless an operator explicitly provisions a permitted test-store
connection. Do not make network calls, messages, payments, deployments or public
releases during this assignment. No production evidence may be inferred from a
fixture. A null native order means missing or inaccessible, not confirmed deletion.

DELEGATED-LOCAL-04 authorizes a documented maintainer security/regression
self-review and local nonrelease merge after actual checks. It does not impersonate
independent reviewers, accept incomplete goals, weaken existing assertions, or
waive external qualification. Preserve every retained native test and contract.
Add registrations, source-inventory membership and the explicit file-count fixture
as needed. Any other control change requires a separate reasoned decision.

Allowed changes: additive modules under packages/commerce and packages/adapters,
new commerce migrations, read-only routes and startup integration, portable product
skill resources, synthetic profile/wire fixtures, public read-contract documentation,
new native tests, this decision and goal/integration records. Extend the server-local
vault interface only to supply credentials to a registered trusted read adapter;
never expose secret resolution to HTTP clients or skills. No new scheduler,
custom worker framework, mandatory model, or new dependency is assigned.
