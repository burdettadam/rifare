# ADR-0023 — Replacement inventory and return shipping lifecycle

The owner assigns the next five targets, M03-G11 through M03-G15, from `990ebb5`.
The existing delegation authorizes local decisions, maintainer review and nonrelease
integration. This checkpoint precedes implementation. One writer owns
`goal/return-fulfillment-batch`. Same-assistant review is explicit, not independent
reviewer sessions. M02/target-stack and connected qualification remain outstanding.

DELEGATED-LOCAL-14 permits bounded synthetic reservations, approved replacements,
separate label rating/purchase, independent void/reimbursement states, and carrier
tracking that never manufactures warehouse receipt. Use the existing case pins,
policies, exchange quotes, gateway, authority, recovery and stop controls. Source
inventory/orders/charges live in a separate explicitly synthetic SQLite ledger.
No live transport, carrier credentials, payments, release, remote publication,
model provider, package dependency or worker scheduler is authorized.

Owned paths: additive commerce modules and migration 016, a separate fixture source,
targeted gateway/HTTP/stop hooks, new tests/demo/contract, inventories and goal
records. Preserve all existing executable test bytes, IDs, source paths, contracts,
benchmarks and dependency inputs. Document exact fixture guarantees and native
versus locally coordinated reservation semantics. Unknown operations retain their
identity and cannot acquire a second effect through a new request key.
