# ADR-0018 — Durable event processing and operation recovery

Owner assignment: proceed with the next five goals, M02-G13 through M02-G17.
Base: 2f37872. The standing delegation permits implementation decisions,
maintainer review and verified local nonrelease integration. This record precedes
implementation. One writer owns `goal/reliability-batch` in its isolated checkout.

Reuse the authenticated inbox, exact-preview action gateway, existing permission
checks, native tests and SQLite transactions. Implement monotonic diagnostic
projection events; atomic outgoing work; stable business-operation identities;
bounded retries and explicit unknown outcomes; checkpointed reconciliation; and
minimized append-only receipts with separately erasable payloads. These are product
reliability modules, not a new developer scheduler, agent framework or CLI protocol.

Effects stay in local synthetic state and an explicitly provisioned local synthetic
journal on a separate database connection. No network provider, refund, payment,
message delivery, model, live store, release or hosted publication is authorized.
Do not add an arbitrary command/HTTP transport surface. A retry or reconciliation
must not bypass the action gateway or repeat an uncertain irreversible operation.
No universal exactly-once guarantee, hostile-process isolation or target database
qualification may be inferred from local fixture results.

DELEGATED-LOCAL-09 permits recorded same-assistant security and regression review
for this bounded diagnostic integration. It does not fabricate independent reviews,
accept unfinished prerequisites or waive tests. Preserve all previous test sources,
registrations, goal contracts, performance thresholds and dependency inputs.

Allowed changes: additive commerce/recovery/adapter modules and migration; narrow
gateway, permissions and read-only HTTP integration; deterministic tests, a local
demo, source inventory, new registration, work records and documentation. Any
protected-control change requires a separately reasoned decision and behavioral
proof; candidate-generated evidence alone cannot approve a new baseline.
