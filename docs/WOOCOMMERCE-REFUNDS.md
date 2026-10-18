# WooCommerce refund records and gateway observations

This is the bounded **local M07-G02 development slice** assigned by
[ADR-0031](decisions/0031-second-platform-local-development.md). It uses a named
`rifare-fixture-card` gateway and separately persisted synthetic ledgers. There
is no provider transport, real gateway account, installed Woo server version,
connected qualification or observed real settlement. M05-G99, M06-G99 and the
original connected M07-G02 criteria remain blocked.

## The financial boundary

The existing `ResolutionLedger`, `RefundQuotes`, `ActionGateway` and
`ResolutionExecution` remain the only financial workflow and approval path.
Woo orders keep `source_system: woocommerce`. Their return authority comes from
the approved composed RMA in [Woo return handling](WOOCOMMERCE-RETURNS.md), whose
native return reference is null. No Shopify return identifier or fabricated
`commerce_native_return_operations` row is required or created.

The quote and immutable operation command bind the tenant, store, customer,
Woo account and origin, original order/payment/transaction, original card
instrument, currency, allocated item units and amount. They also bind the
return-source revision/digest, full RMA authority digest, financial fixture
identity, gateway account/identity, API namespace, contract digest and scopes.
G01's source-read permission remains `read`; the separate refund connector
configuration requires exactly `read` and `write`. Neither label grants live
permission. Exchange, store credit, restocking, alternate instruments and
server-computed refund totals are unavailable through this fixture contract.

| Observation | Canonical financial state | Settlement claim |
| --- | --- | --- |
| Approved operation before send | `authorized` | None |
| Send persisted, no verified result | `unknown` | None; lookup only |
| Woo manual refund record, no gateway effect | `manual_external_settlement_pending` | None |
| Gateway accepted the original refund | `accepted` | None |
| Verified gateway movement and matching Woo refund record | `settled` | Synthetic fixture settlement only |
| Gateway rejects the original refund | `rejected` | None |

The source exposes a Woo refund record separately from the gateway refund and
movement. A record's `refunded_payment: true` still does not prove settlement.
An accepted gateway effect without a matching store record is reported as
`gateway_effect_store_record_missing` and remains incomplete, including when
the gateway movement subsequently appears. A manual record remains pending;
this slice has no command that can turn a manual record into verified external
settlement.

Both source boundaries preserve original operation and allocation identities.
The core persists `unknown` before the source call, the Woo fixture reserves its
original obligation before the gateway call, and the gateway records a unique
operation with a current original-payment balance check. A lost response,
process death, new client, new operation name, or another process does not
permit the same allocation or original units to produce another refund.
Reconciliation reads the original operation; it does not reissue it.

## Modules and integration

`packages/adapters/woocommerce/refund-contract.mts` defines the fixed local
contract and exact quote/command pins. `refund-gateway-fixture.mts` provides
`WooRefundGatewayFixture`; `refund-fixture-source.mts` provides
`WooRefundFixtureSource`. Constructors require fixture mode and a named gateway.
The financial source and gateway databases must differ from each other and from
the core. The inherited G01 order/history source is also a separate database in
the integration fixture.

Pass `source.configuration()` as `woo_refund` when calling
`ResolutionLedger.configure`, with that source's identity and
`credit_instrument: none`. Seed independent order/payment/unit facts on the
financial and gateway fixtures, then use the ordinary allocate → quote →
prepare → approve → execute → dispatch sequence. The self-contained development
helper is `tests/development/woocommerce-refund-helpers.mts`.

`source.inspect(operationId)` synchronously verifies and returns the immutable
command, Woo refund record, independent gateway result, their digests, current
stage and source observation time. Gateway settlement additionally requires a
separate matching movement record. `source.result(operationId)` returns the
canonical observation shape used by `ResolutionExecution`; `lookup` performs
the same read asynchronously. Missing obligations return null. These methods
are server-attached fixture interfaces, with no caller-selectable account,
database path, network destination or raw source mutation API. Notification
integration must compare current source proof to canonical receipts and check
freshness; an RMA state or previously displayed message is not sufficient.

Migration `031_woocommerce_refund_state.sql` preserves all operation columns,
rows, prior states, primary key, both uniqueness constraints and order index
while adding the explicit manual state. Operations in this state still reserve
their amount and do not resolve the remaining financial obligation. Rollback
requires keeping the additive migration and restoring the prior application
with writes disabled; deleting the pending records or rewriting them as
settled is not a valid rollback.

## Native proof and remaining qualification

```sh
node --experimental-strip-types --test --test-concurrency=1 tests/development/woocommerce-refunds.test.mts tests/development/woocommerce-refund-process.test.mts
```

The cases bind CASE-M07-G02-01 through -03 and retain PORT-019 and TEST-001 through
explicit later-path cases. They inspect the separately persisted source ledgers,
cover killed/concurrent processes, false settlement responses, forged gateway
flags, missing movement/history, original-instrument and balance guards,
authority changes and data-preserving migration. The independent expected
amounts/stages are in `tests/fixtures/woocommerce/refund-ledger.v1.json`.
The packet mutant sets settlement from a Woo record; its behavioral result and
clean-candidate native reports belong in the external finance evidence. New
test registrations and final acceptance records are the integration owner's
responsibility. This author reports readiness; independent review and the
unchanged full regression gate are still required for local integration.

## Primary reference boundary

The official [WooCommerce refund guide](https://woocommerce.com/document/woocommerce-refunds/)
distinguishes manual records from returning money through a compatible original
gateway. The [WP REST API refund reference](https://developer.woocommerce.com/docs/apis/rest-api/v3/order-refunds/)
documents `/wp-json/wc/v3/orders/<id>/refunds`, `api_refund`, and
`refunded_payment`. The [WooCommerce implementation of `wc_refund_payment`](https://github.com/woocommerce/woocommerce/blob/trunk/plugins/woocommerce/includes/wc-order-functions.php)
uses the order's gateway and its refund result. These references were checked
on 2026-10-18 and inform the distinction above; they are not pinned installed
server or gateway qualification. The fixture contract has its own exact version.
A real connection still needs authorized account/endpoints/scopes, an installed
Woo/API and gateway version, complete native history and verified provider
records at the claimed effect stage.
