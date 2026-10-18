# Common return, refund and notification lifecycle

This local development surface connects WooCommerce order facts to the existing
case, `handle-return` skill, policy, preview, independent approval, receipt,
resolution and notification services. It does not configure a connected store,
gateway, model provider or live message account. The formal qualification gaps
are listed in [M07 qualification](M07-QUALIFICATION.md).

## Staff workflow and recovery

Open `/return-portability` on the existing commerce diagnostic service. Supply a
current staff session, a separate reviewer session and a verified case ID. The
page uses the existing return and execution APIs to preview, approve and submit
one requested unit. A subsequent allocation, refund quote and separate approval
create a financial operation. Dispatch and reconciliation retain that original
operation ID. The page reloads existing previews and usable approval IDs from the
server; refreshing does not require another approval or create another request.

The Woo path creates a composed local RMA with `native_return_id:null` and no
native return operation. Refund processing does not imply native return creation.
The page displays the actual payment stage and uses the original notification
operation for reconciliation. Case/session changes invalidate visible context,
including late responses. Session values are held only in memory and cleared on
page exit. Server permissions remain authoritative for every action.

`POST /v1/return-portability/context` is a read composition, not an action engine.
It returns the current case, order, form, request and minimal original references.
Private previews, allocations, financial operations and notifications are present
only when the current caller has `operation.read` for the exact case resource.
An unavailable executor cannot bypass an explicit read denial. The customer view
contains no staff approvals or financial operation projections.

## Qualified agent and delegated-runtime paths

The permanent common-journey case exercises both staff HTTP calls without a model
and an agent-role HTTP client against the same services. An agent-owned support
case needs an exact reviewed diagnostic qualification and `approval_required`
mode for each of `diagnostic.return.submit` and `diagnostic.return.resolve`.
Changing from the return action to the refund action requires an owner to bind the
corresponding qualification. Copilot mode, wrong-action pins, revoked review and
amount limits still block execution. A separate canonical action approval is
required even when the local qualification is current.

The test configuration freezes ten expected source/configuration facts before
registering the corresponding observed fixture values and separate reviewer
decision. Its `no_model_fixture` and `local_http_agent_fixture` pins describe a
deterministic local client. This is not a model-quality evaluation, merchant
attestation or connected-provider qualification. No role permission is expanded:
the agent cannot dispatch or reconcile money or dispatch the durable mail outbox.
An existing authorized operation worker performs that source I/O.

For separately implemented TypeScript/Python clients, see
[independent return runtimes](INDEPENDENT-RETURN-RUNTIMES.md). Their case work
grants are narrowed from existing operator-parent authority. Both clients retain
the same approvals, configuration, source identity, operation IDs and receipts.
Unknown effects must be reconciled before another write. Ownership changes revoke
earlier grants and do not create replacement business operations.

## Notification facts and at-most-once effects

`RefundMessageFacts` reads the original canonical refund command, quote, approval
receipt and latest observation. For Woo it also verifies the independently stored
Woo obligation/refund record and the separate gateway effect and movement. The
canonical observation must equal the independently reconstructed source result.
Amounts, customer, case, resource, configuration, source identity and freshness
must agree. RMA closure is not an input to financial completion.

| Proven stage | Permitted local message |
| --- | --- |
| Manual Woo refund record | External settlement is pending; payment return is unconfirmed. |
| Gateway accepted | The test gateway accepted the request; settlement is unconfirmed. |
| Matching Woo record and settled gateway movement | Settlement is confirmed in the local test gateway; no live payment was made. |
| Missing, inconsistent, stale or unknown evidence | No refund-completion message may be queued or sent. |

`event_id` for either refund template must be the existing canonical refund
operation ID. Its notification identity binds tenant, store, case, template and
that operation, so a new sender, link or owner cannot multiply the same event.
The outbox still checks current ownership, sender, contact, purpose/consent,
execution controls and the refund facts immediately before invoking its source.
Changed facts suppress the old queued payload. An unknown send is looked up using
the original notification ID; a repeated webhook or runtime switch does not
justify another source send. Mail acceptance is separate from customer delivery.

An adversarial fixture inserts a closed-RMA display record while the independent
manual refund remains pending. The completion template must reject it. The test
does not claim that an approved cancellation with outstanding obligations is a
supported workflow. Separate source-loss cases verify the equivalent rejection
when a gateway movement exists but its matching Woo refund record is missing.

## Storage and privacy compatibility

Migration 030 adds three core tables, bringing the complete diagnostic schema to
170 tables. Migration 031 extends the refund-state constraint while preserving
all existing operation columns, rows, states, keys and indexes.

`storageInventoryCurrent()` returns the complete current inventory, version 2,
with schema digest
`6e8fd17800ab49965a9cf964a4652877ee1784dbaa3dd78263a6dd19e4881d3f`.
All privacy export, erasure and recovery validation paths use this full view.
Authenticated `GET /v1/privacy/inventory` requires `privacy.manage` and returns it.
Unknown tables, missing tables, or changed columns cause validation to fail.

The earlier inventory format had grown with previous migrations. This batch now
introduces an explicit **legacy M06 projection** for callers of the existing
`storageInventory()` helper: its 167-table result is labelled
`legacy_schema_projection:'m06-167'` and reports the current table count, digest
and full-view function. Both functions validate all 170 actual tables before
returning. The retained 167-table test remains unchanged; it is not evidence of
current coverage. Separate new tests compare the actual complete schema with the
170-table contract and reject covert columns in the newly introduced tables.

Woo source bindings and event observations are subject-linked caches and are
deleted during logical erasure. Local RMA bodies retain only a redacted marker and
original digest for minimized business audit. Woo records are included in the
subject export. Existing core notification payload and contact cleanup also cover
the two new templates. Erasure prevents further core reads, sends and reimports;
it does not claim to delete an independently retained payment-source ledger.
External/source retention remains an explicit cleanup and qualification gap.

## Verification and rollback

Permanent tests exercise real local HTTP requests, canonical database records and
independent source counts. The mobile browser component uses actual application
HTML/CSS/JavaScript, with fetch bridged to the real loopback service. Browser
network egress is blocked; this is component-plus-local-HTTP evidence, not direct
served-browser or target React/PostgreSQL qualification. Source fixture settlement
is performed by test administration between two browser sessions and is never
exposed as a merchant HTTP action.

The source and frozen fixture tests are retained in the repository. Exact native
reports, targeted faults, independent reviews and recovery reports are supplied in
the cumulative handoff. Earlier dirty-checkout setup failures are retained as
exploratory feedback and are not counted as feature fault proof. The final frozen
candidate gate supersedes branch and exploratory results.

Rollback uses the protected `ad6c510` source/history checkpoint and its matching
diagnostic database backup. Do not drop new tables or reinterpret manual-pending
rows in a database with unreconciled operations. Stop writes first and preserve
source obligations, original operation IDs and audit records during recovery.
