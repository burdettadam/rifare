# Location inventory and transfers

M08-G08/G09 add local source-owned stock accounting under ADR-0037. The original
warehouse fixture remains the sole available-stock owner. Its return restocks,
native receipt/disposition corrections and inventory transfer journal use the
same database and durable identity. These are synthetic source observations;
they do not establish warehouse connectivity, physical movement or formal goal
acceptance.

## Balance and source history

`WarehouseInventoryFixtureSource(existingWarehouse, {clock})` wraps the canonical
warehouse source. `position({variant_id,location_id})` reads available, on-hand,
reserved and in-transit fields in one SQLite statement. Available is the original
stock row. On-hand adds active reservations to that available quantity. Transit
belongs to the origin until a receive or loss event explains it.

`snapshot({observation_id,resource_id,variant_id,location_id})` captures an absolute
observation and all original movement IDs already included, in one source
transaction. `recordMovement({movement_id,resource_id,variant_id,location_id,kind,
quantity_delta,reference_id,linked_movement_id})` is trusted fixture administration
for independently observed receipts, adjustments and shipments. Receipt deltas
must be positive and shipment deltas negative. This is not a public commerce
adjustment endpoint. `movements`, `movement`, `snapshots` and `observation` only
read native history; they do not execute an effect.

The wrapper projects existing return disposition effects and native return-event
adjustments using distinct namespaces. A correction links the actual ancestor
movement for the same unit, including when intervening inspection events had no
stock effect. Import does not restock the unit again.

`LocationInventory(kernel,source)` provides:

| Method | Result |
| --- | --- |
| `claim(scope,{resource_id,variant_id,location_id,source_identity,fields})` | Explicit owner for each of the four fields; conflicting owner claims append a discrepancy. |
| `importSnapshot(scope,observation_id)` | Append the exact native observation; only the first becomes an anchor. |
| `importMovement(scope,movement_id)` | Append the original source delta and digest once, preserving chain and anchor links. |
| `sync(scope,{resource_id})` | Import that authorized journey's existing observations and movements. |
| `balance(scope,{resource_id,variant_id,location_id})` | Shared physical-stock aggregate with explicit anchored state. |
| `history(scope,{resource_id})` | Authorized journey's owner, snapshot, movement and discrepancy bodies. |
| `discrepancies(scope,{resource_id})` | Retained discrepancies with current resolution state for snapshot/link differences. |

Each physical stock key is tenant/store/SKU/location. An order provides an
authorization and journey link; it cannot create another stock balance. A second
source claiming the same field creates a conflict instead of being summed. This
includes the separately owned replacement-fulfillment source.

Later absolute snapshots are compared with the movement set they cover. They
never add to stock or silently replace an earlier anchor. Out-of-order snapshot
imports compare using the differences between covered-ID sets. Missing ledger
links remain explicit until their original source observations are imported.
Already-covered movements retain their history but contribute no second delta.

## Transfer lifecycle and authority

`InventoryTransfers(kernel,inventory,source,{deadline_ms})` keeps the original
source, transfer and operation IDs. `plan` takes transfer/resource/SKU/from/to/
quantity and creates no source effect. `propose` takes a current revision and a
new operation ID, kind and quantity. `approve` binds an independent current
owner/reviewer to the exact command digest and expiry. `dispatch` performs the
approved command; `reconcile` looks up that same native operation. `read` reports
the transfer quantities and every original operation state.

For five units at an origin with ten available and zero at the destination:

| Stage | Origin available | Origin on-hand | Reserved | In transit | Destination available |
| --- | ---: | ---: | ---: | ---: | ---: |
| Plan | 10 | 10 | 0 | 0 | 0 |
| Reserve 5 | 5 | 10 | 5 | 0 | 0 |
| Dispatch 5 | 5 | 5 | 0 | 5 | 0 |
| Receive 3 | 5 | 5 | 0 | 2 | 3 |
| Record loss 2 | 5 | 5 | 0 | 0 | 3 |
| Correct 1 from that loss | 5 | 5 | 0 | 0 | 4 |

The last row retains one lost unit. Received plus in-transit plus lost always
equals dispatched. Release returns only undispatched reservations to origin
available. A correction names one earlier loss receipt; multiple loss receipts
need separate corrections.

Current `action.execute` and `operation.dispatch` are required in addition to an
independent approval. Execution also rechecks the resource digest, source
positions, transfer revision, approver's current authority and expiry, named
warehouse disposition stop, and recovery/migration fences. These checks repeat
inside the actual source callback after the command is durably marked unknown.
The used approval permits only that original send. The native source atomically
rechecks its positions and transfer revision.

A lost response or pre-effect timeout remains unknown. Dispatch never sends an
unknown command again. Reconciliation looks up its original identity, validates
the native transition and movement receipts, then imports those existing
movements. An absent result stays unknown. A pending operation blocks subsequent
transitions for that transfer. Stale proposed commands have no automatic refresh
or cancellation API in this bounded implementation.

## Privacy and recovery

Migration 035 adds seven scoped commerce tables. Subject export and minimization
are integrated by the batch owner. Stock movements retain a separate chain
digest over `inventoryMovementCore`, which contains quantitative fields and
stable source identities. Snapshots retain `inventorySnapshotCore` and its
quantitative digest. These minimal stock cores survive removal of personal
journey and evidence details; another order can still read the shared aggregate
without seeing an erased subject's history. Direct erased-resource access remains
blocked. Digests are integrity checks, not external source authentication.

Imports require both reconciliation permission and `event.process`. Restore
quarantine therefore blocks canonical observation writes, plans, approvals and
dispatch. Native lookup remains read-only, and recording its receipt waits for
write-enabled recovery state. Preserve source databases, original operation IDs,
covered IDs and quantitative audit cores when rolling back. Never clear an
unknown operation or re-key a transfer to force execution. External fixture
databases and caller copies require separate operator cleanup.

## Focused development evidence

The shared file has 22 native cases: nine for inventory and thirteen for transfers.
It includes literal stock/conservation oracles, owner conflict, covered anchors,
restart replay, shared stock across resources, drift, scope and integrity,
approval/current authority, unknown-before/after/timeouts, loss correction and
release. Two cases execute isolated changed product/source modules containing
the specified absolute-snapshot and destination-at-reservation faults.

The original `PORT-025` remains unchanged. The distinct
`PORT-025-M08-G09-DUPLICATE-PARTIAL` extension observes duplicate partial transfer
receipt without overstating destination quantity. Connected scanner and warehouse
qualification remain unperformed.

Use the ordinary development runner when the integration owner selects this
whole file. The author did not execute tests or the local demo independently:

```sh
python3 tools/dev_tests.py --files tests/development/location-inventory.test.mts
node --experimental-strip-types tools/demo_location_inventory.mts
```

The default 60-case, four-file, 60-second invocation limits remain unchanged.
Actual integration results and independent reviews are recorded with the final
candidate, rather than inferred from this guide.
