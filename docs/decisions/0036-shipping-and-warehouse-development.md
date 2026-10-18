# ADR-0036: Shipping and warehouse development, M08-G02 through G06

## Prior authority and bounded assignment

The owner requested "Proceed with next 5 goals" after the saved locale, pilot
and carrier quote checkpoint. From clean main
`c8d4d68ddcae5721a2925553707b3c19ff825df8`, the delegated maintainer assigns
**M08-G02, M08-G03, M08-G04, M08-G05 and M08-G06** for local development and
nonrelease integration. The prior ZIP SHA256 is
`702eee90f21fa52ec5e617fd69ae6b444dd7d1aa4480697c243bf82b69325dee`.

Formal M07-G99 and dependent M08 acceptance remain blocked. This explicit
preparation assignment does not waive their gates. Carrier purchases, pickup
and warehouse observations use separate synthetic sources only. G06 exercises a
named/versioned Rifare warehouse fixture connector using the existing M04 edit
contract; actual WMS/3PL qualification remains unperformed. No merchant account,
external message, paid effect, live provider, production, hosted push,
publication, tag or release is authorized. M08-G07 is unassigned.

## Concrete ownership

Native Git worktrees branch from this committed assignment, with one writer per
worktree. Root integrates committed changes and owns shared metadata.

| Scope | Writer and allowed paths |
| --- | --- |
| M08-G02 and G05 | Shipping author: new `packages/commerce/shipping-batch-labels.mts`, `shipping-manifests.mts`, their contracts, new synthetic carrier effect source under `packages/adapters/`, `migrations/commerce/033_shipping_batches.sql`, one new `tests/development/shipping-batches.test.mts` and helper/fixtures, `tools/demo-shipping-batches.mts`, `docs/SHIPPING-BATCHES.md`, and `work/records/M08-G02.md` / `M08-G05.md`. |
| M08-G03 and G04 | Packing author: new `packages/commerce/packing-sessions.mts`, packing contract and necessary separate fixture source under `packages/adapters/`, `migrations/commerce/032_packing_sessions.sql`, one new `tests/development/packing-sessions.test.mts` and helper/fixtures, `tools/demo-packing-sessions.mts`, `docs/PACKING-SESSIONS.md`, and `work/records/M08-G03.md` / `M08-G04.md`. |
| M08-G06 and integration | Root: existing `packages/adapters/order-edit-fixture-source.mts`, `packages/commerce/order-edit-execution.mts` and `order-edit-core.mts` only where needed for warehouse support; new warehouse connector module/contract, one `tests/development/warehouse-connector.test.mts`, demo/guide/work record. Root also owns privacy/export/restore integration for new tables, an additive storage extension, shared capability/test/source inventory and exact reviewed conformance/privacy pins, qualification/integration records, `PLANS.md` and `README.md`. |

Packing and shipping share G01 package/resource identities. Packing exposes
`qualifiedPackage(scope, packageId)` from current stored allocations and
confirmation. Shipping exposes `packageStatus(scope, packageId)` from durable
original purchase and receipt state. Manifests query these services directly;
caller booleans never establish packed, labelled, approved or accepted state.

## Preserved behavior and controls

Purchase obligations receive one durable identity before the source call.
Unknown outcomes reconcile by the original identity; another request key,
process restart or repeated batch does not authorize a second purchase.
Recheck current resource/source/account/rate/approval controls before a new
effect. Keep completed, voided, refund-pending and refunded stages distinct.
Reconstructed quote instances cannot turn old HMAC snapshots into fresh authority.

Scan IDs remain stable across retries/restarts. Expected per-line quantities,
operator attribution and explicit confirmation precede shipment eligibility.
Remaining fulfillable units account for existing allocations, shipped/cancelled
units, backorders and return links. Cancelling one unshipped package cannot
release shipped allocations. Manifest acknowledgment, pickup and carrier
acceptance are separately observed per package.

Warehouse support pins named connector/version, source identity, configuration,
workflow and callbacks. HTTP acknowledgment alone cannot prove a hold, final
payload consumption or physical protection. Reuse canonical M04 execution and
approval; do not introduce another order-edit engine.

New persistent tables require explicit subject export, minimization/erasure,
restore/quarantine and audit handling review. Preserve the existing version-one
storage projection and prior contracts; add a current schema extension and
classify actual new storage in the existing privacy surface IDs. Source hash
refreshes cannot replace those controls. Retain all prior tests, oracles,
registrations, capabilities, accepted ledger entries, migrations, scope policies,
helper defaults, thresholds and dependency gates.

## Focused evidence and independent review

Keep the owner's reduced defaults: **60 actual cases, four whole files and one
60-second deadline per invocation**. Plan three new whole test files plus the
existing nine-case privacy coverage file for the concrete new durable-storage
risk; new files together contain at most 51 cases. Authors write behavioral
tests first and defer execution until root runs the coherent candidate. Named
faults execute in isolated temporary source copies within selected cases;
copied-result edits, setup errors and skipped tests are not proof.

Run the coherent selection once. Repeat only whole files affected by a concrete
failure or consequential review fix. No broad regression, browser, controller,
restoration or connected campaign is implied. Cases and work records clearly
label synthetic observations and any unperformed original connected obligation.

Separate nonauthor authority/security and regression sessions inspect the exact
candidate, protected base and actual native evidence without duplicate suites.
Findings remain blocking until resolved, with at most three corrective rounds.
Only local integration is authorized; the accepted-goal ledger stays unchanged.
