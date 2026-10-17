# Rifare mixed return resolution

## Scope and current state

M03-G06 through M03-G10 extend the existing SQLite diagnostic application. A
confirmed native-return fixture, original paid-line records, and owner-configured
synthetic source are required before a refund or store-credit operation can be
prepared. There is no network payment transport. Variant exchanges are quotations,
not inventory reservations or replacement orders. Qualification remains open for
PostgreSQL/React, connected native accounts, payment settlement, taxation rules,
stock reservation and the actually served application.

Skills, manual callers, REST and external workers use the existing case,
permission, preview, separate-role approval, stop and recovery boundaries. Changing
a request key or model cannot allocate a unit a second time or authorize money.

## Commands

```sh
npm ci --offline --ignore-scripts
python3 tools/verify.py --runtime --harness
node --experimental-strip-types tools/demo-return-resolution.mts
```

The demonstration creates separate in-memory application and source databases.
It uses product modules, not an import of the test directory. It provisions no
external account, reads no model key, leaves no private session file and makes no
network request. It accepts no arguments. Existing diagnostic servers and pages
remain unchanged; this batch does not introduce a new browser UI.

## Allocation and original paid facts

`ResolutionLedger` creates one immutable plan per approved return request. Each
selected line/unit belongs to exactly one refund, store-credit or exchange
allocation. The SQL unit key is shared across plans and outcomes. A duplicate
intent resumes its original plan; changing the outcome, units, or request key
cannot silently replace that plan. Every unit in the submitted request must be
allocated exactly once. Cancellation or reallocation is not implemented here;
units remain conservatively held rather than released by a failed response.

The normalized `resolution_facts` source supplies payment identity, currency,
original total, previous refunded value, explicitly accounted operation IDs and
original per-line gross, discount, tax, original shipping and duties. Integers are
minor-unit strings. A line's indexed units use the same front-loaded remainder
order for every component; discounts cannot exceed a unit's gross amount. Line
sum, original total, fulfilled/previously returned units, freshness and source
identity are validated. Original tax and duties are retained amounts, not a new
tax engine. The diagnostic subset assumes stable ordinal units with contiguous
fulfilled quantities.

One return-shipping fee is allocated across the mixed request, not charged once
per outcome. Refunds and credits deduct their allocated restocking and return
shipping fees. A lower fee or a changed catalog price cannot rewrite the captured
paid basis. New requests for evidence, revoked configurations, canceled native
returns, changed fee settings or refreshed facts invalidate preparation/execution.

Outstanding authorized, unknown, accepted, settled and issued values reserve the
original refundable balance until corroborated accounting includes a terminal
operation. Unknown/unsettled operation references cannot release a reservation.
Known rejection does not automatically reallocate the original units.

## Synthetic execution and reconciliation

`RefundQuotes` yields an immutable quote and an ordinary gateway proposal with
`diagnostic.return.resolve`. The client cannot supply the refund amount, payment
account, source identity, or native record. The existing exact-preview approval
binds current customer proof, case/profile/policy/configuration, source facts,
currency, amount, reviewer authority, deadline and one use.

Gateway execution atomically records an authorized resolution operation alongside
its original approval receipt. It does not contact the source. `ResolutionExecution`
uses a separately configured `ResolutionFixtureSource` database. That source has a
persisted random identity, independent of its display label. A second database
with the same label cannot be substituted for reconciliation.

The executor persists `unknown` before calling the source. A lost response,
malformed response, deadline or revoked authority never establishes that nothing
happened. Calls have a bounded one-second diagnostic deadline by default, with
server-only bounds of 5–30000 ms. A timed-out source may still have committed;
late results are not applied automatically. Repeating dispatch does not resend an
unknown operation. Read-only reconciliation looks up its original operation ID and
checks source, customer, order, payment, amount, currency and native identity.

Refund stages distinguish `authorized`, `unknown`, `accepted`, `settled` and
`rejected`. Merely creating a refund record is not settlement. Only the separate
fixture source's explicit settlement transition can produce the synthetic settled
observation. These are diagnostic records, not movement of real funds. Parallel
workers cannot exceed either local approved balance or the source ledger's
remaining balance.

## Store credit

`StoreCredit` shares the allocation, quotation, approval and operation machinery.
It requires a configured native-store-credit instrument. Issuance validates the
actual synthetic customer/currency account and retains its native account ID,
amount issued, last observed balance and source time. Account balance is not the
same as the amount issued by this operation; later redemption does not authorize
reissuing credit. Discount codes, wrong-customer accounts, cash settlement labels,
negative balances and unsupported expirations are rejected. No automatic coupon
fallback or expiry policy is implemented.

## Variant exchange quotation

`VariantExchanges` reads a current synthetic catalog snapshot. It checks same-product
variants, exclusions, exact currency, stock minus buffer, original discount and
promotion validity, tax/shipping/duties and return fees. It records source versions,
digests, price delta, expiration and supported alternatives. Current-state recheck
rejects stock/price/promotion/source changes. Fee changes or newly resolved units
also invalidate a quotation.

Only a zero-balance, in-stock, nonexcluded same-product variant can be marked
quote-eligible. Positive/negative balance collection, cross-currency exchange,
catalog-wide exchanges and inventory commitment are unavailable. Even an eligible
quote returns `stock_reserved: false`, `requires_atomic_reservation: true` and
`commit_authorized: false`. M03-G11 owns actual reservation concurrency.

## API and authority

The server-local optional `resolutionSource` argument injects a concrete fixture
source. No public endpoint can register a provider, choose a source database, or
change the approved monetary amount. Default startup has no resolution executor.

Authenticated JSON POST routes under `/v1/resolutions/` are `allocate`, `plan`,
`quote`, `credit-quote`, `exchange-quote`, `exchange-current`, `operation`,
`dispatch`, `reconcile` and `instrument`. The last four require an injected source.
The ordinary `/v1/execution/preview`, `/approve` and `/execute` routes perform
proposal approval and durable authorization. There is no exchange-commit route.
The input inventory is in
[return-resolution.v1.json](../packages/commerce/contracts/return-resolution.v1.json).

## Privacy, storage and recovery

Migration 015 adds shared allocations, unit claims, quotations, operations and
append-only observations. Existing migrations and previous test files remain
unchanged. Current customer/store erasure guards block all new reads and actions;
subject export includes the new attributed records. Erasure pseudonymizes plan,
allocation and quote bodies. Minimized financial operation commands, opaque IDs,
unit claims and append-only observations remain for reconciliation and preventing
repeated effects. This is not forensic erasure or a compliance certification.
The separate source database has its own retention responsibility and must not be
included in public source packages.

Keep original source identities and unresolved operations during restore. Existing
quarantine/stop controls prevent dispatch from a restored environment. Roll back
access by disabling the resolution capability/stop and removing the optional
executor, not by deleting operation history or releasing uncertain reservations.

## Evidence and limits

The existing controller executes prior and new native tests, including two actual
processes racing for one operation and a process exit after a separate source commit.
Golden values and mutation failures are retained outside Git. No new browser
qualification is claimed. Same-assistant delegated maintainer review is recorded;
there are no invented independent reviewers. Local integration is not full goal,
milestone or financial production acceptance.
