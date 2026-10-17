# Original currency allocations and final return fees

## Supported local outcome

M06-G07/G08 add a bounded synthetic refund and fee-reconciliation contract. An
original-allocation cash refund can carry independently recorded shop and
presentment amounts, source conversion provenance, original duties and exact
return-fee components. The existing canonical ledger continues to account in the
original paid currency. Both currency amounts are bound to the same approved
operation and independently checked by a separately persisted native fixture.

This does **not** qualify complete currency-safe exchange settlement. Paired-money
replacement/exchange and additional-payment paths are rejected. Foreign-currency
store credit is rejected. Gift cash refunds and additional payments remain outside
the gift capability envelope. No merchant account, payment provider, market or
tax provider has been connected or qualified by these tests. ADR-0029 permits
local preparation while the original connected prerequisites and formal acceptance
remain blocked.

The explicit arithmetic subset remains USD, EUR, GBP and CAD at two decimal
places, JPY at zero, and KWD and BHD at three. Source qualification must separately
name an account, market, card instrument, exact currency pair, API version,
evidence reference and expiry. It always declares `synthetic_only`. Merely naming
a supported currency or submitting caller-supplied amounts does not establish
source authority.

## Source and approval boundary

`ResolutionFixtureSource.money` owns the server-local monetary fixture records.
`qualify` creates a versioned, expiring fixture permission; `seedOrder` records
immutable original component allocations and source/rate references against an
existing native payment account. The original shop total less prior native
refunds must equal that account's available amount. Original unit totals and
resolved-unit totals must agree in both currencies. An original monetary profile
cannot be introduced after that source has already issued effects on the order.

After the ordinary return and resolution allocation exist,
`ExchangeCurrency.bind(scope, {allocation_id})` imports a native allocation. It
checks the source identity, tenant, store, market, original customer, payment,
currency, native return and original shop components. Native per-unit reservations
prevent reuse under another allocation. Refreshing qualification appends a new
canonical snapshot; it cannot replace the original money history.

`RefundQuotes` puts the complete `money_terms` in the quote, gateway preview,
approval digest, operation command and native receipt. A source-side command
digest is saved **before** the replaceable issue transport. Inside the native
transaction the source checks that saved command, current qualification, original
currency pair, duties, fee observation and paid ceilings. Removing optional fields
from the transported object cannot remove the source's requirement. The canonical
command currency remains the original shop currency; the paired presentment
record is not an instruction to substitute that currency into the old ledger.

Unqualified exchange paths must call `assertExchangeMoneySupported` at quote and
fulfillment review. The native fulfillment source also checks its money authority
before stock commitment. `feeHistory` supplies the corresponding lifecycle,
cancellation-preview and handoff history. These shared integrations are maintained
by the integration owner.

## Estimated and finalized fee contract

The source's `recordFee` accepts a narrowly pinned synthetic shape containing
`amountSet` and either estimated `taxAmountSet` or final
`finalizedTaxAmountSet`. Money bags contain exact `shopMoney` and
`presentmentMoney` values with currency codes. Decimal strings use the explicit
precision subset; floating-point conversion and current-rate repricing are absent.

`ExchangeFees.refresh(scope, {allocation_id, event_id})` pulls a source event by
ID. Callers cannot submit fee amounts through this import. The original estimate
and each native final revision occupy separate immutable canonical rows. Duplicate
event delivery is idempotent; contradictory reuse of an event ID is rejected.
Out-of-order canonical imports retain the highest native final revision. A null
final-tax field means finalization is pending and does not create a final event;
an explicit zero is a valid final amount.

Recording an observation uses the immutable original allocation identity and
continues after issuance qualification expires. Expiry still blocks current
allocation binding and financial issue; it does not discard a late native final
or prevent duplicate delivery from reconciling the existing history.

Before authorization, a changed final invalidates the old quote and approval.
A fresh quote, preview and approval bind the new exact component pair. After
authorization, the existing allocation remains tied to its original operation.
Late final differences are visible as `difference_requires_review` with the
original operation ID and exact deltas. Unknown or settled effects reconcile
through the original receipt; a final observation never grants another effect
key. Staff must resolve the discrepancy through an explicitly qualified future
workflow. The current helper never authorizes a compensating charge or refund.

## Independent values and actual test coverage

The hand-calculated oracle is
`tests/fixtures/exchange-money/golden.v1.json`. For alpha unit two, the original
paid value is USD 1940 minor units and EUR 1746. The original duty allocations are
USD 10 and EUR 9. A later 11/10 rate would give EUR 2134; it must not change that
refund. Fee pairs are independently supplied native values, not conversions.

