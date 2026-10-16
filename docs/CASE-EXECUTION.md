# Case pins, skill releases, approved actions and webhook intake

M02-G08 through M02-G12 are implemented for the SQLite diagnostic profile.
The only writable business action is `diagnostic.resolution.set`: it changes a
reversible local case-plan marker. A hypothetical refund amount is preview data,
not a financial transaction. No payment, order edit, outbound message, provider
callback or production mutation is enabled by this module.

## Run

Use Node 22.16.0 and the documented Python/Playwright/Chromium diagnostic host:

```sh
npm ci --offline --ignore-scripts
python3 tools/verify.py --runtime --harness
node --experimental-strip-types tools/demo-execution.mts
node --experimental-strip-types tools/demo-execution.mts --serve
```

The command without arguments runs an in-memory demonstration: verified synthetic
customer, pinned case, preview, separate reviewer approval, execution, rejected
replay, separately approved reversal, and persisted duplicate webhook receipt.
It prints no credentials and makes no external request.

`--serve` creates the same isolated in-memory fixture and prints a loopback
`/execution` URL plus a private temporary session-file path. The file contains
operator/reviewer tokens and the case ID; it has mode 0600. Paste the operator
token for preview and the separate reviewer token for approval. These synthetic
roles demonstrate separation; they are not independent project reviewers. The
customer proof expires, so restart the ephemeral demo when it expires. Ctrl-C
closes this server, discards its database, clears its signing-key buffer and
removes its private temporary directory. Do not use this fixture for real data.

The existing `tools/dev-commerce.mts` remains read-oriented. It does not silently
configure the new execution gateway or manufacture a verified customer case.

## M02-G08: immutable effective configuration

`packages/commerce/case-configurations.mts` stores the exact skill ID/version and
archived content digest, profile body/hash, published policy version/selection,
compiled settings and field provenance, adapter/action contract, connection
revision, release assignment, customer and order resource. A later default change
does not rewrite existing records. Missing content, corrupt hashes and emergency
revocation fail closed. `current_at_quote` policy changes require explicit
migration/repreview. An authorized migration compares the case revision, records
its reason, retains old snapshots and invalidates earlier previews.

Identity verification remains independent of these snapshots. A staff-created
case is not customer proof. A case opened by a verified customer records the
actual order-only session identity; expiry, revocation and customer reassignment
are checked again. This diagnostic proof establishes identity, not payment consent.

## M02-G09: publication lifecycle

`skill-releases.mts` stages an exact archived digest, evaluates the instruction
contract, records a different authorized reviewer's decision, and publishes using
an expected activation revision. Evaluation here is structural contract evidence,
not model-quality evidence. The evaluation digest covers the author, exact
content and rollout percentage. It cannot be reused for an enlarged rollout.

A deterministic canary requires an already published full fallback; nested
canaries are rejected. The selected release is pinned to the case. Rollback
selects a previously published full release and appends an activation record; it
does not change prior cases. Emergency content revocation stops future use even
for pinned cases. Completed receipts remain accessible for reconciliation.
Original installation approvals remain bound to their archived content; reinstall
cannot silently renew old cases' authority or replace valid current content with
a revoked digest.

## M02-G10 and M02-G11: shared gateway and exact approvals

`action-gateway.mts` is used by direct calls, REST, the manual page and the separate
local action-MCP surface. The owner explicitly selects the allowed profile/policy
mapping before enabling it. A user cannot pick an unrelated permissive policy.
Only the synthetic adapter and `diagnostic.resolution.set` are supported.

Every preview binds tenant/store, verified customer, case/configuration revision,
order source version/hash, effect revision, policy and adapter/settings revisions,
exact derived amount/currency/ceiling, action arguments, expiry and one-use limit.
The server derives money from source facts, not client-supplied amounts. Unknown
policy facts are errors, not invented defaults. An authorized reviewer distinct
from the proposer approves the exact preview digest. Agents and customers cannot
approve. A grant to call a tool cannot enlarge underlying permissions.

Execution acquires the database write lock, then revalidates permissions, proof,
current facts, pinned configuration, approval identity/revision and expiry. One
transaction consumes the approval, changes the local marker, and stores a receipt.
A changed price, permission, configuration or effect requires a new preview and
approval. Two real Node processes racing on the same approval produce one receipt.
There are no remote side effects inside this transaction. Remote reconciliation,
financial consent, durable asynchronous dispatch and generalized write adapters
belong to later goals, not this demonstrated atomicity claim.

See [the new OpenAPI subset](../packages/commerce/contracts/execution-api.openapi.json).
The old read contract and read MCP remain unchanged. New endpoints include:

- `/v1/cases`, `/v1/cases/{id}`, `/v1/cases/{id}/migrate`.
- `/v1/execution/configure`, `/preview`, `/approve`, `/execute`, and receipts/state.
- `/v1/skill-releases/{stage,evaluate,review,publish,rollback,revoke}`.
- `/v1/execution/grants` and `/execution-mcp`.

Action-MCP grants are short-lived, case/tool/audience-scoped local opaque tokens.
It exposes preview, execute and state, but no approval tool. This is a local
JSON-RPC/tool subset, not a complete remote OAuth deployment. No model or agent
framework is needed for either transport. The manual page uses text rendering,
in-memory credentials, stale-response guards and a separate reviewer credential.

## M02-G12: raw signature verification and persistence

`webhook-inbox.mts` and `adapters/webhooks/signatures.mts` verify the original bounded
byte buffer before parsing JSON. They reject duplicate/invalid headers, malformed
signatures, wrong key/route/topic/domain, invalid payloads and excess bodies.
A trusted host supplies keys by opaque reference; registration pins a fingerprint.
No key or authorization headers are returned to ordinary clients or retained in
inbox metadata. Fixed route mapping and current store state determine storage.

Only a committed inbox insert can return an acknowledgement. Duplicate delivery
IDs with identical bytes return the existing receipt; differing bytes conflict.
Persistence failure produces HTTP 503 and no acknowledgement. Raw bytes and their
hash survive reopening the database. The parsed display payload is not authority
for external identifiers or downstream execution; consumers must validate from
retained raw bytes, including numeric precision, under their own schema.

The synthetic fixture signs route/domain/topic/delivery/time and body. It is
explicitly synthetic. Shopify-style HMAC fixtures authenticate raw body bytes but
not tenant-routing headers. They are therefore stored as **quarantined**, with
`routing_verified: false`, until a separate authoritative ownership lookup can
establish routing. A body signature or random route URL is not proof of tenancy.
Shared signing keys are refused across registered store mappings. This cautious
subset is not a live Shopify webhook integration. There is no event dispatcher,
external resource lookup or automatic source synchronization in this goal.

Official protocol references, checked 2026-10-16:
[signature verification](https://shopify.dev/docs/apps/build/webhooks/verify-deliveries),
[delivery headers](https://shopify.dev/docs/apps/build/webhooks/delivery-structure).

## Evidence and recovery

All earlier executable tests and registrations are retained. New CASE IDs map to
actual native tests in `tests/development/`. Browser-component tests use Chromium
with an explicit bridge to the actual loopback API; they do not qualify direct
served-browser navigation, React, production authentication or PostgreSQL.

Migration 010 is additive. Do not delete or change applied migration checksums.
For rollback use a known pre-migration diagnostic backup with its matching source;
retain new case/approval/receipt records before any explicit migration decision.
Raw logs, mutation patches, browser artifacts and trusted-controller results live
outside Git in the separate evidence delivery. Runtime sessions, keys and databases
must not be committed or included in source distribution.
