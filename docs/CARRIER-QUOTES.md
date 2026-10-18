# Carrier service selection and batch quote preparation

M08-G01 adds a bounded local quote projection for up to 32 packages. Every package
retains its own permitted carrier, merchant account, service, parcel/address
identity, rate, currency and expiry. A blocked package remains visible and cannot
inherit another package's price. Eligible totals use the existing exact minor-unit
money primitives and remain separate for each currency.

This is synthetic development preparation under ADR-0035. The M07 entry gate and
formal M08-G01 acceptance remain blocked. There is no connected carrier transport,
account provisioning, label purchase, charge, execution approval or dispatch API.

## Local demonstration

```sh
node --experimental-strip-types tools/demo-carrier-quotes.mts --describe
node --experimental-strip-types tools/demo-carrier-quotes.mts --run-local
```

The second command creates a disposable in-memory commerce fixture, quotes two
packages at 500 and 900 USD minor units, changes the first source rate and
revalidates the original snapshot. It prints actual quote rows, current eligible
totals and observed local operation/label counts. It accepts no merchant data,
credentials, provider endpoints or output paths. The fixture clock is explicit;
those timestamps are not live merchant observations.

## In-process API

`CarrierQuoteFixtureSource` is a separate, server-local synthetic source. Its
`setAccount`, `setPackage` and `setRate` methods arrange fixture records; they are
not HTTP routes or upstream account-creation calls. Source identity and merchant
scope are fixed at construction. Updates require increasing source revisions.
Rate records bind the package, address, account and source state present when the
fixture rate was recorded.

Construct `CarrierQuotes(kernel, source, policy)` with an explicit server-local
policy containing account/carrier/service rules, allowed countries and currency,
maximum package dimensions/weight, a price ceiling, revision and expiry. The
constructor copies and freezes that policy. Subsequent mutation of the caller's
object cannot change it. This configuration prepares a quote; it grants no money
or shipping authority.

```ts
const preview = quotes.quote(scope, {
  batch_id: 'packing-batch',
  packages: [
    {package_id: 'package-a', resource_id: order.id, rule_id: 'ground'}
  ]
});
const current = quotes.revalidate(scope, preview);
```

Only package/resource/rule IDs are accepted from a caller. Canonical order facts
come from the authenticated commerce kernel; package, account and rate facts
come from the fixed source instance. No caller price, account override, localized
decimal or approval flag is accepted. Existing resource permissions, erasure,
restore and restricted-session guards apply before package facts are exposed.

## Package states and source changes

| State | Meaning | Included in totals |
| --- | --- | --- |
| `eligible` | Current source facts satisfy the configured quote policy. | Yes |
| `blocked` | Initial preparation lacks permitted/current package, resource, account or rate facts. | No |
| `stale` | A previously eligible snapshot no longer matches current facts or has expired. | No |

Revalidation reads current scope, order, parcel, address, account, policy and rate
state. Changes to one package's address, resource or rate invalidate that package;
an unchanged package retains its exact original quote. A shared account change
can invalidate every package using that account. Expiry is inclusive at the
cutoff: a quote is stale when the current instant reaches its expiry. Quotes last
at most five minutes and never outlive their source rate or configured policy.

Blocked and stale rows require a new `quote` call before they can become eligible.
Revalidation never silently replaces an approved-looking old price with a new
price. `all_eligible` describes quote availability only. Every returned snapshot
still declares execution authorization, financial effects, carrier connectivity,
label purchasing and formal acceptance false.

The whole snapshot has a process-local HMAC over membership, prices, totals, pins
and claims. Revalidation rejects edited snapshots and snapshots from another
`CarrierQuotes` instance. A restart discards the key and requires fresh quotes.
This is an integrity check for ephemeral preparation; it does not authenticate a
merchant, real carrier source, human approval, reviewer or elapsed observation.

## Storage, privacy and operating limits

The implementation creates no SQL tables, files or durable quote registry. Source
fixture records and the integrity key exist only in memory. Returned snapshots
contain opaque order/address references and package measurements, never actual
address text or credentials. A caller that retains those snapshots becomes
responsible for its own access controls, retention and erasure handling; this
component does not claim to erase independent copies. The demo uses only named
synthetic references and destroys its in-memory database before exiting.

Supported currencies use the unchanged diagnostic money primitive; both amounts
and their sums must fit its canonical 36-digit bound. Currencies are never
converted or added together. A mixed-currency batch exposes separate totals and
`combined_total: null`. Unsupported currency/decimal input is rejected. No carrier
coverage, contract price, delivery guarantee, customs eligibility, settlement or
production throughput is qualified by this fixture.

To roll back this preparation, stop constructing the new module and discard its
ephemeral previews. It introduces no migration, pending carrier operation or
durable quote state to replay. Any future label-purchase goal must retain its own
current-state recheck, explicit approval, durable per-package operation identity,
receipts and uncertain-outcome reconciliation.

## Focused verification

`tests/development/carrier-quotes.test.mts` contains 14 native cases covering the
three M08-G01 scenario IDs, literal package prices and totals, individual stale
rows, merchant/account/service constraints, expiry, source pins, exact and mixed
currencies, snapshot tampering, authority revocation and the disposable CLI.
The deliberately substituted first-package service and price execute inside a
temporary copy of the quote module, before total calculation and snapshot
sealing. The same oracle first accepts the real module and then rejects that
mutant's returned rows; the real source is never edited by the test. It uses separately
written expected values. Existing purchasing and lifecycle tests are retained.

The author writes these cases before implementation. The integration owner runs
the coherent focused selection and retains actual native reports; this guide
does not assert a passing run or formal qualification. Routine development keeps
the existing 60-case, four-file and 60-second defaults.
