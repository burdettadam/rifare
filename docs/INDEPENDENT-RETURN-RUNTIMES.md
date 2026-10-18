# Independent local return runtimes

M07-G04 adds two independently implemented local orchestration clients for an
approved, incomplete return or original-payment refund. They use the same
server-owned case, skill, profile and policy snapshots. A runtime change preserves
the original previews, approvals, receipts, allocations and financial operation
IDs. It revokes the prior opaque work grant and advances the existing work lease
generation. The clients install no scheduler, model provider or private case
database.

This is the bounded fixture-development slice assigned by
[ADR-0031](decisions/0031-second-platform-local-development.md). Connected runtime,
merchant, gateway and platform qualification remain blocked. These are delegated
local runtime clients using operator-parent authority; they are not certified
model providers or an expansion of the existing agent role's money permissions.

## Separate implementations, common business authority

| Implementation | Control flow | HTTP transport | Runtime dependencies |
| --- | --- | --- | --- |
| `clients/return_runtime.mts` | Procedural, bounded decision loop | `node:http` | Node.js standard library |
| `clients/return_runtime.py` | Explicit claim/load/validate/reconcile/approval/effect state machine | `urllib.request` | Python standard library |

The Python implementation does not invoke the TypeScript client, and neither
loads a shared client orchestration helper. Both intentionally use the canonical
`WorkerApi`, `WorkLeases`, `ActionGateway`, `ReturnIntake` and
`ResolutionExecution` business services. Sharing those authority and ledger
services is the portability boundary. Independent orchestration does not mean
creating independent approval or money state.

Both clients fetch the actual skill files and current server context, verify the
exact audience, case, resource, generation and configuration digest against the
lease, and retain the same skill/profile/policy digests during a run. A replacement
process begins with a new grant and reads all prior work from the server. No
conversation transcript, model memory or client-side checkpoint is an input to
continuation.

## HTTP contract and current authority

The additive contract is
`packages/commerce/contracts/return-worker.v1.json`. The older
`worker-api.v1.json`, legacy proposal endpoints and legacy `WORK_ACTIONS` scope
retain their existing behavior. The ordinary commerce server can inject its
existing, same-kernel `ResolutionExecution` instance into `WorkerApi`; missing
financial source configuration removes dispatch/reconciliation from available
actions.

| Endpoint | Body | Result |
| --- | --- | --- |
| `POST /v1/worker/claim` | `lease_ms` | Existing case work lease |
| `POST /v1/worker/return-context` | `generation` | Minimal request, original approvals/receipts, current refund facts and blockers |
| `POST /v1/worker/return-action` | `generation`, exact `envelope`, `action`, `arguments` | Canonical receipt or verified source observation |

The allowed actions are deliberately narrow:

| Action | Arguments | Current parent permission |
| --- | --- | --- |
| `approved-preview.execute` | `preview_id`, `preview_digest`, `approval_id` | `action.execute` |
| `resolution.dispatch` | `operation_id` | `operation.dispatch` |
| `resolution.reconcile` | `operation_id` | `operation.reconcile` |

The opaque grant narrows these permissions to its one case and resource. The
server still applies current parent role/resource permissions, active membership,
customer verification, immutable case pins, original approval validity, execution
stops, any existing support ownership/qualification and native source rechecks.
The context is informational and always reports `execution_authorized: false`.

Global `ROLE_ACTIONS` is unchanged. In particular an agent-parent grant cannot
dispatch or reconcile a financial operation. The client reports that current
authority is required; the server rejects an attempted bypass. A currently
authorized operator/integration performs financial dispatch under the existing
role boundary. The G04 complete-path tests use operator-parent grants.

The new surface continues existing return-submit previews and ordinary refund
previews/operations. It cannot create an approval or an allocation, execute a
store-credit or financed-exchange preview, add a new request key, or select a new
operation ID. Customer messages remain on the canonical support-delivery surface.

