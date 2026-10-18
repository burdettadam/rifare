# Outbound batch labels and manifests

M08-G02 and G05 provide a local synthetic shipping slice under ADR-0036. A
separate carrier fixture database records label charges, native label/receipt
identities, void/refund observations and manifest events. No carrier endpoint,
account, credentials, money movement or physical handling is connected.

## Per-package purchase and repair

`ShippingBatchLabels(kernel, carrierQuotes, carrierSource)` consumes current
sealed G01 quote snapshots. `prepare(scope, snapshot)` persists one purchase ID
for each eligible package. A separate owner/reviewer calls
`approve(scope, packageId, {expected_digest, expires_at})`; an operator then
calls `purchase(scope, snapshot)`. Each receipt retains that original purchase
ID, native label and charge identity, amount and currency.

The new outbound implementation uses the existing kernel permissions, current
member authority, execution stops, privacy and recovery guards. It has no
return case, return request or alternate public approval identity. A reviewer
must differ from the proposer. The command digest and approval expiry bind the
exact package quote, source and rate. Approval is consumed when the operation
becomes unknown, before the carrier call. Authority, stops, current source and
sealed quote are checked again immediately before that call.

Known package labels survive another package's lost response. `reconcile`
only looks up the original purchase ID. Repeating a whole batch or changing its
request key never calls purchase for unknown or completed packages. A null
lookup remains unknown. After service reconstruction, persisted purchases can
be reconciled without a valid old HMAC; an unsent purchase still needs the new
quote instance to validate a current snapshot and a matching reviewed command.
This slice deliberately provides no administrative reset that can reissue an
uncertain package purchase.

An expired or changed quote blocks only that unsent package. `prepare` can
refresh a proposed command using a newly sealed snapshot while preserving the
purchase identity and revoking its old approval. The changed command requires
another distinct review. Current execution-stop revisions also require a fresh
proposal and approval after a stop/resume cycle.

`approveVoid` separately binds the current receipt and a durable void operation.
`requestVoid` records unknown before dispatch; later source lookups distinguish
requested, confirmed and rejected voids. A confirmed void with a pending refund
does not claim money returned. Refunded requires the original amount, currency
and an observed native refund reference. A voided package cannot automatically
buy another label under another request key. Monetary values stay exact decimal
minor-unit strings, with totals grouped by currency and no implicit conversion.

## Packing, manifests and physical stages

`ShippingManifests(kernel, packingSessions, batchLabels, carrierSource)` calls
the two canonical services directly. `create(scope, {manifest_id, package_ids})`
requires current confirmed packing allocations, the same package/resource,
usable native label, unchanged parcel and resource facts, and a current
warehouse operator. Caller-provided packed or labelled booleans are rejected.
Current carrier-account enablement, revision/digest, carrier, service and currency
must still match the original purchase. The separate source checks the account
again during admission, so a disable/change after the local check yields an
uncertain local acknowledgment with no admitted manifest. Existing label receipts
and original-identity reconciliation remain readable after an account changes.
One manifest contains at most 32 packages from one carrier account. Its sorted
membership is fixed before dispatch; repeated requests reconcile the original
identity. A package cannot belong to another manifest, including when its first
acknowledgment is unknown. The outbound label stop also halts manifest creation.

Manifest acknowledgment, pickup and carrier acceptance have independent fields.
`observe(scope, manifestId)` reads fixed-source receipts/events and records one
package's event at a time. Only a correlated `carrier_acceptance` event sets
`carrier_accepted` and `shipped`. The same event freezes its already confirmed
packing allocations. An exact replay leaves membership, events and allocations
unchanged. Pickup is not inferred from acceptance or acknowledgment. Outstanding
packages remain visible when only part of a manifest has been accepted.

If an earlier explicit packing observation already froze the same units, its
observation ID and provenance remain unchanged. A later authentic carrier event
is recorded separately after checking the original packing confirmation,
allocation digest, parcel revision, source identity and label binding. Changed
bindings still block the event; the carrier observation cannot silently replace
a different package's packing history or apply the allocation effect twice.

Once durable manifest membership exists, packing cancellation cannot release
those allocations. Manifest withdrawal and repair that require new physical
handling remain outside this bounded slice. A wrong or stale confirmation,
void-pending label, resource change, parcel change or source mismatch prevents a
new manifest. Historical source observations retain their original identifiers.

## Storage and operator handling

Migration `033_shipping_batches.sql` adds four per-resource tables: label
operations, label approvals, manifest packages and manifest events. Each row has
tenant, store, resource and package IDs. Manifest parent payloads cannot expose
another customer because no shared mixed-customer body is stored; each package
retains its own command and the hash of complete membership. No session tokens
or session hashes are retained. Existing audit records use fixed operation
codes.

Subject export and erasure are integrated by the batch owner. Erasure retains
minimal original purchase and financial audit identifiers while scrubbing
private command, tracking and packing references and revoking approvals. All
service reads and writes authorize the resource before decoding its body; an
erased/redacted body cannot dispatch. Recovery quarantine and diagnostic restore
continue to block source mutations. The separate synthetic carrier database is
an external fixture artifact requiring explicit operator retention/deletion.

## Bounded evidence and qualification

The 20-case `tests/development/shipping-batches.test.mts` is part of the owner's
single focused development selection. It covers partial purchase, whole-batch
retry, reconstruction, exact money, authority/source/quote fences, void/refund,
packing, manifest/events, cancellation and populated subject export/erasure.
Two tests execute isolated source mutants: a regenerated purchase identity on
retry prevents repair, and setting carrier acceptance during manifest creation
fails the independent outstanding-parcel oracle. Neither test edits a returned
result to simulate a defect.

`tools/demo-shipping-batches.mts` runs only disposable synthetic databases and
prints the label, charge, packing and carrier-stage observations. It accepts no
provider or credential option. Authors defer all execution to root's bounded
coherent candidate run; actual evidence and reviews are separate handoff files.

Original connected positive cases use explicitly named local counterparts;
connected carrier purchases, supported manifest integration, native refund
records and physical pickup/acceptance observations remain unperformed. M07-G99
and M08 dependency acceptance remain blocked. No local case accepts these goals
or authorizes production, publication or release.

For rollback, preserve original databases and source identity. Code rollback
does not undo fixture charge/manifest observations. Do not drop operation rows
or reset IDs to make an unknown result purchase again. Look up original IDs;
missing provider/source evidence remains unknown.
