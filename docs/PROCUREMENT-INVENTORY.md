# Purchase receiving, supplier adjustments and production

This M11 development slice is synthetic local preparation under ADR-0040. G07
and G10 retain distinct PREP cases; their original connected cases and formal
M07-G99/M08-G99 prerequisites remain unperformed or blocked. The code creates no
real supplier order, invoice, payment, credit settlement or physical observation.

## One stock owner

`WarehouseFixtureSource.warehouse_stock` remains the sole available-stock owner.
The existing `WarehouseInventoryFixtureSource` retains all transfer methods and
fields. Its typed procurement additions write the same original
`warehouse_inventory_movements` and `warehouse_inventory_commands` tables. The
existing `LocationInventory` importer records original observations; it required
no source change for these movement kinds.
Observed stock positions retain the original ledger's nonnegative safe-integer
domain. An accumulated balance may exceed the 1,000,000,000-unit cap on a single
line or operation. Later bounded receipts, returns and production commands
remain usable against that balance, with exact source-position equality and
post-effect safe-integer checks retained.

Three separate-source tables hold immutable synthetic observations, durable
approved-command bindings, and production reservation/consumption state:
`warehouse_procurement_observations`, `warehouse_procurement_bindings`, and
`warehouse_inventory_production`. Production reservations contribute to the
existing four-field source position in the same SQL snapshot as available and
transfer reservations. There is no second available-stock store.

## Public service contracts

All service inputs are exact objects. They use authenticated kernel scopes and
existing catalog resources with `customer_id: null`. Identifiers, quantities,
units, digests and actor permissions are checked by the services.

| Service | Principal operations |
| --- | --- |
| `PurchaseReceiving(k, inventory, source, {orders, deadline_ms?})` | `propose(scope, {operation_id, po_id, version, expected_digest, receipt_id})`, `approve(scope, operation_id, {expected_digest, expires_at})`, `dispatch`, `reconcile`, `read`, `receipts`, `summary` |
| `SupplierReturns(k, inventory, source, {orders, deadline_ms?})` | `propose(scope, {operation_id, event_id})`, then the same exact-operation approval/dispatch/reconcile sequence; `receipt(scope, receipt_id)` returns additive receipt/cost/credit state |
| `BillOfMaterials(k)` | Immutable `material` and `define` versions, authenticated `read`, exact `expand(scope, {bom_id, version, expected_digest, quantity})` |
| `ProductionOrders(k, inventory, source, {deadline_ms?})` | `create`, `approveJob`, `propose` an exact reserve/consume/release/complete/correct_output operation, `approve`, `dispatch`, `reconcile`, `read` |

`orders` is an actual `SupplierPurchaseOrders` instance using the same kernel and
inventory object, never a callback or readiness Boolean. An immutable PO getter
supplies ID/version/digest, original supplier and warehouse identities, explicit
sent/acknowledged stage, lines, conversion, currency and approved price. For new
receipt or supplier effects, `orders.assertSourceCurrent` additionally checks the
actual original supplier observation at proposal and at the final stock guard.
An unreconciled native cancellation therefore invalidates an earlier approval.
A missing supplier handle denies new PO effects and marks summaries planning
blocked; original status/lookup/reconciliation remains possible after restart.

Synthetic source observations are fixture administration through
`ProcurementInventoryFacts`, exposed as each service's `facts`. They are not a
merchant route. Receipt observations name the original PO version and per-line
purchase-unit quantities. Supplier observations name the original receipt and
line. Output observations name the production job, actual good/scrap quantities
and a correction's original output event when applicable.

## Partial receipts and supplier adjustments

An observed receipt line binds the approved SKU, location, purchase unit and
conversion. Supported purchasing units are `each` and integer `case` conversion
to base `each`. The service rejects incompatible units and excess quantities
before stock changes. A different caller operation ID for the same original
receipt resolves to the existing operation. Proposed receipt quantities reserve
remaining receiving capacity; any other unknown operation for the PO blocks a
new receiving effect until original reconciliation.

