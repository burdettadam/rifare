# Shipment and return inventory reconciliation

`InventoryReconciliation` prepares M08-G10 against separate synthetic warehouse
and carrier databases. It joins the existing packing, label, manifest and return
services to `LocationInventory`. It records no physical effect and creates no
alternate shipment, return or transfer executor.

## Inspect and repair

Construct the service with the existing kernel, location inventory, warehouse
return events, packing sessions, shipping labels and shipping carrier source.
`inspect(scope, {resource_id})` returns current expected/observed positions,
source-linked packages, partial return quantities and an explicit discrepancy
list. The inventory source must share the return source's database and identity.

`repair(scope, {resource_id})` imports only already recorded native return
events, snapshots and movements. Missing local history can thereby become
complete without repeating stock or carrier operations. An unexplained native
stock change remains unresolved; the service cannot manufacture an adjustment
to make the report green. Carrier event import remains the existing
`ShippingManifests.observe` operation with its current authority checks.

All reads bind the tenant, store and order resource and enforce erasure. Repair
also checks reconciliation, warehouse receiving and event-processing authority.
Recovery quarantine prevents that write path. Unknown transfer, disposition or
carrier effects retain their original identities in their owning service.
An applied warehouse disposition is unresolved until its canonical operation,
unit claims and original applied observation agree. Its owning
`ReturnDisposition.reconcile` operation observes a lost response; this report
cannot turn the source effect alone into a completed canonical operation.
Every native return event and disposition is checked, including delivery and
quarantine observations with no stock delta. An unknown request or mismatched
native return blocks repair before any import.

## What a matched cycle means

The independent partial-cycle fixture begins with ten hats and ten shoes at one
warehouse. One hat and one shoe are packed in a single package. A separate
native carrier acceptance event names the original label and manifest. Two
native warehouse shipment movements deduct one unit each and reference that
event. A partial return receives and restocks the hat. The expected final
available quantities are ten hats and nine shoes.

An absolute snapshot is an inventory anchor, with the movement identities it
already covers. It is not another receipt. Subsequent source positions are
compared with the ledger's available, on-hand, reserved and in-transit quantities.
Missing movements, duplicate deductions, unrelated carrier references, wrong
quantities and unexplained stock changes remain visible.

Packing and manifest acknowledgment do not deduct inventory. Carrier acceptance
must have an original matching native event and canonical event record, label,
resource, parcel revision, packing confirmation and unit allocation. Shipment
movements then explain the exact packed SKU/location quantities. A digest alone
does not establish these relationships.

Return observations preserve the native request, line, return-local ordinal,
variant, location, grade, source event and disposition. The original order unit
is resolved through explicit packing return links; order and return ordinals
are not interchangeable. Partial receipt may reconcile observed stock while
other requested return units remain pending. The result's
`partial_return_reconciled` state does not close the return or establish refund,
full receipt or partner qualification.
Requested quantities come from the canonical return selection even when no
receiving session exists. A matched shipment with an unreceived requested return
has state `return_pending`. Corrections that move a restocked unit have separate
deduction and addition identities; incompatible canonical location or item
mapping remains an explicit discrepancy.

## Evidence and operation

The thirteen local cases have distinct G10 preparation IDs. They cover the known
partial cycle, missing-history import, real unexplained drift, duplicate and
unlinked deductions, packing/carrier distinctions, shuffled/retried history,
integrity, current scope, linked correction, subject erasure and an executed
changed-source fault that improperly reports a stock difference as green.
Root selects this whole file with the other two new files and retained privacy
coverage, within the unchanged 60-case/four-file/60-second development profile.

The optional `tools/demo-inventory-reconciliation.mts` command uses disposable
synthetic fixtures. It accepts no provider, credential or network options. Its
output is a caller-owned copy; a later erasure cannot recall already copied
reports. Stock and effect identities remain in minimized canonical audit,
while separate fixture databases require independent cleanup.

If a transfer commits but its response is lost, and the subject is erased before
the movement is imported, the shared canonical balance may remain stale.
Erased-resource guards block this batch's import and transfer-reconciliation
APIs. This case requires operator reconciliation under the preserved privacy
constraints; automatic post-erasure repair is not implemented. Keep the original
effect identity and resolve the missing observation before another dependent
transfer. Creating a replacement operation would risk repeating the stock effect.

Original connected G10 evidence and formal prerequisites remain blocked. Read
[the M08 assessment](M08-QUALIFICATION.md); a focused local pass does not replace
its milestone requirements. Roll back source with native Git only after
preserving the additive schema and original effect identities. Never restore an
older snapshot to justify reissuing an uncertain physical effect.
