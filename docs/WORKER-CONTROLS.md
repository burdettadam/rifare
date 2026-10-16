# Worker control and operator recovery

This checkpoint implements M02-G18 through M02-G22 in the existing SQLite
synthetic runtime. It does not qualify the PostgreSQL/React target, remote OAuth,
a model, real payment or message delivery. The owner delegated local maintainer
review and integration in ADR-0019; independent reviewer sessions are not claimed.

## Execute the diagnostic

```sh
npm ci --offline --ignore-scripts
python3 tools/verify.py --runtime --harness
node --experimental-strip-types tools/demo-worker-controls.mts
node --experimental-strip-types tools/demo-worker-controls.mts --serve
```

The headless demo creates verified synthetic case actors, then lets an agent
submit a proposal for separate approval. The only gateway effect remains a local
reversible case-plan marker, not a refund. A separate in-memory source journal
accepts one synthetic effect and loses its response. An expired owner loses access;
a replacement sees the original context and cannot create a new proposal until
read-only reconciliation resolves the prior operation. Reconciliation works while
execution is stopped and does not resend the command. Two synthetic credential
probes use different encrypted versions. There are zero external requests.

The serving variant prints `/exceptions` and a private temporary session-file
path. Read the operator or owner token from that file; tokens are never printed
or embedded in page source. Ctrl-C stops that server and removes the temporary
file. Both databases and wrapping key are ephemeral. The UI clears secrets from
inputs, does not use browser storage, and discards late responses after sign-out
or a new sign-in. Six Chromium component tests bridge to the actual API; they are
not a direct served-browser or React qualification. The full tests use the
existing Node 22.16.0/Python/Playwright/Chromium Linux environment.

## M02-G18: finite ownership

A work grant is scoped to one tenant, store, case, parent session and exact
loopback audience. The stored token is hashed. Claim establishes a generation,
owner, configuration digest, stop revision, lease expiry and hard deadline.
Lease durations are 10–30,000 ms; each assignment has a maximum 60,000 ms deadline
and cannot outlive its grant. Grant lifetime is at most 300,000 ms, with 32 active
grants per parent session. A renewal cannot extend the hard deadline.

Reclaiming an expired assignment increments its generation atomically. An active
assignment held by another grant cannot be taken over without authorized release.
A stale worker cannot prepare or execute work, even with its original token. Scope
checks include the exact case, not merely its order. Session and membership
revocation, narrowed resource permissions, pinned configuration changes, and stop
revisions are rechecked. The trusted server code is not a sandbox for hostile
code running inside the same process or with database administration access.

Unknown or sending operations for the resource block fresh proposals. Takeover
is permission to inspect and reconcile existing state, not permission to repeat
an uncertain effect. Completion stores a handoff/proposal reference only; no
customer message or monetary result is fabricated. Same-body completion and
submission retries return their existing identity. Renew/claim concurrency tests
use actual separate Node processes against the same database.

## M02-G19: portable client contract

`packages/commerce/contracts/worker-api.v1.json` documents the local interface.
`clients/case_worker.py` is an independent standard-library client. It reads its
private configuration from stdin, not command-line arguments; it has no server,
model-provider or runner imports. It claims, retrieves content/configuration,
submits a typed proposal and rereads the same stable result. It cannot approve.

Authenticated store session routes:

- `POST /v1/work-grants`: `{case_id,lifetime_ms}`; server supplies identity/audience.
- `POST /v1/work-release`: `{case_id}`; requires current work-management authority.
- `GET /v1/worker-contract`: inspect the published contract.

Work-grant routes under `/v1/worker` provide claim, context, renewal, proposal,
approved execution, completion and result retrieval. Context supplies pinned skill
files and selected order facts, not raw customer records, secrets or provider
threads. A request must echo the exact server envelope, but echoing it confers no
authority: current database state is checked again. Tenant/store overrides,
configuration changes, extra approvals and cross-audience tokens are rejected.
An ordinary session is not a worker token, and a worker token is not a general API
session. Historical result retrieval also rechecks current order access.

These are locally scoped opaque credentials, not an OAuth authorization server or
an asserted remote MCP authorization implementation. HTTPS, remote authorization,
third-party SDK conformance and live external-agent qualification remain separate.

## M02-G20: credential cutover and wrapping-key rotation

`CredentialLifecycle` builds on `SecretVault`. A named slot selects the current
immutable version and opaque encrypted reference. Cutover uses expected revision,
preserves provider/adapter identity, revokes previous refs, and commits atomically.
Each new synthetic probe resolves that current version; there is no plaintext
credential cache. Historical call receipts retain version numbers, not key bytes.

A cutover or revocation during a call makes its result unknown. It does not claim
to cancel an already transmitted external action or erase a buffer captured by
trusted adapter code. The one-second probe deadline returns unknown with no
retry, and late completion cannot replace that record with success. Original
vault checks remain active. Rewrapping and reopening with the old wrapping key
removed works; removing the only key without rewrapping fails closed.

This batch integrates lifecycle behavior with the existing synthetic boolean
probe. Existing live-provider configurations are not automatically migrated to
slots, and no live credential was rotated. The platform, not a model transcript,
owns raw credential resolution. Remote key-management qualification remains open.

## M02-G21: stop controls and explicit resume

Stop scopes are global, store and action. An owner may manage its own store/action
switch; deployment-wide control is a trusted server-local method with no tenant
HTTP route. Every switch has a compare-and-set revision and bounded reason. A
stop or resume invalidates earlier previews, work-fence stamps and queued dispatch
permissions. Claim and execution check the current state; dispatch rechecks just
before its trusted adapter call. The existing model runner checks after a provider
response and before returning an answer, preventing a stopped run from delivering
its generated result.

Reads, audit records and source-bound reconciliation remain available. An already
committed source effect is recorded/reconciled rather than dishonestly erased by
a stop. Resume does not execute work: a new case lease/preview or explicit owner
reauthorization is required. Reauthorization only applies to known-unsent queued
or retry-wait synthetic work, uses the expected operation revision, and cannot
turn an unknown result into a retry. This is not financial approval for real money.

## M02-G22: actionable exceptions

The manual queue distinguishes unknown outcomes, known failures, stopped work,
stale owners and reauthorization requirements. It follows the operation's exact
case receipt (multiple cases may share an order), displays current/previous owner
and generation, and combines immutable/control events chronologically. It enables
only currently authorized reconciliation or known-unsent reauthorization. There
is deliberately no retry route, and all unknown retry buttons remain disabled.

Scanning is bounded to 500 operations and 500 case assignments with at most 100
returned items; the default is 50. Truncation is explicit in the response and UI.
This is a bounded diagnostic queue, not yet a paginated large-merchant dashboard.
Use recorded operation IDs for deeper investigation. Tenant/resource filters,
source identity, current permissions and expected revisions apply on every action.
No lease token, raw proposal body or secret is rendered. Persisted operations and
ownership survive process restart and runtime replacement.

## Qualification and authoritative background

SQLite transaction/isolation behavior informs atomic fences and savepoints:
https://www.sqlite.org/isolation.html
https://www.sqlite.org/lang_transaction.html

Credential versioning, rotation and revocation design follows the concerns in:
https://cheatsheetseries.owasp.org/cheatsheets/Secrets_Management_Cheat_Sheet.html

These sources explain design inputs, not certification of this implementation.
The previous target-stack, model, live-store and served-browser gaps remain open.
