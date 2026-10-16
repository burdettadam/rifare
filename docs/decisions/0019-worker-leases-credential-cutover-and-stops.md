# ADR-0019 — Worker leases, credential cutover and execution stops

Assignment: proceed with the next five goals, M02-G18 through M02-G22, from
`936be5c`. The owner continues to delegate implementation choices, maintainer
review and local nonrelease integration. This record precedes implementation.
One writer owns `goal/worker-controls-batch` in its isolated checkout.

Implement expiring case leases and generation fencing, minimal portable worker
contracts, credential-version cutover and revocation, execution-time stop checks,
and an operator exception queue. Reuse the action gateway, operation identity,
read-only reconciliation, encrypted vault, current permissions and native tests.
Use only local synthetic effects. No new payment/message capability, provider,
model call, cloud dependency, scheduler, release or hosted publication is assigned.

DELEGATED-LOCAL-10 authorizes documented same-assistant security and regression
review of this bounded local integration. It neither fabricates independent
reviews nor accepts unfinished PostgreSQL/React or connected qualifications. All
previous test sources, registrations, contracts and performance gates are retained.
A stopped or expired worker cannot create a fresh effect; an ambiguous prior effect
must remain available to reconciliation. Resuming a switch is not permission to
replay old queued commands. Scope/audience identity is server-owned.

Allowed paths: additive commerce/worker/control modules, migration, contract/client
and exception UI; narrow hooks in the gateway, durable worker, kernel, vault and
HTTP boundary; deterministic tests, registrations, distribution inventory, demo,
work records and documentation. Protected-control changes require a reasoned prior
decision and behavioral proof; no such weakening is assigned here.
