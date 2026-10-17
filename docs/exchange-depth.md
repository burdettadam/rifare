# M06-G01–G05: exchange depth and gift choices

This batch implements the first five M06 goals as local, synthetic diagnostics.
The retained M05 checkpoint is `45fdd7b4ecfb0903c29fea3bd3210fdf7caf9068`.
[ADR-0028](decisions/0028-exchange-depth-first-five.md) records the delegated
implementation and local integration authority. Original milestone acceptance,
connected financial observations, production operation and public release remain
unqualified. The next goal packet is **M06-G06**; it is outside this batch.

## Behavior

| Goal | Implemented behavior | Canonical implementation |
| --- | --- | --- |
| G01 | Current catalog choices across permitted products; product/category exclusions; active and fulfillment checks; inventory buffer; capped, margin-limited incentives; quote invalidation on source/configuration drift. | `VariantExchanges`, existing stock reservation and fulfillment gateway |
| G02 | One additional-payment obligation per allocation; explicit unpaid, partial, failed, expired and settled observations; replacement blocked until the exact native capture is established. | `ExchangeFinance`, resolution operation ledger and separate fixture finance source |
| G03 | Lower-price residual refund to supported original instruments or native credit; deterministic original-unit allocation; original value and per-instrument ceilings; unknown effects reconciled without reissue. | Existing refund/credit gateway, `ExchangeFinance`, native settlement binding |
| G04 | Original paid bundle allocations; original promotion treatment retained for remaining components; zero-price gifts remain zero-value; each original unit is allocated once. | `ResolutionLedger`, independently supplied bundle/instrument facts |
| G05 | Explicit source recipient grant and one-use delivery proof; restricted recipient views; exchange or recipient credit; purchaser and recipient share the existing unit ledger; recipient erasure and retention integrate with existing return operations. | `GiftReturns`, canonical case/intake/approval/finance/fulfillment/privacy modules |

The old unconfigured same-product, equal-price path remains available. Explicit
`active:false` or `fulfillment_qualified:false` is always rejected. When a merchant
configures category exclusions, absent category evidence is rejected too.
New capabilities require explicit current settings; missing data does not imply
qualification.

### Catalog and price calculation

Catalog records must exist in the current tenant/store source. A model-provided
variant identifier is only input for lookup. It never establishes a product,
price, stock count or permission. Browsing produces tentative offers; quoting
rechecks the source; reservation and final fulfillment recheck independent stock.

The existing paid unit allocation supplies exchange value, retained discount,
original tax/duties/shipping and configured return fees. For an eligible
incentive, the discount is the minimum of the configured percentage, absolute
cap, and the amount above the minimum-margin floor. Cost and promotion evidence
must be current. Replacement price uses the current qualified catalog components.
Integer minor units and the existing money allocator handle rounding.

The demonstration has original exchange value USD 10.00, replacement merchandise
USD 12.00, an allowed USD 1.20 incentive, and an exact USD 0.80 payment obligation.
These expected values are independently asserted; quoting does not reserve stock
or charge a payment.

### Payment, residual and bundle authority

All additional payment, cash residual and store-credit operations use the existing
`diagnostic.return.resolve` approval gateway. Proposing, approving and executing
retain separate scoped authority and one-use approval. Authorizing a command,
accepting a command, issuing an unpaid invoice and settling a payment are distinct
states. An invoice or partial payment never releases a replacement.

The stock source retains the original signed price difference and finance source
identity in its own reservation. When replacement is requested, it checks the
exact operation, quote, allocation, original order/customer, currency, amount,
native receipt and capture. Removing a payment binding from the command cannot
remove that requirement. A response lost after source commitment becomes unknown;
lookups establish the original result without issuing a second obligation.

Optional `instrument_allocations` facts specify supported card/gift-card
instruments, each original paid unit's contributions, prior refunds and the
`original_unit_proportional_v1` rule. Both the canonical ledger and the separate
source validate those facts and ceilings. Unsupported or incomplete routing is
rejected. Credit creates a native balance, distinct from a coupon and from cash
settlement; subsequent redemption does not authorize reissuing it.

Optional `bundle_allocations` require explicit `preserve_original_paid` merchant
configuration and `retain_remaining_components` promotion treatment. Original
paid components and fulfillment-line identities must reconcile. Retail price
cannot replace the paid allocation. The zero-price component still consumes an
original unit and requires normal approval, reservation, stock and fulfillment.
There is no tax or promotion reinterpretation outside the explicitly supplied
source facts.

### Recipient proof, visibility and recovery

Gift status in free text supplies no authority. Synthetic order `gift_facts`
explicitly identifies the recipient, delivery email, original line/unit grant,
allowed exchange/credit outcomes, source revision and freshness. Challenge
responses do not reveal whether receipt/email lookup matched. A correct,
unexpired delivery proof can be consumed once; attempts and requests are bounded.
Only a deliberately injected local delivery callback exists in this slice.

