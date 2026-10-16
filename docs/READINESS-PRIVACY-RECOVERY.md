# Readiness, customer-data lifecycle and safe return drafts

M02-G23 through M02-G27 provide a local diagnostic implementation. SQLite,
synthetic provider responses and deterministic clients are not live platform,
production privacy, model-quality or PostgreSQL/React qualification.

## Action readiness (G23)

Only `diagnostic.resolution.set` can be qualified. An owner configures the existing
gateway; server code verifies its simulator account, contract hash, required read
scope and configuration revision. The proof expires within one hour. Changes to
scopes, account, settings, expiry or revocation deny the action. Previews bind the
proof and execution rechecks it, including queued case-record dispatch.

`POST /v1/integrations/readiness` accepts `{ "action": "diagnostic.resolution.set" }`.
It is a read, not permission to execute. Financial actions and external warehouse
holds have no qualified adapter. A merchant profile cannot certify them. Current
customer verification, policy, permission, stops and exact-preview approval are
still independently required.

## Privacy lifecycle (G24)

Owner-authorized, tenant-scoped endpoints are `POST /v1/privacy/export`, `/erase`,
`/hold` and `/uninstall`. Export/erase accept only `customer_id`. Export includes
attributed resources, attachments, knowledge, tasks/assistance, cases, previews,
operations and linked audit/customer notes. Credentials and session tokens are
excluded. Unattributed text cannot safely be assigned to one person's export and
requires manual scope review; this is not an automatically complete legal access
request response.

`storage-inventory.v1.json` enumerates every current table and column and its
handling class. A new table/column blocks export, erasure and backup until that
inventory is reviewed. All attachments in this diagnostic are database values;
there is no external object store or vector index. Lexical knowledge is purged.

Erasure logically removes linked attachments/current context/customer notes,
invalidates customer sessions and case approval/work authority, and redacts linked
resources and snapshots. Tenant/store-scoped subject hashes and resource
suppression records prevent reimport of the same subject or resource through
normal ingestion and guard direct reinsertion of tracked resources. These hashes
and retained IDs remain pseudonymous data, not anonymous data.

Unbound store knowledge, raw store webhook bodies, simulator response caches and
policy-test facts are conservatively cleared because their text may be unattributed.
This can discard another customer's unattributed copy in the SAME store; no other
store's records are touched. New content with no usable subject attribution cannot
be classified by these tombstones: do not treat the guard as a universal PII
classifier. In-memory/outbox/log/provider copies require separate cleanup. Raw
pages, journals, snapshots and backups are not forensically erased.

An active bounded hold records reason, authority reference and expiration. Erasure
reports `held`; it does not falsely report deletion. Release requires the exact
reference and owner permission. This records an operational decision, not a legal
determination. Uninstall disables store access and integrations, destroys current
encrypted envelopes, and applies erasure except for configured holds. Minimized
operational audit, configuration and suppression records remain. Held records in
an inactive store require server-local retention administration.

## Private snapshots and quarantined restoration (G25)

These are SERVER-LOCAL multi-store deployment operations, with no tenant HTTP
backup endpoint. `createRecoverySnapshot` uses SQLite `VACUUM INTO`, exact manifest
membership, private file modes, content hashes and a fresh destination. Snapshots
contain customer data and encrypted credentials; they are PRIVATE backup material,
not source-distribution artifacts. They contain no wrapping keys or external paths.

Restore requires an independently retained manifest hash and a CURRENT separately
retained suppression checkpoint/hash. The timestamp must not predate the snapshot.
A matching hash proves identity only relative to a trusted expected hash; the code
cannot prove an administrator supplied the newest checkpoint. Retain that control
outside any candidate or old backup. Replaying newer erasures precedes exposure.

A staging directory is published only after migrations/schema/foreign keys and
quarantine succeed. Copied sessions, worker grants, credentials, slots, webhook
routes, approvals and readiness are revoked/disabled. Interrupted sending work is
unknown, not unsent. Every copied operation ID is permanently blocked from replay.

