# Repeated exchanges and carried paid value

Status: bounded local fixture implementation, proposed for review. Formal goal
acceptance and connected financial/physical qualification remain blocked. Scope:
M06-G06 under ADR-0029; the original milestone and goal specifications remain
unchanged.

## What a replacement carries

An actual delivered replacement may become the source order for a later return.
Its refundable principal is funded value, not its catalog price:

`child paid = selected parent paid - retained fees + settled additional payment - issued refund or credit`.

The permanent discounted example starts with 1,000 minor units paid. A replacement
with retail value 1,400 retains the original 200 discount and costs 1,200; a native
settled additional payment contributes 200. The descendant therefore carries
1,200, not 1,400. A later replacement costing 900 issues a 300 residual refund;
the next descendant carries 900. Refunding that 900 exhausts the original 1,200
funded total. The independent fixture was pinned before product implementation.

Every node retains its parent identity and digest, generation, original payment
slices, actual additional-payment reference, policy/configuration versions,
selected physical units, delivery identity, fees and terminal outflow. A free
promotional replacement remains a real quantity with a delivered native record
and zero refundable principal. Current credit-account balance is not substituted
for the originally issued credit outflow.

Funding is recorded by instrument. Retained fees first reduce each instrument's
transferable share; residual refund/credit routing is then allocated within those
shares. This prevents independent rounding from refunding more than a share.
The three-instrument regression starts at [4, 33, 963], retains fee 100, and gives
entitlement [3, 30, 867]. Refund 896 routes [3, 30, 863], leaving [0, 0, 4] in the
child. Zero remaining instrument slices retain their identity through a later
additional payment; a native route may omit a zero without changing its value.

## Native transfer and canonical import

`ExchangeLineageFixtureSource` uses the independently stored resolution database
and reads the separately stored fulfillment source. Fixture administration
registers original order facts before effects through `seedOriginal`; there is no
HTTP endpoint that lets a staff caller supply original paid amounts, consent,
delivery, or transfer amounts. Attaching a lineage source does not enroll other
original orders. Already known descendants always require matching authority.

The native transfer accepts only the original replacement operation ID. It reads
its committed stock reservation, created replacement, shipment and immutable
native delivery receipt, and verifies the exact held lineage and financial
settlement. One native transaction consumes the selected parent units, debits
remaining parent principal/fees, creates the descendant financial account and
instrument allocation, and records the immutable node. Other pending financial
bindings on those units prevent a transfer. Parent units cannot be resolved again.

Core import records an unknown obligation before transport. A lost reply is
reconciled by lookup of the same operation and native node; repeated calls do not
mint new account, edge or unit identities. If the first transfer never happened,
retry uses the same idempotent transfer identity. A native transfer completed
before a failed local ingest remains recoverable. Unknown import blocks ordinary
return closure until its original record has been reconciled.

Canonical ingest creates an ordinary delivered synthetic order using only the
child's paid and physical facts. Its digest is checked independently by ingest
and by the resolution ledger. Rewriting it to a retail price, stripping the
lineage marker, changing physical units, or cloning the same native order under a
new external ID fails. Staff can inspect parent history; customer order views do
not expose ancestor payment or source-operation history.

## Interfaces and files

Staff HTTP endpoints accept exact keys and existing scoped sessions:

| Endpoint | Input | Result |
| --- | --- | --- |
| `POST /v1/exchange-lineage/materialize` | `operation_id` | Imported native-backed descendant or retained unknown obligation |
| `POST /v1/exchange-lineage/node` | `node_id` | Scoped immutable lineage record |

`/exchange-history` exposes these operations together with paired money, fee and
instant-exchange review. Native delivery is fixture administration only, through
`FulfillmentFixtureSource.deliverReplacement`, after a real fixture shipment.
A created or financially zero response alone is not delivery evidence.

Implementation: `packages/commerce/exchange-lineage.mts`,
`packages/commerce/exchange-lineage-guards.mts`,
`packages/adapters/exchange-lineage-fixture-source.mts`, and
`packages/adapters/exchange-lineage-source-guards.mts`. Additive migration 024
stores immutable nodes and durable import state. Canonical quote, fulfillment,
resolution, workflow and privacy hooks retain the existing approval pipeline.

## Verification and limits

Permanent cases are in `tests/development/exchange-lineage.test.mts`, with shared
API, component and lifecycle cases in `exchange-history-*.test.mts`. They cover
two-generation paid/refund flows, different replay orders, parent reuse, mixed
instruments, retained fees, native delivery, failed/lost transfer, descendant
identity, tenant/customer views, zero-price stock, and rounding. Expected values
are literal independent numbers and native effect counts. A retained deliberate
retail-principal fault must fail the unchanged paid-value case behaviorally.

This implementation is a SQLite diagnostic fixture. It does not qualify target
PostgreSQL/React deployments, provider delivery observations, real transfers or
all market/payment combinations. Gift-recipient lineage and paired-currency
replacement/exchange are explicitly unqualified. Existing G05 gift handling and
G07 original-allocation refunds remain within their separate bounded contracts.
The generation limit is 16 and the retained instrument limit is eight. Unqualified
combinations fail before further supported effects; no silent conversion exists.

The new privacy inventory extension preserves prior inventory bytes. Export
includes scoped exchange records. Erasure scrubs subject-facing quotes while
retaining minimized financial/lineage audit; later subject access is denied.

Rollback requires matched core, finance and fulfillment data. Preserve unknown
operations, unit consumption and funding history. Restore only with egress
stopped and reconcile original source identities before any activation. Dropping
new history or generating a fresh operation key is not a financial rollback.

Exact final candidate hashes, actual native counts, independent findings and
local integration decision are retained in the accompanying verification
manifest. Source documentation does not self-accept a goal or a connected stage.
