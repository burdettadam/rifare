# Instant exchanges: local mandate and capture contract

M06-G09/G10 implement a bounded local fixture preparation. The original connected
goals and their prerequisite milestones remain blocked. There is no payment
processor integration, saved-card endpoint, deposit implementation, live capture,
automatic timer, or external network call in this module.

## Supported local combination

The current fixture supports USD, exact original paid units, one merchant-approved
version of explicit nonreturn terms, one bounded customer consent, and a native
mandate with an explicit expiry. The source preserves a permanent obligation per
allocation and claims each original resource/line/unit once. It supports one
capture per obligation. A partial capture exhausts that local capture operation;
it does not create a right to charge the remainder with another key.

The consent record binds customer, original resource and native order/return,
allocation, exact exchange quote and digest, replacement variant and quantity,
original unit amounts, terms digest, permitted maximum, trial deadline and
authorization expiry. A card token alone is not consent. Consent revocation,
source account readiness, changed terms and expiry are checked again by the
native authority before effects. The 60-second trial and 90-second authorization
in the hand fixture are test values, not provider validity windows.

A mandate concerns the future original-item nonreturn obligation. An exchange
price difference already owed still follows the existing additional-payment
settlement contract. The mandate cannot make an unpaid exchange balance zero.
Gift-recipient mandates, alternate currencies, conversion, duties, deposits,
multicapture and provider-specific payment methods remain unqualified here.

## Shared approval and execution path

`InstantExchanges` in `packages/commerce/instant-exchanges.mts` takes the current
`CommerceKernel` and an explicitly constructed separate native fixture source.
Construction binds that source to the kernel for gateway rechecks. Reopening a
kernel does not install an adapter automatically. Public methods accept an
authenticated Scope; an object containing a role, customer ID or merchant ID
cannot create one.

The owner configures the exact source/account. The ordinary workflow is:

1. `quoteAuthorize` accepts an existing exchange quote ID/digest and a native
   consent reference. Amounts and terms come from current source records.
2. The returned proposal goes through the existing `ActionGateway.prepare`,
   independent `approve`, and `execute` controls. The instant gateway hooks
   produce the usual pinned preview and consume a single approval.
3. Execution creates a durable `commerce_instant_operations` entry and receipt.
   `dispatch` rechecks permission, approval revision, case scope, quote, current
   native plan, execution stop and restore restrictions. It records `unknown`
   before calling the native source.
4. The source persists the full approved command independently before the
   replaceable transport call. Changing the operation ID, kind, generation,
   amount, terms or consent in transit fails that binding. The returned result
   must also match the actual durable native result.
5. `reconcile` only looks up the same operation. Unknown work is never resent,
   including a timeout before any observed source effect or a later process
   restart. Time passing does not free the reservation or create a new identity.

Actions are `diagnostic.instant.authorize`, `diagnostic.instant.reauthorize`,
`diagnostic.instant.capture` and `diagnostic.instant.cancel`. Integration uses
the existing approval tables, receipt API and stop controls. Additive migration
026 holds instant settings, quotes, immutable original bindings, operations and
append-only observations. It does not replace the refund or additional-payment
ledger.

## Native replacement boundary

`instantSettlement(kernel, scope, exchangeQuote)` returns a current confirmed
`instant_exchange` binding, or null when the allocation has no instant obligation.
An authorized or unknown local mandate is insufficient. The source verifies the
exact native mandate and current consent independently of local state.

The existing fulfillment path must persist that binding with its original stock
hold. `assertReplacement(command, binding)` verifies both the binding and the
native obligation found by allocation. It is called even if transport drops the
optional field; an existing native instant obligation cannot become an ordinary
unbound replacement by deleting fields.

The stock and mandate authorities are separate databases. Accordingly, they use
an explicit reserve/confirm protocol, not an assumed distributed transaction:

| Stage | Permitted next behavior |
| --- | --- |
| Mandate active, no release | Reserve this exact existing fulfillment operation before the trial deadline. |
| Release reserved | Preserve the uncertain obligation; capture and cancellation completion are blocked. |
| Native stock effect committed | Confirm the original reserve using that exact native replacement record. |
| Release confirmed | Evaluate capture after the trial deadline against the current valid obligation. |

`reserveReplacement` persists the immutable fulfillment operation, stock hold,
command digest and binding digest. `confirmReplacement` accepts the matching
created/fulfillable/inventory-committed source record after the stock transaction
commits. Reconciliation may confirm an already committed release after expiry;
that observation never grants a new release. Changed operations or bindings fail.