| Stage | Shop calculation in USD minor units | Presentment calculation in EUR minor units |
| --- | --- | --- |
| Original unit refund | 1940 | 1746 |
| Estimated fee/tax | 1940 − 180 − 34 − 3 = 1723 | 1746 − 162 − 31 − 3 = 1550 |
| Final fee/tax | 1940 − 180 − 34 − 4 = 1722 | 1746 − 162 − 31 − 4 = 1549 |
| Difference from estimate | 1 additional fee unit | 1 additional fee unit |

The USD/EUR cases exercise approval, native issue, settlement observation,
uncertainty, reconciliation and late fee history. JPY and KWD cases exercise
explicit quote precision and excessive-precision rejection; they do not establish
provider settlement in those markets. Existing no-profile payment/refund commands
retain their old schemas and unknown operations remain reconcilable after the
source constructor adds its new tables.

Run the named native cases with the pinned Node 22.16 runtime, directly, so the
report contains the individual stable IDs:

```sh
"$RIFARE_NODE22" --experimental-strip-types tests/development/exchange-currency.test.mts
"$RIFARE_NODE22" --experimental-strip-types tests/development/exchange-fees.test.mts
```

Set `RIFARE_NODE22` to the verified Node binary recorded in the evidence manifest.
The first author checkpoint has 19 currency and 17 fee cases passing. A subsequent
review regression adds an expired-qualification late-final case. Full gate
and independent review evidence belongs to the final integration candidate.
Author fault manifests preserve the exact changes that introduced a current-rate
conversion, removed the native money guard, overwrote the estimate or reused a
stale approval. Their unchanged tests fail on exact amounts, forbidden native
effects or a missing required approval exception.

## Primary API field evidence and qualification limits

Read-only Shopify documentation was checked on **2026-10-17**. The requested
versioned URLs redirected to `latest`, whose displayed version was **2026-10**.
The recorded field snapshot is documentation evidence, not a connected schema
introspection or a native merchant observation.

| Primary source | Relevant contract |
| --- | --- |
| [CalculatedReturnShippingFee, API 2026-10](https://shopify.dev/docs/api/admin-graphql/2026-10/objects/CalculatedReturnShippingFee) | `amountSet: MoneyBag!`; `taxAmountSet: MoneyBag!` supplies an estimate in both currencies. |
| [ReturnShippingFee, API 2026-10](https://shopify.dev/docs/api/admin-graphql/2026-10/objects/ReturnShippingFee) | `amountSet: MoneyBag!`; `finalizedTaxAmountSet: MoneyBag` can be null before processing and can differ from the estimate. |
| [RefundInput, API 2026-10](https://shopify.dev/docs/api/admin-graphql/2026-10/input-objects/RefundInput) | The live refund input requires presentment currency when the order currencies differ. This synthetic shop-ledger command is not a qualified live refund wire adapter. |
| [October 1 API changelog](https://shopify.dev/changelog/posts/new-return-shipping-fee-tax-fields) | Introduces the fee-tax fields in API 2026-10 and announces applicable US behavior beginning October 23, 2026. That date is future relative to the documentation check; no active tax behavior is claimed. |

## Storage and recovery

Migration `025_exchange_money.sql` adds append-only
`commerce_exchange_currency_bindings` and
`commerce_exchange_fee_observations`. Native authority adds the six
`fixture_exchange_money_*`/`fixture_exchange_fee_events` tables in the separate
source database. These are business/financial records without contact details,
proof tokens or free-text customer content. Shared storage/privacy inventory
registration is required for export, erasure and recovery checks.

Keep matching canonical and native-source backups. Restore with effects disabled,
then reconcile uncertain operations from their original source. Do not remove
money bindings, original-unit reservations or fee history to make a rollback pass.
An expired quote or qualification cannot issue a new effect; historical receipts
remain available for same-operation reconciliation. The current implementation
provides no live financial authority and no automatic discrepancy write-off.

## Oversized final observations

A well-formed final tied to the original native allocation/fee record remains
observable even when total fees equal or exceed the paid value in either
currency. The canonical history marks `fee_exceeds_original_value` and
`manual_fee_review`, retains the estimate and exact final, and blocks ordinary
closure. This applies before an operation exists and after settlement. Existing
receipts remain unchanged. Every new quote and native issue still requires a
positive exact refundable amount, so no negative refund or automatic extra charge
is created. Malformed, conflicting or unbound observations remain rejected.