`summary` derives confirmed received quantities from canonical receipt/event rows
matched to original native command and movement receipts. Source-observed
cancellations come from the reconciled supplier result. Its base-unit identity is
`ordered = cancelled + received + unknown + outstanding`. It rejects conflicting
cancellation/receipt totals and marks unreconciled stock or source uncertainty as
planning blocked. Positive unknown corrections consume conservative remaining
capacity. An unknown negative correction or return remains visible through the
blocked state; no uncertain quantity is silently treated as confirmed.

Supplier returns subtract only received, unreturned units. They do not reopen
incoming PO quantity. Receipt corrections are signed, explicitly linked source
movements; a corrected quantity cannot fall below returned units or exceed the
remaining approved obligation. Neither operation deletes an original receipt.

Prices use exact integer minor-unit arithmetic. A separately approved cost event
changes the receipt's effective price and exposes cost variance while retaining
the original receipt and approved PO price. A return freezes its credit
obligation at the reviewed receipt cost. Later price changes do not rewrite that
obligation. Source-observed credit events can satisfy it once, up to its exact
remaining amount, without making a payment or changing stock. Fractional
minor-unit conversion requires an explicit accounting policy and is rejected.

## Exact nested BOMs and production conservation

Material definitions pin an existing catalog resource, SKU, base unit, currency
and declared book cost per base unit. Definitions and BOM versions are immutable.
Every component pins a material or nested BOM ID/version/digest. Supported unit
families are count (`each`, `dozen`), mass (`g`, `kg`) and volume (`ml`, `l`), with
integer base units `each`, `g`, and `ml`. Positive decimal input is converted by
reduced BigInt rational arithmetic. Fractional final base-unit quantities,
dimension mismatches, missing references, conflicting leaf versions and cycles
reject planning. Definitions allow at most 64 components; expansion is bounded
to 16 nested levels and 256 nodes.

Each nested level uses `required good / (declared output × yield)` as its batch
factor. The independent fixture's
four good finished units require five gross output units, 2,500 g cotton and ten
buttons. Their frozen component cost is 2,600 minor units. Expected root scrap is
one unit, and exact cost per gross output unit is 520 minor units. Nested yield
loss is already reflected in leaf requirements; it is not received as stock.

Production jobs preserve the complete expanded original plan and all nested
version references. They require an independent bounded job approval and an
independent exact-step approval. Reserve moves all approved component quantities
from available to reserved without changing on-hand. Consume requires complete
reservations, reduces reserved and on-hand together, and moves the declared
component cost to WIP. Release returns only unconsumed reservations to available.

Only fully consumed and reconciled components allow finished output. Actual
output and scrap may arrive in partial events, bounded by planned good and gross
output. Good units add finished available/on-hand; scrap does not. In the fixture,
two good units leave 1,560 minor units in WIP. Four good plus one scrap leave zero
WIP, 2,080 output cost and 520 scrap cost. A linked correction may reclassify
existing available good units as scrap, preserving total cost and original
output history. Consumption is complete per approved job; partial component
consumption, unconsumption and arbitrary cost-allocation policies are unsupported.

## Current authority and uncertain results

Proposal and approval use existing `CommerceKernel` permissions. The actual
proposer and independent owner/reviewer must remain active, with unchanged
resource permissions and authority revisions. Step reviews bind the exact
command, one-use status, expiry no later than five minutes, both
`diagnostic.procurement.stock` and `diagnostic.warehouse.disposition` control
stamps, and the original catalog/source plan. The dispatcher also needs current
execute/dispatch permissions. Recovery and migration egress fences apply.

Before a source call, the local operation becomes `unknown` durably. A source
binding then persists its exact typed command and original business identity.
The source validates a current registered guard inside its transaction, again
immediately before stock/movement changes. A fresh adapter instance sees the
binding but cannot create a new effect without the guard. An already committed
original command can still be looked up or returned without another stock effect.
The guard rechecks current supplier observations, actors, approvals, expiry,
controls, resource digests, job/receipt lineage and current source/canonical stock.

