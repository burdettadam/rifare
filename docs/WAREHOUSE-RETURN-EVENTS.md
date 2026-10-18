# Warehouse return event preparation

M08-G07 adds local synthetic return-event intake under ADR-0037. It does not
qualify a connected warehouse, a partner account or physical merchandise. The
original connected case IDs and M07-G99 prerequisites remain unperformed.

## Native observation and canonical receipt

`WarehouseFixtureSource.recordReturnEvent(input)` records a native fixture event
in the independently owned warehouse database. Its body retains the source,
tenant/store, return/request/resource, original event ID, per-return sequence,
location, operator and partner evidence references, declared completeness and
correction parent. Units have canonical line/ordinal identity, observed variant,
grade, received status and disposition. Delivery has no units.

`returnEvent(eventId)` and `returnEvents(nativeReturnId?)` read immutable original
event identities with verified body and input digests. Native replay returns the
original record. A reused identity with changed input, a sequence jump, a stale
correction parent or a second unlinked receipt is rejected. A linked correction
can change the effective received quantity, grade, location or disposition.

`WarehouseReturnEvents.importEvent(scope,{request_id,event_id})` imports an existing
native observation. It requires current warehouse settings, matching native source
identity and scope, current receive permission, execution controls and the exact
canonical native return. It never calls the source recording or disposition
executor. Partner evidence references remain untrusted provenance; they are not
treated as clean commerce uploads or independent physical attestation.

The existing `ReturnReceiving.open`, `close`, `read` and `review` remain the session
API. Import opens a session if necessary and appends the first mapped raw unit and
source scan. Raw scans and received-unit bodies keep their immutable triggers.
Subsequent inspection/correction projects the effective unit from the additive
event log. Session revision and receipt digest include the imported history, so
a correction invalidates previous receiving review and disposition approval.
New disposition quotes use the effective grade and received status.

Imports may arrive in a shuffled order. Only a contiguous original sequence is
projected; missing events remain explicit until those exact events are imported.
Wrong location, variant or unit mapping stays discrepant without creating
inspected quantity. Declared event completeness does not fill missing merchandise.
Delivery alone leaves the session unreceived and inspection pending.

## Stock and duplicate protection

The warehouse's existing `warehouse_stock.available` remains the stock owner.
Native disposition records apply signed adjustments once and preserve original
source event, parent and unit references. A correction from restock to quarantine
removes that unit from available stock once. Removing a formerly received,
restocked unit does the same. Replaying the native event or its commerce import
does not adjust stock again. Reserved and in-transit quantities are untouched;
the inventory wrapper observes the same available/on-hand delta.

The existing native per-unit disposition fence is shared with `ReturnDisposition`.
An externally disposed unit cannot be restocked again through a local quote or
source call, including after a linked correction removes its availability. The
source checks its effective receipt before applying a later local disposition.
This fixture rejects a correction that would cross a previously applied local
disposition; resolving that case requires original-source reconciliation and is
not synthesized from a new event ID.

## Storage, recovery and qualification

Migration `034_warehouse_return_events.sql` adds one scoped commerce event table.
Shared integration owns its export, minimization and restore classification.
Separate fixture tables `warehouse_return_events` and `warehouse_return_units`
belong to the native warehouse source; erasing a commerce subject does not erase
that external source or earlier caller copies. Existing raw receiving records,
stock identities and effect fences must be retained through recovery.

Rollback must preserve the source event journal and warehouse stock/effect
identities together with the commerce checkpoint. Do not discard the event table
or project an older receipt while retaining newer source stock. A prior binary
that cannot interpret effective corrections must not resume disposition writes.

Sixteen local behavioral cases are bound to
`tests/development/warehouse-return-events.test.mts`. Tests were committed before
implementation. The named fault executes isolated modified warehouse source code
that invents a restocked unit from delivery, then demonstrates that the unchanged
stock oracle rejects the result. It does not mutate copied output or count a
setup failure as proof. Actual selected native results and independent reviews
belong to the exact integration candidate's evidence, not this guide.

The local demo is `tools/demo-warehouse-return-events.mts --run-local`; `--describe`
prints its declared scope. Both require the existing supported Node runner. The
author has not run the demo or an independent test campaign. Development retains
the owner's single coherent 60-case, four-file, 60-second selection.