## Return, cancellation and capture behavior

The native fixture serializes receipt observations and captures with SQLite
`BEGIN IMMEDIATE`. Receipts name exact original units, have unique event IDs and
cannot claim a foreign unit. They reduce the current original paid balance once.
The predeclared oracle is three USD 10.00 units: one returned unit leaves at most
USD 20.00; two leave USD 10.00; all returned leave zero.

Capture requires confirmed release, a passed trial deadline, an unexpired native
mandate, current account/terms/consent, no previous capture, and a positive current
unreturned amount. The amount is bounded by both the customer-approved mandate
maximum and the staff-approved capture amount. A receipt arriving after approval
but before the native capture transaction can only reduce that amount. A
zero-balance race records a rejected operation and zero captures.

If capture wins the race, a subsequent return records an explicit compensation
requirement against captured unit shares. Captured shares are assigned in the
frozen source unit order and capped by each unit's original paid amount. The
fixture does not invent a refund or erase the earlier capture. Duplicate receipt
delivery does not multiply compensation.

Cancellation needs a separate approved operation. Before capture it can waive
the remaining obligation; it cannot undo a committed capture. A reserved but
unconfirmed replacement remains unresolved. Reauthorization needs fresh native
customer consent and another approval, preserves the original unit identity and
trial deadline, and advances mandate revision. It does not extend an expired
authorization by changing a local timestamp. A new explicit ceiling cannot
exceed original paid value or the source-approved current terms.

## Current provider documentation and blocked qualification

Primary documentation was checked on 2026-10-17. These constraints inform the
default-deny contract; they do not establish account access or connected support.

* [Shopify orderCapture, 2026-10](https://shopify.dev/docs/api/admin-graphql/2026-10/mutations/orderCapture)
  captures an already authorized order transaction and requires the applicable
  order-write scope plus capture permission. Its multicapture availability and
  presentment-currency requirements are conditional. This is not evidence that a
  generic app can create a reusable nonreturn mandate from a saved card.
* [Stripe separate authorization and capture](https://docs.stripe.com/payments/place-a-hold-on-a-payment-method)
  uses native authorization expiry, including `capture_before`, and documents
  different payment-method/network windows. Expired authorization releases the
  held funds. Most authorized payments support one capture; partial capture
  ordinarily releases the remainder. No blanket duration or automatic extension
  is assumed by Rifare.
* [Stripe saving payment methods](https://docs.stripe.com/payments/save-and-reuse?payment-ui=elements)
  distinguishes saving details from permission for a particular future use.
  Its consent guidance covers transaction purpose, timing, amount determination
  and retained agreement. A fixture proof reference is not that real agreement.
* [Stripe API idempotency](https://docs.stripe.com/api/idempotent_requests)
  allows API v1 keys to be pruned after at least 24 hours; reuse after pruning can
  execute a new request. Rifare therefore retains its original obligation and
  native operation identity instead of treating a provider key window as a
  financial reservation lifetime.

Required external evidence remains absent: selected processor and actual API
version, merchant account entitlement, signed terms/contract, payment-method
eligibility, real customer agreement, test credentials and scopes, approved
endpoint/budget, provider expiry/reauthorization behavior, receipt authority, and
connected capture/reconciliation records. M03-G99, M04-G99, M05-G99 and formal
M06-G02/G09 prerequisite acceptance remain open. PostgreSQL, React and intended
merchant use are not qualified by this SQLite fixture.

## Verification and recovery

The permanent Node suites are `instant-mandates.test.mts`,
`instant-lifecycle.test.mts` and `instant-races.test.mts`. They include the six
original goal cases, source-ledger effect counts, separate stock effects, actual
two-process receipt/capture contention and crash/reopen reconciliation. The
independent fixture is `tests/fixtures/instant-exchanges/independent-values.json`.
Run them with the repository's pinned Node native test runner. Exact candidate,
commands, native counts, deliberate fault reports and independent reviews are
delivered as separate evidence, not asserted by this guide.

Keep unresolved source reservations and original operation IDs through rollback,
privacy minimization and restore. New effect dispatch remains disabled in a
restored quarantine. Do not delete migration 026 from a database that applied
it, clear unknown rows, create replacement keys, or infer cash settlement from
the synthetic `captured` stage. Native fixture administration methods are not
customer/agent APIs and must remain outside those routes.