The recipient token is separate from ordinary customer, staff and worker sessions.
It cannot be used as a commerce bearer or reveal the purchaser's order/payment
details. Public views return permitted line quantities and outcome choices only.
Preparing the canonical case and return requires a current staff scope plus the
recipient token. The gift page lets the recipient choose an option to discuss
with the store; it does not claim that clicking a choice submitted or approved a
return. Staff preparation uses the normal request and approval records.

Canonical case and financial records retain the original purchaser identity.
Credit has a separate verified recipient beneficiary. Before credit issuance, the
independent source saves an immutable obligation binding to the operation,
allocation, native return, original purchaser and verified recipient. Dropping
both recipient fields or changing an identifier cannot downgrade a known gift
obligation to purchaser credit. A separate purchaser return on the same order
still uses its own allocation and native return. Replacement holds pin both
identities, original resource/native order, recipient source digest and source
identity. The independent source rejects missing or substituted bindings before
stock consumption. Gift additional payments and cash refunds are not qualified
in this slice; lower-price gift exchanges can issue approved recipient credit.

`GiftReturns.rebind` requires a fresh proof for the same recipient and original
order plus the expected verification revision. It preserves case/request/unit
identity, revokes previous approval authority and requires a fresh preview. An
awaiting-review request can be refreshed in place. Rebinding never transfers a
case to a different recipient or automatically reauthorizes a sent operation.

Purchaser subject exports exclude gift-case activity. Recipient exports exclude
purchaser records. Recipient erasure removes the grant, proofs, evidence contents,
support delivery/contact material and address references while preserving the
minimal original quote, paid allocation and operation context needed for read-only
reconciliation. Gift intake free text must use erasable evidence, so reconciliation
quote digests remain intact. Current and historical recipient holds protect
evidence from manual erasure, scheduled purge and erasure through the purchaser.
Restore checkpoints suppress erased recipient grants and revoke old sessions.
External fixture-source audit, delivery outboxes and older backups remain explicit
separate cleanup responsibilities, as in the existing privacy contract.

## Run and inspect

Use the repository's supported Node runtime. The verified handoff records the
exact test-host prerequisites, including the browser and Python Playwright version.

```sh
node --experimental-strip-types tools/demo-exchanges.mts
node --experimental-strip-types tools/demo-exchanges.mts --serve
```

The first command prints a sanitized source-backed trace: catalog values, the
unpaid additional-payment state, source effect count and private gift choices.
The serving mode prints local `/exchanges` and `/gift-returns` URLs plus the paths
to private, disposable session and gift-delivery files. It uses a fixed fixture
clock for reproducible inspection. Those local files are deleted on shutdown.
Neither mode uses a model, real sender, live payment provider or hosted service.

| HTTP operation | Authority and effect |
| --- | --- |
| `/v1/resolutions/exchange-configure` | Merchant configuration authority and expected revision |
| `/v1/resolutions/exchange-browse`, `exchange-quote` | Current scoped allocation; tentative offer or quote |
| `/v1/resolutions/exchange-finance-quote` | Exact exchange quote/digest and supported outcome; returns existing gateway proposal |
| Existing execution, resolution and fulfillment routes | Separate review, dispatch and reconciliation; same canonical ledgers |
| `/v1/gifts/challenges`, `verify` | Explicit injected delivery service; bounded one-use recipient proof |
| `/v1/gifts/choices`, `status`, `revoke` | Separate recipient token; restricted views or revocation |
| `/v1/gifts/case`, `prepare`, `rebind` | Current staff bearer plus separate recipient proof |

## Evidence and retained limits

Permanent native tests cover the 15 named CASE-M06-G01–G05 obligations and
additional security, financial, stock, privacy, HTTP, browser and two-process
contention regressions. The complete registry is additive. Every original 2,043
registration, protected test/fixture/contract and benchmark definition is retained.
The distribution source-count fixture changes only its independently reviewed
count/explanation. The old storage-inventory contract remains byte-for-byte intact;
an additive extension describes the four new commerce tables.

The handoff evidence includes the original protected controller and pins, its
passing base run, exact-candidate native reports, meaningful fault results,
superseded failures and diagnoses, separate security/regression reviews, screenshots,
upgrade compatibility checks, and ZIP/bundle restoration verification. Reviewer
sessions are independent of the respective code authors within this assistant
runtime. They are not human, merchant, payment-provider or production attestations.

All provider effects here occur in separate synthetic databases. Expired or
changed quotes, source grants, configuration, stock or approval stop execution.
In particular, a settled payment whose original exchange quote later expires is
not automatically repriced or attached to a new quote. It remains blocked for
manual resolution; no second payment is authorized. This batch does not add a
long-lived checkout/recovery service or connected provider qualification.

Migrations 021–023 are additive or preserve existing resolution rows while
extending permitted finance states. Keep a pre-upgrade backup; do not run the old
binary against an upgraded database. Use the retained M05 Git history for source
rollback and its matching snapshot for data rollback, with current privacy
suppression checkpoints. Unknown source effects must be reconciled before any
operator decides on replacement or retry.

See the adjacent handoff's `START-HERE.md`, verification manifest, review decisions
and `CONTINUE-PROMPT.md` for the final commit/tree, actual suite totals, archived
evidence and next authorized packet.