## Handover and uncertain outcomes

An authorized operator releases the case through the existing `WorkLeases`
service and issues the next owner's grant. Existing `SupportOwnership` takeover
or reassignment also revokes prior work grants where support ownership is in use.
No business row is recreated by either transition.

`unresolvedEffects` now includes actual unknown
`commerce_resolution_operations`, alongside the retained diagnostic operations.
An uncertain refund therefore appears in both legacy and return-worker contexts
and blocks another write. Dispatch persists uncertainty before its source call.
The two existing financial dispatch checkpoints may exempt only that exact
operation ID from its own uncertainty check; unrelated uncertain effects still
block execution and the lease/permission fences remain active.

The replacement runtime chooses reconciliation before any pending write. Lookup
uses the original operation ID and original source identity. An absent or timed
out lookup leaves the original operation unknown and ends the bounded run. It
does not authorize another send. Known accepted or manual-settlement-pending
records remain pending until the source proves a later stage. The clients never
infer settlement from return closure, an approval, a transport success or a local
refund record.

An old runtime that finishes an in-flight source call after handover cannot write
a late result or continue with its old scope. The source may have accepted the
original effect; the new owner reconciles that same effect. Replaying an already
completed preview with the exact original approval returns the existing canonical
receipt without creating another operation or consuming another approval.

## Running the clients

Each program reads one JSON object from standard input, accepts only a literal
`http://127.0.0.1:<port>` base URL, rejects redirects and uses a bounded request
deadline. Python ignores proxy environment configuration; Node uses its direct
local HTTP transport. Credentials are sent only in the bearer header, never in
CLI arguments or the returned trace. Input and response sizes are bounded.

The input keys are `base_url`, `grant_token`, optional `mode` (`inspect` or
`advance`) and optional `max_actions` (0–20, default 8). The work grant is the
output of the existing authorized grant issuance endpoint. Store it outside the
repository and pass it through stdin:

```sh
node --experimental-strip-types clients/return_runtime.mts < /absolute/private/runtime-input.json
python3 -I clients/return_runtime.py < /absolute/private/runtime-input.json
```

`inspect` claims the lease and reads portable state without executing an action.
`advance` runs only currently permitted, already approved continuation steps.
Both return an explicit stop reason, original identities, observed stages and a
sanitized trace. Approval requirements, pending source facts or insufficient
authority cause a bounded exit. Client output is not a source reconciliation
oracle or a permission grant.

## Behavioral evidence and recovery

Run the native contract cases with:

```sh
node --experimental-strip-types --test --test-concurrency=1 tests/development/runtime-switch.test.mts
```

`CASE-M07-G04-01` switches a customer return with an existing unused approval from
TypeScript to Python. `CASE-M07-G04-02` rejects late work and replays the exact
existing receipt. `CASE-M07-G04-03` switches after a synthetic source accepted a
refund but its response was lost, then reconciles that original operation before
any subsequent write. The retained `TEST-027` scenario has an additional reverse
Python-to-TypeScript case. These assertions compare canonical rows and a separate
source database against the declared fixture expectations in
`tests/fixtures/runtime-switch/expected.v1.json`.

Additional cases cover current role/approver revocation, expiry, envelope and
cross-case rejection, unsupported credit previews, preserved legacy scopes,
missing lookup, execution stops, late source responses, server/database reopen,
configuration migration and secret minimization. The HTTP harness exercises real
loopback calls and separate client processes around the canonical API. It is not
a claim of direct served-browser, production stack or connected provider proof.

Recovery retains the repository and the ordinary commerce/source databases through
the existing recovery controls. The test fixtures are disposable synthetic data;
they are not backups of real accounts. Reverting the new client/API surface does
not require a data migration. Never remove original financial rows or reset IDs
while recovering an uncertain effect. Exact committed-candidate native results,
targeted-fault evidence and independent reviews belong to the accompanying
verification handoff; this guide does not self-accept the goal.
