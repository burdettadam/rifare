# Synthetic checkout previews

Rifare can now prepare, look up and revalidate a frozen checkout preview from its
existing shopping cart and catalog owners. The preview binds exact items, prices,
tax, shipping, fees, terms, source revisions and the current authenticated customer
to an original server-generated ID and expiry. This is the local synthetic
preparation slice assigned by [ADR-0067](decisions/0067-native-checkout-previews.md).

## Native ownership

`CheckoutPreviews` uses the real `ShoppingCart.readCart` and `currentPreview`
methods. It requires the existing `growthCustomer` proof checks and
`assertRecoveryEgress` fence on every observation. It reads the current cart and
quote sources again after its final asynchronous boundary before retaining or
returning a preview. Another tenant, store, customer, order, operator or agent
scope cannot read a customer's preview.

The current cart contract uses an existing order resource and explicit customer
confirmation. A cart confirmation is not checkout execution. A changed price or
terms revision requires a new cart proposal and confirmation before a replacement
checkout preview can be issued. Stock loss, unknown cart commitment, a native
purchase observation or changed source ownership invalidates preparation.

The synthetic profile uses the authenticated store ID as its merchant ID. It
does not introduce another merchant identity or pricing authority.

## Explicit quotes and exact money

`CheckoutQuoteFixtureSource` holds explicit shipping and fee observations bound
to the same native cart, resource, customer, tenant, store, currency and confirmed
cart digest. The fixture administrator supplies each amount and its expiry. A
zero amount requires explicit zero evidence. Missing shipping or fee evidence
denies preparation; it never creates a free-shipping assumption.

Quote revisions cover the binding, amount, kind and validity interval. A changed
revision or expiry invalidates an older preview even if the total is unchanged.
Preview expiry is capped by both quote deadlines. Renewing a quote cannot extend
the original preview's identity or deadline.

Amounts use canonical decimal strings and BigInt arithmetic with the existing
24-digit bound. The catalog retains its own tax and supported-rounding rules.
The composer validates line membership and arithmetic before adding shipping and
fees; it uses Rifare's existing canonical JSON and digest functions. The fixed
independent source ledger protects the complete item facts and the original
USD 68 vector. Native fixture cases also exercise the USD 68 lamp and a sourced
USD 81 total against an USD 80 ceiling. That ceiling comparison is an amount
precheck and never a delegated permit.

## Server-owned lifetime and storage

The service exposes these local methods:

```ts
const previews = new CheckoutPreviews(kernel, carts, quoteFixture);
const preview = await previews.prepare(customerScope, {
  cart_id: confirmedCartId,
  shipping_quote_id: shippingQuoteId,
  fee_quote_id: feeQuoteId,
});
await previews.read(customerScope, preview.preview_id);
await previews.revalidate(customerScope, preview.preview_id);
previews.close();
```

Both lookup methods require an owner-created ID. Caller-supplied serialized
preview objects cannot replace the stored snapshot. Results and nested values
are detached and frozen; configuration and dependency functions are captured at
construction. Safe integral clocks must move forward at every boundary, including
after final hashing. Expired work cannot be returned after a slow observation.

The default lifetime is 60 seconds and the configured maximum is ten minutes.
An owner retains at most 128 previews and counts pending preparations against
capacity. Failed requests release their reservations. The separate quote fixture
holds at most 256 observations. These process-local stores have no SQL table,
snapshot import, canonical export or restart recovery. Restart loses preview
IDs. Expiry is enforced and records are swept on access; `close` clears the owner.
This is logical expiry, not a guarantee of physical heap erasure at a deadline.

Preview records contain scoped IDs, monetary facts and terms digests. They omit
proof/session tokens, customer contact addresses and raw customer/source payloads.
Current revocation, proof changes, privacy erasure, store disablement and recovery
fences deny fresh disclosure. Previously returned values remain caller copies.
The existing [privacy coverage](PRIVACY-COVERAGE.md) classifications apply.

## Focused development verification

Run the existing cart suite together with the new composer and native integration
cases, within the ordinary development budget:

```sh
python3 tools/dev_tests.py --files \
  tests/development/delegated-checkout.test.mts \
  tests/development/checkout-preview.test.mts \
  tests/development/growth-shopping.test.mts
```

This selection contains 26 native checkout cases, 16 composer cases and the
unchanged 15-case shopping suite. Tests cover same-customer/different-order
isolation, current customer proof, revocation and erasure, authority/source loss
across awaits, stock/price/terms changes, exact source tax, explicit quotes,
capacity, original expiry and no new merchant effects. Authority is checked again
after final source callbacks and hashing, including a session that expires while
the preview itself is fresh. Session activity writes
from ordinary kernel authorization are not misrepresented as merchant effects.

The audit regressions first failed against the earlier staged composer. An
independent early review added final-hashing expiry and malformed-array cases;
both failed before their corrections. Source/test registration is additive and
`proposed_not_accepted`. See the [work record](../work/records/RCG-2-native-checkout.md)
for the exact candidate, commands, review findings and remaining limits.

## Remaining milestones

There is no new public route, purchase, payment, reservation or authorization
receipt consumer in this slice. Remote sender proof, the public delegated
authorization contract, real signature verification, durable final-use
redemption, merchant execution idempotency and an independent end-to-end caller
remain separate work. A prepared preview cannot satisfy those obligations.
Connected providers, general new-order checkout and production qualification
also remain open.
