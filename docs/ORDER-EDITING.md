# Safe order editing

## Scope and current state

M04 supplies a SQLite diagnostic order-edit workflow and a separate synthetic store/warehouse source. Address changes, variant replacement, cheaper/higher-priced edits, cancellation, payment observations, per-warehouse acknowledgement, and owned-hold release use the existing permission and approval gateway. No live store, payment, warehouse or carrier adapter is installed. Full M04 qualification is recorded separately in [M04-QUALIFICATION.md](M04-QUALIFICATION.md).

There is no new dependency, scheduler, agent provider or model-specific task state. `safe-order-edit` is an instruction-only bundle. Its configuration and content are pinned per case; REST, the manual interface and an independent standard-library Python client consume the same source-backed workflow.

## Commands

The tested diagnostic toolchain is Node 22.16.0, Python 3.13.5 and Linux; the full component harness also needs the previously documented Playwright/Chromium installation.

```sh
npm ci --offline --ignore-scripts
python3 tools/verify.py --runtime --harness
node --experimental-strip-types tools/demo-order-edit.mts
node --experimental-strip-types tools/demo-order-edit.mts --serve
```

The served demo prints `/order-edits` and a private temporary session-file location. That file contains operator/reviewer credentials, `edit_case`, and the approved skill digest. Credentials are not embedded in the page or printed. Ctrl-C stops the instance and removes its session file. The demo uses in-memory databases and fixed synthetic observations, not a long-lived production clock.

The default variant is an upgrade. Its invoice remains unpaid in the manual demo: **there is deliberately no HTTP endpoint to assert or simulate settlement**. Use `equal` to exercise the complete zero-balance manual flow. The headless demonstration explicitly invokes the synthetic fixture settlement capability and labels it as such.

## Authority and lifecycle

1. An owner configures independent address/item/cancellation windows, stock buffer, source identity, warehouse list, evidence expiry and payment TTL. The readiness probe uses temporary source records to observe whether the actual synthetic picking predicate stops and whether version updates are consumed. Tag-only acknowledgement does not qualify. The probe rolls back its temporary records.
2. An authorized operator refreshes source snapshots. Scope, order/customer identity, source identity, capability readiness and actual fulfillment state are checked. Supported source facts also update the canonical read projection; native partial states remain explicit without breaking the established read-status contract.
3. A client supplies only its desired action and identifiers/address. The server calculates original versus final amounts, discounts, tax, affected lines, deadlines and warehouse identities. Changed configuration, source facts or approval revoke stale execution.
4. The existing gateway requires a separate reviewer and exact one-use approval. Its execution records an edit, not a native commit or a settled payment. One active edit per order prevents competing obligations.
5. Dispatch acquires independently owned edit and payment/refund holds from every affected warehouse. It performs synthetic native begin/change/commit with stable per-stage operation IDs. Source checks independently re-evaluate stock, line state, amount and deadline. Commit and stock changes are transactional at that source.
6. Additional invoice or refund obligations are separate native records. An edited order may exist while money is unpaid, failed, partial, expired or unknown. Correct amount, currency, customer, source and order version are required for settlement observations. A duplicate settlement cannot count twice. An actual late settlement can be recognized only for the still-corresponding order obligation.
7. Warehouses consume the final order version/digest only after applicable settlement, except cancellation acknowledgements, which stop fulfillment before waiting for the refund. Exact current acknowledgements and zero due are necessary for release.
8. Release removes only this edit's named reasons using a source warehouse revision check. A foreign/fraud hold or any uncertain stage blocks release. `released` does not mean shipped; picking and shipment are distinct source states.

## Uncertain and partial outcomes

Before every external stage the application persists `unknown`. It never resends an unknown stage simply because the caller retries, changes a request key, switches agents, or restarts. Read-only reconciliation looks up the original operation and validates its identity and result. An absent record remains unknown; it is not a known-unsent retry permission.

The same independent execution stops, worker fences, current reviewer authority, source configuration and restored-environment quarantine continue to apply. Reconciliation is permitted during execution stops, but not automatic outbound access from a quarantined restoration.

If invoice/refund creation fails, the UI retains the actual edited order and uncertainty. An expired/failed/partially paid invoice keeps fulfillment held. There is no automatic roll-back, refund of partial collections, restoration of stock or replacement invoice. Those compensations require qualified source-specific work; operators must not manually mark the obligation paid or clear other systems' holds. A new cancellation cannot bypass an active uncertain edit.

## Supported diagnostic envelope

- Physical US/USD orders. Address changes are limited to the same state and postal prefix with unchanged known shipping/tax treatment; no address-validation or tax-service qualification is implied.
- Same-product variants with original fixed discounts and exact integral tax calculations. Fractional tax rounding, currency changes, unknown catalogs and insufficient stock are rejected.
- Per-line eligibility in partially fulfilled orders. Shipped lines remain shipped. Whole-order address edits on split shipped orders and targeted subscriptions are unsupported.
- Remaining-order cancellation addresses each affected warehouse. Shipping fees are retained as recorded; there is no implied full-shipping refund policy.
- Source-backed finance status, not delivered email invoices or a live payment gateway.
- Source holds protect only the declared synthetic warehouses. This is not proof that a real warehouse honors tags.

## APIs and portability

Authenticated POST routes are enumerated in `packages/commerce/contracts/order-editing.v1.json`. Inputs reject extra source, tenant, amount, permission or approval fields. Source objects are supplied server-side only. Default diagnostic startup does not install a source adapter.

`/v1/edit-workflows/open` pins `case_id` and `skill_digest`; `/status` returns guidance resources with hashes, effective settings and operations; `/quote` accepts only the desired change. `/v1/order-edits/prepare` produces the existing gateway preview. Existing `/v1/execution/approve` and `/execute` retain identical authority semantics. Read task resumption does not authorize repeating native actions.

`clients/order_edit.py` reads a JSON input on stdin containing `url`, `token`, `case_id`, `skill_digest`. It permits only explicit loopback HTTP, disables proxy inheritance/redirects, verifies returned skill-resource hashes, and prints source-backed status. It imports no server, built-in agent or provider runtime. It is deterministic orchestration, not live AI-model qualification.

## Privacy, recovery and diagnostics

Addresses are held in scoped edit inputs and source snapshots, not quote/audit outputs. Customer export includes these records; logical erasure removes private local input/quote/snapshot bodies. Minimized operation identifiers, hashes and pin provenance remain for reconciliation. The separate source database and backups require independent lifecycle handling. This is not forensic erasure or a privacy-compliance certification.

Read inspection shows separate native, finance, warehouse and local states. Missing source evidence is `null`/unknown, not successful completion. All readiness results explicitly report `synthetic_only`; no client field can promote live qualification.

The new component tests render actual HTML/JavaScript with an explicit bridge to the loopback API. They are not a direct served-browser test. The direct attempt on this host returned `ERR_BLOCKED_BY_ADMINISTRATOR` and remains unqualified.
