# Maintainer review — M01-G11 through M01-G15

## Authority and disposition

ADR-0014 records the owner delegation before implementation. This is a maintainer
self-review under DELEGATED-LOCAL-05, not two independent reviewer sessions.
The assigned diagnostic code may be locally merged after the complete pinned
regression run. No product acceptance, remote publication or release is authorized.
M00 PostgreSQL/React, served-browser and live-model qualification remain open.

## Security and contract review

MCP uses the existing authenticated parent session, a separately generated short-lived
opaque grant, an exact audience, narrowed tool names and a single portable task.
Execution revalidates current permissions/profile/order; the published descriptor
cannot authorize a write. Neither the MCP token nor the REST bearer is passed to
commerce or model adapters. The local grant implementation is not a remote OAuth
server. Request body and transport controls retain the existing size/Origin/Host
checks. There is no SSE or remote deployment claim.

Review exposed a type-validation defect: invalid MCP arguments were delegated to
execution and returned as tool failures, rather than rejected against the declared
input schema. The added M01-G11-INVALID-TYPED-ARGUMENTS test first failed a behavioral
assertion (expected JSON-RPC -32602, absent). Input primitive types and bounds are
now validated before handler execution; the unchanged test passes.

The manual screen never imports the runner or awaits a model. Rendering uses
textContent; denial/unavailability clears previous facts. Tokens stay in page
memory and are not persisted through browser storage. The existing actual API
verification contract and new component tests are distinct. An actual served-page
trial failed under the host policy (ERR_BLOCKED_BY_ADMINISTRATOR); no policy was
bypassed and synthetic responses were not relabeled as served qualification.

The runner has bounded rounds/output, server-scoped configuration, fixed HTTPS
endpoints and no silent fallback/retry. The vault remains the only plaintext-key
boundary. The provider configuration is snapshotted at installation so later edits
to the caller's options object cannot enable a previously disabled transport.
Only typed fact IDs with a current source digest can finish an answer; required
facts cannot disappear. Free-form model prose, refusals and malformed/missing
capabilities produce handoff. Session/profile/source are checked again after awaits.
Provider call/response IDs exist only in memory; receipts contain portable records,
configuration/evidence labels and action digests. No raw prompt/response is stored.

The Python orchestrator retrieves content over public interfaces, verifies bundle
and per-resource hashes, refuses redirects/proxies and rechecks task state. A test
runs a copied server after physically deleting runner.mts, providers.mts and facts.mts.
The example remains deterministic, not a second cloud model or third-party runtime.

## Regression disposition

Preserve all prior executable test files, native IDs, capability definitions, oracle
expectations, package/lock inputs and source paths. Add registrations and inventory
membership only; the source-count fixture changes only its count and explanation.
New tests also cover wrong audience, unsupported tools, stale parent authority,
changed profiles, malformed model arguments, invented facts, source changes during
model execution, revoked keys, concurrent reads, limits, denial without fallback,
unsafe model-output HTML and independent-runtime isolation.

Targeted fault trials and final source-bound controller results are kept in the
separate evidence package. Test counts and source identities there describe actual
runs. A failing external qualification is retained as a failure, not a skipped test
inside an otherwise green product gate. No earlier specification is silently retired.

## Scope limits and rollback

Local process code can still tamper with same-user resources; no hostile-code OS
sandbox is claimed. The in-process run exclusion is not a distributed cost budget.
Grant state is intentionally ephemeral. Live-model consent, credentials, external
logs and model quality remain unobserved. Partial diagnostics do not accept the
M00 or M01 milestone. Retain the previous main and revert this batch to recover
source; operational database downgrades require a reviewed migration plan. The
archive contains no runtime database, wrapping key, proof outbox or active token.
