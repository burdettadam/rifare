# M06-G07 and M06-G08 — Currency and final-fee author assignment

State: in_progress; local diagnostic preparation, not connected qualification.
Writer: `/root/finance_goals`. Integration owner: `/root`.
Branch/worktree: `goal/M06-currency-fees`, `Rifare-M06-currency`.
Base: `2fe529eb379734b04470bf7f0663a5440c78c314`.
Authority: ADR-0029, recorded before implementation at `591e19c`, and the owner's
renewed instruction/delegation in the delivered continuation prompt. Independent
authority and regression reviewers are assigned by the integration owner.

Read root AGENTS, GOVERNANCE, DEVELOPMENT, ARCHITECTURE, PLANS, work-goal and
worktree-flow skills, the G07/G08 packets and unchanged original test contracts.
M03-G99, M04-G99, M05-G99, formal G04/G07 acceptance, connected accounts and
merchant/provider qualification remain blocked. The assigned work does not waive
those requirements or authorize external/live/paid effects.

## Concrete ownership and contract

New owned paths: `packages/commerce/exchange-currency.mts`,
`packages/commerce/exchange-fees.mts`,
`packages/adapters/exchange-money-fixture-source.mts`,
`migrations/commerce/025_exchange_money.sql`, additive currency/fee native tests
and helper, `tests/fixtures/exchange-money/golden.v1.json`, and
`docs/exchange-money.md`. Root additionally delegated narrow integration edits in
`refund-quotes.mts`, `exchange-finance.mts`, `resolution-execution.mts`, and
`resolution-fixture-source.mts`. Root retains the allocation ledger, fulfillment,
action gateway, API, lifecycle/privacy integration, registration and inventory.
All prior tests, golden fixtures and protected controls remain unchanged.

The implemented G07 envelope is a synthetic, source-qualified original-allocation
cash refund with exact shop and presentment amounts. It is not full currency-safe
exchange settlement: paired-currency replacement/exchange, additional payment and
foreign-currency store credit remain rejected. Qualification is confined to the
explicit fixture account, API version, market, card instrument and currency pair;
no merchant or provider has been connected or qualified.

G07 preserves the original canonical paid currency, exact independently seeded
shop/presentment component allocations, original rate/source provenance and duty
amounts. Named account/API/market/instrument fixture evidence is source-owned;
caller labels do not qualify conversion. Current rates cannot reprice an original
refund. Native pre-transport bindings must detect omitted or changed money fields.
The existing money module's explicit currency/precision subset is retained.

G08 stores estimate and final fee/tax observations separately. Any changed final
requires a new exact preview and approval before authorization. A final arriving
after authorization, unknown delivery, settlement or apparent closure remains a
visible difference on the original operation; it never supplies a new effect key.
Uncertain effects remain reserved and reconcile from their original native source.

## Predeclared evidence

Permanent stable cases will implement CASE-M06-G07-01/02/03 and TEST-015, and
CASE-M06-G08-01/02/03 and TEST-016, plus source/approval/receipt/idempotency and
boundary negatives. Independent expected amounts are recorded before source in
`tests/fixtures/exchange-money/golden.v1.json`; expected values will not be computed
by the production function under test. Deliberately broken candidates will use an
unstored current conversion and overwrite the estimate/reuse a changed approval.
Native source effect counts must fail behaviorally for stripped money bindings.

Actual commands use the matched Node 22.16 runtime with native named test cases.
Raw positive, failed and mutant reports stay outside tracked source under ignored
`evidence/M06-currency-fees/`. Final source identities and independent review
references will be recorded after they exist.

The first coherent author checkpoint executed 36 new native cases: 19 currency
and 17 fee cases, all passing with Node 22.16. The retained affected suites added
152 cases: 145 passed; seven gift privacy/recovery cases failed with
`STORAGE_INVENTORY_CHANGED` because root's separately owned inventory/privacy
integration for additive migrations 024/025 is not yet on this branch. These raw
failures are retained, and this checkpoint does not claim a passing complete gate.
The retained money, quote, execution, payment, residual, bundle, gift-credit source
boundary and exchange-fulfillment suites passed. Exact commands and raw TAP are
indexed in `evidence/M06-currency-fees/author-iterations/checkpoint-runs.json`.
The first currency iteration had one new-test preview-property typo (18 passed,
one failed); the corrected second run passed 19. That typo is not feature-red
proof. Deliberately broken behavioral variants remain pending at this checkpoint.

Root's G06 source-boundary dependency `b516470` was cherry-picked before this
checkpoint; root already owns that change. Native lineage binding precedes the
replaceable resolution transport, and the native source checks it before effects.

## Current platform evidence and recovery limits

Read-only primary documentation on 2026-10-17 identifies Shopify API 2026-10's
estimated `CalculatedReturnShippingFee.taxAmountSet` and nullable-until-processed
`ReturnShippingFee.finalizedTaxAmountSet`. The published US tax behavior starts
2026-10-23; it is not treated as already observed. Documentation does not establish
account/provider support or settlement. Exact URLs and field limits go in the
scope guide; no API credentials or connected calls are used.

Migration 025 will be additive. Retain matching canonical and independent native
source state; disable effects during restore and reconcile uncertain operations.
Do not delete fee history or monetary reservations to downgrade. This author
reports ready for review or blocked and cannot self-accept. Stop after G08.