Native stock, movement receipts and command receipt commit together. A lost
response leaves the original local operation unknown. Its only continuation is
lookup at the original source identity and import of the original movements.
An absent or timed-out lookup is not a rejection. New keys cannot recreate the
same receipt/output; later job steps wait for reconciliation. Stale proposals
have no automatic reauthorization. A native guard failure after local start also
remains an explicit unknown original operation, even when local fixture inspection
shows no effect. No new identity is inferred from that absence.

These are separate synthetic databases, not a distributed supplier/warehouse/
kernel transaction. Real transport timing, physical outcomes and cross-system
atomicity remain unqualified. The existing M08 limitation also remains: erasure
before a committed unknown movement is imported can leave shared stock unresolved.
Planning and new effects must stay blocked until authorized operator reconciliation;
there is no speculative stock-repair or compensation worker here.

## Storage, privacy and recovery

Migration `044_procurement_inventory.sql` adds seven scoped business tables:

| Table | Identity / scope | Role |
| --- | --- | --- |
| `commerce_purchase_receipts` | tenant/store/receipt_id; catalog resource | Original source-reconciled PO receipt and immutable line/cost lineage |
| `commerce_supplier_receipt_events` | tenant/store/event_id; original receipt and resource | Additive return, receipt correction, cost and credit observations |
| `commerce_material_items` | tenant/store/id/version; catalog resource | Immutable material units and book costs |
| `commerce_bom_versions` | tenant/store/id/version; catalog resource | Immutable nested BOM definitions |
| `commerce_production_orders` | tenant/store/id; catalog resource and warehouse source | Original plan plus reconciled native production state |
| `commerce_stock_operations` | tenant/store/operation_id and unique business_key | Exact original proposal, source identity, uncertainty and receipt |
| `commerce_stock_approvals` | tenant/store/id; exact job or step reference | Scoped independent bounded review using existing kernel authority |

`exportProcurementInventorySubject`, `eraseProcurementInventorySubject` and
`revokeProcurementInventoryForRestore` are called by canonical privacy/recovery
composition. Customer-free business records are excluded from unrelated customer
exports and do not acquire invented customer identities. All valid body schemas
use explicit recursive allowlists. Repeated hash-only erasure removes arbitrary
copied fields even on unrelated business rows, without deleting their legitimate
original receipt/BOM/operation lineage. Explicit resource/tombstone matches are
minimized and marked redacted. Unknown state and original command/source identity
are retained; erasure never asserts a physical reversal.

Store or global restore/import/uninstall sanitizes every new table and sets every
stock approval to `revoked`, including jobs without customer tombstones. It marks
all stock operations and production jobs as lacking execution authority. Current
source callbacks consult these canonical markers. Original lookup still does not
depend on a live approval. Partial tenant/store restore arguments reject before
mutation. Native source journals, historical exports and external copies remain
separate cleanup obligations; no physical deletion confirmation is inferred.

## Evidence and rollback

Tests and independent values were committed before product implementation in
`1a7fc21`. Additional existing-case assertions in `72aba18` were committed before
the current supplier-handle implementation. The single native file has exactly
16 cases: twelve goal cases, the later PORT-025 receiving extension, and three
authority/integrity/conservation cases. It includes genuine receipt correction
and reservation release within the existing goal cases. The four named faults
mutate actual isolated implementation sites and use fixed independent assertions;
imports, syntax errors and empty test discovery are not fault evidence.

The author executes no product suite, module, demo or test. Parser-only and static
source checks are preparation, with actual behavioral results and two independent
reviews supplied by root's bounded integrated candidate. No formal acceptance or
release follows from this author's handoff.

Rollback must preserve the original source command/movement journal and all
unknown operations. Stop the stock actions and revoke affected reviews before
changing implementation. Do not drop migration 044 data or restore old approvals
as fresh authority. Reconcile original identities before any later stock action.
