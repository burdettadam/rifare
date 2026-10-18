# Warehouse connector preparation

M08-G06 adds the explicitly named **Rifare warehouse fixture connector 1.0.0**
under the existing `rifare-order-edit-fixture-v1` API contract. It is a separate
synthetic warehouse database. No WMS/3PL account or transport is connected, and
the original connected positive goal remains unperformed.

## Observed behavior

`WarehouseConnector` provides server-local configuration, readiness inspection
and a rollback-only canary. The canonical `OrderEdits` service still owns the
quote, independent reviewer approval, durable operation, reconciliation and
release workflow. There is no second edit engine or new HTTP action.

A binding pins the warehouse, source identity, connector/API versions,
workflow revision, configuration revision and digest, callback connection and a
bounded callback observation age. Version changes outside the named fixture
contract are rejected. A configuration change advances the source revision,
invalidating existing prepared edits. Callback disconnection or expiry blocks
new effects even if no configuration revision changes.

The canary exercises picking before a hold, actual hold creation, blocked
picking and consumption of an updated order version **and exact payload digest**.
It rolls back every canary row and hold. The synthetic `transport_only` mode
acknowledges transport while ignoring the hold/update; `ignore_updates` holds
successfully but does not consume the final payload. Both fail readiness.
An HTTP acknowledgment is never a positive business observation.

M04 dispatch also verifies source-owned hold and consumed-payload records before
confirming the corresponding receipt. The same consumption implementation serves
the canary and actual synthetic sync. Unknown results retain their original step
identity; source lookup may repair an old receipt after callback loss, but it
cannot grant a new dispatch or release. Foreign holds remain independently owned.

## Local use

The existing native development runner selects the thirteen cases in
`tests/development/warehouse-connector.test.mts`. The batch runs them together
with shipping, packing and the existing privacy file inside the unchanged
60-case/four-file/60-second limit.

```sh
node --experimental-strip-types tools/demo-warehouse-connector.mts --describe
node --experimental-strip-types tools/demo-warehouse-connector.mts --run-local
```

The local demonstration creates disposable synthetic records, configures the
named connector, obtains the existing reviewer approval, observes hold/update
and release, then changes workflow configuration and shows stale-edit rejection.
It accepts no credentials, remote URLs or provider flags.

## Data, restore and qualification

The new binding table resides in the already separate order-edit fixture
database. It contains server configuration, source identity and callback timing.
The existing source also retains synthetic orders and effect receipts. Commerce
subject erasure cannot physically delete those independent copies; the owning
operator must discard the fixture directory. The facade reauthorizes resource
reads and rejects erased subjects before returning a warehouse copy.

Existing merchant import and snapshot restore quarantine all execution.
Configuration and readiness probes also require the existing egress guard.
These observations provide local development evidence only. Real transport,
warehouse staff, scanner, stock reconciliation, target hosting and physical
picking/shipping behavior require separately authorized current qualification.
Changing back to an old workflow does not reactivate an old approval; configure
and refresh the canonical workflow with current facts.

Rollback preserves source, native operation identities and minimized audit.
Do not drop the new business tables to downgrade an active dataset; retain the
checkpoint and use an explicitly reviewed migration path.