Fresh server-local read credentials are required. `activateDiagnosticRestore`
requires the exact restore identity and no unresolved sending/unknown operation.
It enables only further diagnostic setup; provider/model egress remains forbidden,
old credentials stay revoked and new work requires current configuration and
approval. No live activation method is implemented. Do not expose deployment
snapshot/activation functions as ordinary tenant tools.

## Second-platform read experiment (G26)

The WooCommerce adapter uses fixed GET order/refund paths and explicitly injected
fixture transport. Credential handles stay in the vault. The current adapter
rejects `live` mode, redirects, incomplete refund pagination, missing or duplicate
records, malformed timestamps, changed connections, expired data and conflicting
summary/detail refund amounts. It minimizes returned fields and uses exact decimal
money. The canonical read layer selects readers from a map; it has no store-name
branches or a second model-specific workflow.

`refunded_payment=false` is `manual_record_only`, NOT settled money. True is
`gateway_reported_refund`, still `settlement_verified=false`. A completed native
order is not proof of delivery. Shipment tracking is an unqualified extension;
there are no refund/order writes. Real credentials, a live test store, installed
extension versions and comparison with native records are still unqualified.

## Return draft through one gateway (G27)

The portable `return-draft` skill and deterministic instruction executor accept
only case ID, request key and requested outcome. The server uses verified order
facts, pinned policy/profile and readiness to calculate eligibility/amount.
Unknown fields such as client prices, tenant identity or approval flags fail.
`POST /v1/return-drafts/prepare` calls the SAME gateway as manual execution;
`/resume` retrieves the stored draft using only case ID. A repeated intent returns
the original preview; conflicting intent is rejected. Separate-role exact-preview
approval remains mandatory, and execution rechecks current facts. A stale draft
can be inspected but never gains authority by being resumed. No refund, shipment,
payment or stock action is enabled.

The example Python client imports no server or model framework. It uses a private
session file and loopback REST, verifies response semantics and never follows a
redirect. This is deterministic client portability, not qualified AI autonomy.

## Commands

```sh
npm ci --offline --ignore-scripts
python3 tools/verify.py --runtime --harness
node --experimental-strip-types tools/demo-assurance.mts
node --experimental-strip-types tools/demo-assurance.mts --serve
```

The served demonstration prints `/return-draft` and a private temporary session-file
path, not tokens. Select `return_case`, use `operator` and a different `reviewer`.
`short_window_operator` selects the one-day policy that denies the same three-day
old order. Headless mode proves the same skill's two-merchant behavior, draft
resumption, erasure and suppressed-data restore. It makes zero external calls.
Ctrl-C stops the served demo and deletes its temporary session file. Do not archive
that directory. The source archive contains no runtime database or credential.

Tests use Node 22.16.0, Python 3.13.5 and Linux. Browser checks in the retained suite
still require the documented host Playwright/Chromium. Two new rendered-component tests exercise the real local API through an explicit
bridge, including resume/approval/execution and a policy denial. Browser network
is blocked by the test and this is not direct served-browser or React qualification. No new dependency or custom scheduler is required.

## Primary technical references (checked 2026-10-16)

- [WooCommerce orders](https://developer.woocommerce.com/docs/apis/rest-api/v3/orders/):
  string amounts, order statuses, timestamps, customer and refund references.
- [WooCommerce order refunds](https://developer.woocommerce.com/docs/apis/rest-api/v3/order-refunds/):
  `refunded_payment` reports API refund; `api_refund` selects gateway refund creation.
  This implementation only reads and never assumes settlement from a manual record.
- [SQLite VACUUM INTO](https://sqlite.org/lang_vacuum.html): consistent snapshot into
  another file. This does not provide off-host retention, backup encryption, or a
  malicious-process sandbox; those remain deployment responsibilities.

## Next work and limits

All original roadmap criteria remain. M02-G99 is the next milestone assessment;
PostgreSQL/React, true external platform/model integrations and independent hosted
security/privacy/recovery qualification remain open. No synthetic result grants
full milestone acceptance. Start from accumulated main, not an older goal branch.
