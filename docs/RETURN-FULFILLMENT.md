# Replacement inventory and return shipping

M03-G11 through M03-G15 add synthetic source-backed inventory reservations,
approved replacement records, label rating/purchase, independent void/reimbursement
states, and carrier tracking. The application remains a SQLite diagnostic, with
no live carrier/shop credentials, network transport or physical warehouse access.

## Run

```sh
npm ci --offline --ignore-scripts
python3 tools/verify.py --runtime --harness
node --experimental-strip-types tools/demo-return-fulfillment.mts
```

The demonstration creates separate in-memory application, resolution-fixture and
fulfillment-fixture databases. It prints no credentials, needs no model or API key,
and makes zero external calls. The full regression suite additionally requires
the existing host Playwright/Chromium installation. No dependency was added.

## Canonical implementation

| Responsibility | Source |
| --- | --- |
| Shared configuration, exact quote and gateway contract | `packages/commerce/return-fulfillment-core.mts` |
| Reservation generation, reconciliation and release | `packages/commerce/replacement-inventory.mts` |
| Replacement quotation from an existing exchange | `packages/commerce/replacement-orders.mts` |
| Versioned parcel, rate preview, void quotation and label lineage | `packages/commerce/return-labels.mts` |
| Persist-before-send, bounded dispatch and read-only reconciliation | `packages/commerce/fulfillment-execution.mts` |
| Carrier events and separately evaluated policy trigger | `packages/commerce/return-tracking.mts` |
| Separate authoritative synthetic stock, holds, orders and charges | `packages/adapters/fulfillment-fixture-source.mts` |

Migration `016_return_fulfillment.sql` retains all earlier tables and migrations.
The existing gateway still supplies exact-preview approval, separate reviewer,
current permission checks, case/worker fences and one-use execution. Skills,
external clients and future models have no alternate authority path.

## Inventory and replacement lifecycle

A current stock-aware exchange quote identifies the variant, quantity, original
value, catalog version and configured inventory buffer. A bounded reservation is
written locally as unknown before a separate source transaction tries to reserve.
Two cases may compete for the same last unit. Source capacity includes active,
unexpired reservations; replacement commit consumes that hold and decrements
stock together. Local state declares `fixture_native_only`, never ownership of
stock in a live store. A production adapter without a reliable reservation/commit
contract must remain unsupported rather than relying on a cached stock count.

Generation, expiry, source identity and expected location are checked. Expired
reservations require reconciliation before a new generation. Released generations
cannot commit. A replacement operation prevents release/reallocation until its
outcome is established. An ambiguous reserve is not treated as available stock.

Only supported equal-value variant replacements can proceed. Preparation binds
the original order and native-return lineage, allocation, reservation, current
source facts, settings and policy. Creation requires one exact approval and an
actual matching fulfillable source record; a successful zero-dollar response is
insufficient. `created` and `shipped` are independent. A lost response after source
commit stays unknown locally, then reconciles without another order or decrement.

## Labels, charges and reimbursement

Parcel configuration pins opaque address references, address revision, package
measurements and service. Rating reads the separately configured carrier account's
fixture rate: it creates no charge or label and changes no source database state.
Purchase requires a current rate and separate exact gateway approval. Source
rate/parcel/account identity, expiry and price are rechecked before recording the
label and charge references. Unknown purchases cannot be repeated under a new key.

A void request is not confirmation and is not reimbursement. Both the void stage
and reimbursement stage remain visible. An unused label whose void is rejected
remains usable until its original expiry; rejection cannot qualify a replacement.
A confirmed void or explicit source-confirmed unused expiry permits a separately
approved replacement label even when reimbursement is pending. Every replacement
retains `replaces`/`replaced_by`; a later reimbursement for the old label cannot
change the current-label pointer. Only a matching source reimbursement reference
and amount set `reimbursement_counted=true`.

A missed intermediate void acknowledgment may be recovered only through the
already-recorded matching void operation's confirmation. It does not authorize
inferring a refund from local expiry. There is no automatic promise that a carrier
will accept cancellation or return funds, and no synthetic charge is real money.

## Tracking and policy

Source event identities, sequence numbers, timestamps and record versions are
validated and deduplicated. Older snapshots cannot regress delivery, and an
exception retains observed delivery history without implying successful receipt.
Wrong-label or wrong-source records cannot update a different case. Clients cannot
inject carrier events through the HTTP surface.

The purchase pins the configured resolution trigger. Changing store defaults
cannot reinterpret old labels. A trigger is eligible only with current matching
configuration and nonrevoked case policy. Eligibility is an observation requiring
separate approved resolution, never execution authorization. Carrier delivery
leaves warehouse receipt/inspection pending and inventory disposition unrecorded;
those workflows belong to M03-G16 onward.

## HTTP and clients

[The input contract](../packages/commerce/contracts/return-fulfillment.v1.json)
lists authenticated `/v1/fulfillment/*` actions. Startup accepts an optional
server-owned `fulfillmentSource`; default `tools/dev-commerce.mts` does not provide
one. Requests therefore cannot choose a source, inject credentials, configure a
carrier, or cause a live call. `/v1/fulfillment/contract` is readable by an existing
authenticated session. Preview/approval/execution use the existing
`/v1/execution/preview`, `/approve`, `/execute` routes. No provider thread, agent
SDK or particular model is part of the protocol.

Real loopback HTTP tests cover both replacement and label flows, disabled source,
cross-store access, untrusted price fields, customer permissions and event-injection
rejection. This batch adds no new browser UI or browser qualification claim.

## Privacy, recovery and limits

Address references stay in erasable parcel and quote records; immutable operation
commands retain hashes and minimized reconciliation IDs rather than address
references. Customer export includes attributed fulfillment records. Erasure
scrubs new customer-linked bodies and denies further case access while retaining
minimized operation/event evidence. The separate fixture source has its own data
lifecycle; caller memory, external sources and old backups require separate cleanup.
Logical erasure is not forensic erasure or a compliance certification.

Use current stop controls and read-only reconciliation before restoring or resuming
operations. Never delete original IDs or unknown outcomes to unblock work. Keep
both source and application ledgers, schema migrations and source identities when
recovering diagnostic fixtures. New reservations and dispatch remain denied by
existing backup-recovery guards. A process timeout does not cancel an effect
already accepted by its source.

The source fixture's one-effect results are conditional on its tested transactional
and idempotency contract, not a universal exactly-once or multi-channel inventory
guarantee. PostgreSQL/React, carrier accounts, native platform inventory/fulfillment,
carrier webhooks, print-ready labels and live settlement remain unqualified.
