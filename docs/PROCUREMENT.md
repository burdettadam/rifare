# Replenishment and procurement preparation

M11-G04 through G06 implement local replenishment and purchasing controls under
ADR-0040. All external supplier operations here use a separate synthetic source.
M07-G99, M08-G99 and formal M11 qualification remain blocked. This implementation
does not issue a real supplier order, establish an agreement, observe payment or
qualify physical inventory. Root owns native execution, independent review and
the separate local integration decision.

## From forecast to a reviewed purchase

`ReplenishmentPlanning` uses the actual `InventoryForecasts` service, canonical
`LocationInventory`, `SupplierPurchaseOrders`, and `PurchaseReceiving` on the
same kernel. A proposal supplies stored forecast and supplier-term references;
it cannot supply approved quantities, a receipt counter or an approval Boolean.

The current forecast review binds its catalog resource, SKU/location, exact
dataset and backtest, evaluated horizon and uncertainty. Its original `as_of`,
source window and `valid_until` remain visible. A horizon that has partly elapsed
is not restarted at proposal time. The valid window must still cover the current
supplier lead time. Unsupported quality or stale review blocks the proposal.

The declared arithmetic plans against the evaluated upper bound, subtracts
canonical available stock and source-acknowledged outstanding POs, then rounds
up to supported purchase units and supplier minimums. For the independent fixture,
twenty units less ten available and six incoming yields four. Receiving two
changes available to twelve and incoming to four, so the requirement stays four.
An observed cancellation of two remaining units changes incoming to two and the
new requirement to six. That cancellation does not imply a payment refund.

Planning compares the local stock ledger with its actual warehouse source and
checks unresolved discrepancies, unknown transfers, receipt/production operations,
unacknowledged or unknown POs, and receipt-summary conservation. Supplier source
changes require original-operation reconciliation before their quantities enter
another draft. It creates an explainable draft and no purchasing permission.

`SupplierPurchaseOrders` imports actual synthetic supplier terms, then creates
an immutable PO version. The supported unit subset is integer `each` and `case`
with an explicit positive integer conversion to `each`. Minimum quantities,
lead times, currency and exact minor-unit prices are source-bound. Unsupported
dimensions, implicit conversions and changed prices reject before sending.

Each line retains its original line ID, SKU/location, ordered purchase quantity,
base quantity, conversion, currency, unit cost and total. The PO separately pins
the supplier source and warehouse source. Catalog resources have no customer
identity. The module does not borrow a customer order to host business records.

Draft creation has no supplier acknowledgment or committed spend. A revision
retains the old version and invalidates unused approvals/reservations. Once a
send has been attempted, the original version and native operation remain the
only reconciliation target; a revision or a new request ID cannot repeat it.

## Approval, budgets and native boundaries

The existing kernel enforces distinct propose, approve, execute and dispatch
permissions. Every actor that drafted or edited the version is excluded from
approving it. Permission scopes, current memberships and authority revisions
are checked again at the source boundary, along with the exact reviewed digest,
supplier terms, expiry, budget and approval limit, reservation and execution-stop
stamp. Root adds `diagnostic.procurement.send` to the existing stop controls.

Budget arithmetic uses the existing exact minor-unit money representation and
the kernel's `BEGIN IMMEDIATE` transaction. An approval atomically reserves the
full PO obligation. Two POs cannot both acquire the same remaining budget. A
configured change cannot reduce a budget below held obligations. The supported
approval limit is explicit per configured budget; no caller or model chooses it.

Before source dispatch, the local operation is durably marked unknown and its
full reservation remains held. The separate source binds the exact original
command to that PO/version. A currently active dispatcher guard must pass before
the source creates a new effect. The guard is closed in `finally`, including
failure and timeout. Reopening the adapter or database does not create permission;
the original committed result can still be looked up.

The source separately records `sent`, explicit supplier acknowledgment, and
immutable per-line cancellation observations. Invoice and payment remain
`unobserved`. Local cancellation/revocation does not manufacture supplier facts.
Replayed observations retain one effect, and source version regressions or
conflicting event IDs reject. Cancellation and supplier returns do not silently
release budgets; the original audit obligation is retained.

## Stock integration

The authenticated cross-area read is:

```ts
procurementPo(kernel, scope, {po_id, version, expected_digest})
```

It returns immutable version and line data together with the observed stage,
original operation/native IDs, source digest, cancellation events, per-line
`cancelled_quantity_base`, and `authority_revoked`. Read access grants no new
stock or purchasing effect. The stock service owns all receipt, correction,
return and production journals and compares cancellation with received/unknown
quantities before applying effects.

`PurchaseReceiving.summary` supplies ordered, cancelled, confirmed received,
unknown, outstanding and separately returned base quantities. No duplicate
received-quantity counter exists in procurement. The inherited M08 condition
where an erased unresolved movement leaves shared stock unreconciled remains
blocked for new confident planning and requires operator handling.

## Privacy, restore and rollback

Migration `043_procurement.sql` adds eight explicitly scoped business tables.
Canonical privacy composition owns authorization and transactions. Subject
exports use explicit nested allowlists. An unrelated customer receives no
catalog/supplier business records. Hash-only erasure also sanitizes unexpected
private fields in every selected-store record without deleting legitimate
business rows; any changed grants are revoked. Explicit subject-linked restored
rows are minimized with stable original operation, PO, source and monetary IDs.
Allowed scalar fields accept only scalar values or null; a malformed object in
such a field cannot retain nested private copies through erasure or restore.

Restore and uninstall sanitize all nested fields, revoke procurement approvals,
disable budget/configuration and version authority, and mark PO execution
authority revoked even when no customer tombstone exists. They retain unknown
send state, original commands and held monetary obligations. Source guards check
the revoked authority at their final boundary. Native supplier databases,
historical snapshots and caller copies still require separate operator handling.

Rollback must retain immutable versions, approvals, reservation audit and
original native identities. Do not delete an unknown send, release its obligation
or issue a new PO key to force replay. Reconciliation remains an original-source
lookup; successful lookup is not settlement or physical receiving.

## Bounded evidence

The tests and independent known-answer fixture were committed first at
`8e3bfba`. `procurement-planning.test.mts` contains eleven native author cases:
three each for G04-G06, the retained PORT-031 scenario, and the native boundary
and unknown-send case. Root reserves a twelfth slot for the same-kernel milestone
journey. Three targeted faults modify actual isolated modules and reach
independent behavioral assertions. Source/parser checks alone are not test
passes. The author executes no product modules, suites or demos; root retains
every actual bounded native attempt and obtains two fresh independent reviews.
