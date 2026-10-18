# WooCommerce composed returns — local fixture contract

This is the bounded M07-G01/G03 development slice assigned by ADR-0031.
It keeps actual WooCommerce source identity and common Rifare case, policy,
approval and receipt behavior. Connected-store qualification remains blocked.

## Source and authority

`WooReturnFixtureSource` stores versioned order, refund, delivery and original
payment observations in a separate SQLite database. `WooReturnSources` attaches
that server-owned source and binds the complete snapshot to an order whose
`source_system` remains `woocommerce`. A source revision or canonical payload
change invalidates an old preview. An ordinary source refresh preserves the
case's policy and skill pins; changed facts require a fresh quote.

The wire order and refund subset uses the existing `normalizeWooOrder` checks.
The explicit fixture fulfillment contract supplies delivery and item history;
`completed` order status does not substitute for delivery evidence. Original
paid units are pinned to one card instrument, gateway account and transaction.
Missing or inconsistent history blocks the return. This declared subset is
domestic USD refunds; exchange, warehouse and native return creation are unavailable.
Those are limitations of this fixture contract, not universal platform claims.

After the existing gateway consumes an independently approved preview, the
canonical `commerce_return_requests` row is accompanied by a
`commerce_woo_rma_bindings` record in the same transaction. This is a
`composed_local_rma`; `native_return_id` is null. No fake Shopify fulfillment
line or native-return row is created. Local requests reserve item quantities.
The RMA carries no payment-settlement or physical-receipt claim.

`assertWooReturnFacts(kernel, session, order)` verifies source/account/contract,
canonical payload and source revision against the attached independent source.
`wooReturnAuthority(kernel, session, requestId)` verifies the RMA and original
gateway receipt for the finance module. It never manufactures native authority.

## Local fixture use

The checked-in helper `tests/development/woocommerce-return-helpers.mts` exports
`wooReturnFixture()` and `wooSourceFixtureInput(now)`. It uses the actual archived
`handle-return` skill, existing published policy, customer proof and gateway.
The returned fixture exposes `source`, `sourceDb`, `woo`, `binding`, `order`,
`caseId`, `selection`, `quote`, `prepare`, `submit`, `publish` and `cleanup`.
Its separate source `records()` gives the independently inspectable wire records,
version/digest history and zero native return-create effects.
Effect counts are calculated from independent `woo_fixture_effect_records` rows;
the fixture source has no return-create operation. A sentinel test proves the
oracle observes a directly inserted effect rather than returning a fixed zero.

```sh
node --experimental-strip-types --test --test-concurrency=1 tests/development/woocommerce-returns.test.mts
```

The source has no default network client, live mode or credentials. Restoring a
core database does not authorize writes: its server-owned source must be attached,
with matching identity and account, and current facts must validate again.
Core/source separation checks both SQLite paths and filesystem device/inode
identity. A differently named hard link or symbolic link to the core database
does not qualify as independent source storage.

## Woo order events

`verifyWooCommerceWebhook` verifies the exact raw-body HMAC and validates the
declared Woo headers before durable acknowledgement. Only local fixture hosts
and the `wc/v3` route contract are configured. Because Woo's HMAC does not cover
routing or delivery headers, the inbox record starts quarantined.
`WooOrderEvents.process` then corroborates the entire order body against the
attached independent source for the same tenant, store and account before
refreshing canonical facts. Its separate observation records the source revision,
wire digest and resulting canonical version. The observation grants no financial
authority or permission for a new write.

Duplicate event IDs reuse that observation. A different delivery ID for the same
source snapshot does not increment the canonical version. Conflicting deliveries,
old source snapshots, unsigned bodies and mismatched routing do not alter the
bound order or create a return. The helper
`tests/development/woocommerce-event-helpers.mts` exports `wooEventFixture(f)`;
it uses owner authorization for route management and existing operator authority
for source processing. Permanent cases are in `woocommerce-events.test.mts`.

## Wire references and qualification limits

Consulted 2026-10-18:

- [WooCommerce v3 orders](https://developer.woocommerce.com/docs/apis/rest-api/v3/orders/)
  documents numeric order/item identifiers, decimal-string totals, payment method,
  transaction ID and order status fields used by the normalizer.
- [WooCommerce v3 order refunds](https://developer.woocommerce.com/docs/apis/rest-api/v3/order-refunds/)
  distinguishes refund record fields and API refund behavior. The existing reader
  retains `settlement_verified:false` for both manual and gateway-reported records.
- [WooCommerce webhook source](https://github.com/woocommerce/woocommerce/blob/trunk/plugins/woocommerce/includes/class-wc-webhook.php)
  describes raw-body HMAC and delivery headers; connected account ownership and
  concrete installed API/plugin versions are separate qualification obligations.

`wc/v3` is the documented route namespace, not proof of an installed WooCommerce
release. Fixture version `woocommerce-rma-fixture-v1` is a Rifare test contract.
No merchant store, gateway or physical fulfillment has been observed by this work.

## Recovery and review

Migration 030 adds source bindings, local RMA bindings and event observations.
Keep original request/receipt identities when recovering. Preserve independent
native observations; never retry an unknown money operation from a new RMA.
Root integrates the financial, notification, privacy and runtime seams and owns
the complete native gate plus independent authority and regression reviews.
