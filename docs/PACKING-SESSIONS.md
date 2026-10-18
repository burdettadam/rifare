# Packing sessions and partial shipments

The local M08-G03/G04 implementation keeps explicit order-line unit identities,
scanner observations and operator confirmation. It allocates only units still
available after earlier packages, source cancellations, backorders and observed
shipment. This is synthetic development under ADR-0036; hardware, browser,
warehouse and physical receipt qualification remain open.

## Source and authority

`new PackingSessions(kernel, carrierQuoteFixtureSource)` uses the existing G01
parcel source and the current canonical order's `payload.packing` facts. It adds
no alternate order ingestion, provider or inventory settlement engine. The
kernel's `resource.ingest` action establishes source facts; an ordinary scan does
not modify them. Expected lines have this form:

```json
{
  "packing": {
    "cancelled": false,
    "lines": [{
      "line_id": "line-a",
      "sku": "sku-a",
      "quantity": 3,
      "cancelled_ordinals": [],
      "backordered_ordinals": [],
      "shipped_ordinals": [],
      "return_links": [{"ordinal": 1, "return_id": "return-original"}]
    }]
  }
}
```

Every scan and allocation identifies a specific line and ordinal; a matching SKU
alone cannot fill a different line. Source exclusions cannot overlap. Return
references stay attached to their original unit as lineage, without authorizing
refunds, stock changes or return outcomes. Packages bind the source identity,
order revision/digest and G01 parcel revision/digest. A changed order or parcel
requires review and a fresh package session; it cannot reuse an old confirmation.

Reads require current `operation.read` and `resource.read`. Mutations additionally
require `warehouse.receive`; a synthetic shipment observation also requires
`operation.dispatch`. The authenticated actor supplies operator attribution.
Customer, model output and request fields cannot supply it. Existing tenant,
resource, erasure and recovery guards apply on every call, including retries.

## API

| Method | Input or result |
| --- | --- |
| `open(scope, input)` | `{session_id, package_id, resource_id, units:[{line_id, ordinal}]}` reserves available units atomically. |
| `scan(scope, input)` | `{session_id, scanner_id, scan_id, line_id, ordinal, sku}` records an accepted unit or a named discrepancy. |
| `read(scope, sessionId)` | Counts, missing units, per-line reconciliation, unit lineage, discrepancies and confirmation state. |
| `confirm(scope, input)` | `{session_id, expected_revision}` requires exact completed counts, current facts and an authorized operator. |
| `remaining(scope, resourceId)` | Current available units, allocated/shipped/cancelled/backordered counts and source revision. |
| `cancel(scope, input)` | `{session_id, expected_revision}` releases eligible unshipped reservations and preserves shipped identity. |
| `observeShipment(scope, input)` | `{session_id, observation_id}` records an explicit operator **fixture** observation after confirmation. |
| `qualifiedPackage(scope, packageId)` | Trusted current package/resource/session identity, confirmation, revisions, allocation digest, per-line quantities and eligibility. |

`qualifiedPackage` is the synchronous service boundary used by manifests. It
rechecks stored counts against accepted scan rows and unit allocations, checks
the confirmation, and reevaluates the current order and parcel. It returns
`qualified:false` with a reason for stale/unconfirmed/cancelled packages. Scope,
erasure and integrity failures raise errors. Missing packing sessions raise
`PACKING_SESSION_NOT_FOUND`. No caller-provided packed or approved boolean grants
eligibility. The `revision` field is the packing revision; `package_revision` is
the pinned G01 parcel revision.

## Replay, conservation and cancellation

The scanner's stable `(scanner_id, scan_id)` pair hashes to one scoped durable
identity. Its original command digest persists across service restarts. An exact
retry returns the original outcome without increasing the count; a conflicting
command for that same identity fails. A different scan identity for an already
scanned unit records `duplicate_unit`. Wrong SKU and unexpected/excess ordinal
scans become discrepancies and leave counts unchanged. Each read reconciles the
stored counter, accepted scan records and scanned allocation flags.
The session admits at most 2,048 distinct scan records; an existing scan identity
can still be replayed at that limit.

One scoped package ID retains its original session after cancellation, and a
partial unique database index permits only one active or shipped allocation for
each order/line/ordinal unit. A new request or session ID cannot allocate the same
reserved unit again. Cancellation of one unshipped package leaves other shipped
allocations intact. Cancelled and backordered source units remain unavailable;
unknown source units remain reserved for reconciliation. Returned-line references
remain on retained allocation records and any later eligible allocation.
Durable manifest membership also blocks cancellation, including when source
acknowledgment is unknown. Its parcel might already be in carrier custody; this
slice provides no withdrawal workflow that could authorize releasing its units.

`observeShipment` makes only the explicitly labeled local operator fixture stage
immutable for allocation purposes. Carrier manifest acknowledgment, pickup,
acceptance and physical delivery are separate shipping observations. No packing
method calls a carrier, purchases a label or updates available inventory.

## Storage and privacy

Migration `032_packing_sessions.sql` adds four scoped tables: sessions,
allocations, scans and confirmations. Every row has a canonical `resource_id`
subject link. Private SKU, line/ordinal, operator/scanner IDs, return references
and source pins live in a JSON `body` with an integrity digest. The integration
extends `PrivacyLifecycle` to export those rows under `packing_records` and
minimize their bodies on erasure while preserving operation/scan/unit identities,
states and counters. A digest detects accidental corruption; it is not an
external attestation or anonymization claim. Erased resource guards prevent
retained confirmations from authorizing further work.

The existing recovery quarantine blocks writes. Restored durable reservations
and scan identities remain fences against duplicate allocation or count. A
reconstructed G01 fixture source has a different identity, so earlier package
confirmations do not acquire new source authority. This local source identity
check does not qualify a connected restore or independent host.

## Focused evidence and operation

The new whole file has 18 native cases. Tests were committed before product
implementation; execution belongs to the integration owner's single bounded
selection. The two required faults run actual altered module source in isolated
temporary directories. One moves the counter increment before scan-key dedupe;
the stored reconciliation detects the resulting replay error and rolls back.
The other treats every original eligible unit as available for the next package;
an independent expected remaining count detects the overstatement. Neither fault
edits returned JSON or counts a setup error as behavioral evidence.

```sh
node --experimental-strip-types tools/demo-packing-sessions.mts --describe
node --experimental-strip-types tools/demo-packing-sessions.mts --run-local
python3 tools/dev_tests.py --files tests/development/packing-sessions.test.mts
```

The demo uses disposable in-memory data and shows duplicate replay, a partial
count, explicit confirmation, two split packages and cancellation after a
synthetic shipped observation. The permanent `PORT-025` case preserves correct
partial counts and no inventory overstatement at this local scanner boundary.
The original connected partial-receive and browser/scanner hardware requirements
remain unperformed. Do not run broad regressions merely to repeat this demo.

For rollback, retain the source checkpoint and all four tables. Do not erase
scan, package or allocation identities to resolve an error, and do not modify a
completed shipment into an unshipped allocation. Inspect discrepancies and source
revisions, cancel an eligible unshipped session when appropriate, and create a
new package identity. No destructive down migration is provided.
