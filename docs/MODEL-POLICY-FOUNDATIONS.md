# Rifare model and policy foundations

This checkpoint implements M01-G16 through M01-G18 and the bounded M02-G01/M02-G02
foundations under ADR-0015. It is local diagnostic code, not a qualified release.
The M01 milestone assessment is in `work/qualification/M01.json`. Original goals,
benchmark thresholds, model/agent neutrality and protected tests remain unchanged.

## Local model adapter (M01-G16)

`packages/agent/local-model.mts` implements the existing provider-neutral ModelStep
contract using Ollama's nonstreaming chat/tool API. `ReadRunner` also accepts server-
installed LocalModel instances keyed by tenant, store and configuration ID. The
same skill, profile, task and source-fact verifier are used for all providers.
No secret handle or cloud key is needed for this local path.

Configuration requires a literal `http://127.0.0.1:PORT` endpoint, an explicit model
name, expected SHA-256 model digest, local-only server assertion, deadline and context
limit. Only `/api/tags` and `/api/chat` are contacted. The client rejects DNS names,
redirects, remote-model metadata, uninstalled or changed digests, partial/free-prose
answers, unbounded context and oversized output. Identity is checked before and
after each request. There is no model download, model substitution or cloud fallback.

A local listening address does not prove the model service itself is offline.
`cloud_disabled` is an operator assertion, not a remote attestation. On the actual
Ollama server set `OLLAMA_NO_CLOUD=1`, restart it, verify that setting and use host
network policy as required. Model registry responses cannot attest hostile servers.
Rifare does not change host services, install weights or configure firewalls.

After installing and starting an approved local model separately, run:

```sh
node --experimental-strip-types tools/probe-local-model.mts \
  --endpoint http://127.0.0.1:11434 --model YOUR_LOCAL_MODEL \
  --digest sha256:YOUR_64_HEX_MODEL_DIGEST --server-local-only true
```

The probe uses an in-memory synthetic store, records actual latency, selected facts,
tool outcomes, model/skill pins and reported usage. A missing service exits 2; an
unsupported response exits 1; an observed single-case success still does not qualify
the model. Cost remains unknown, not zero. LocalModel tests use a real loopback HTTP
server that returns explicitly synthetic model responses; no inference is simulated
as if it were observed. No model weights/service were available on this host.

Sources inspected 2026-10-16: [chat API](https://docs.ollama.com/api/chat),
[model listing](https://docs.ollama.com/api/tags), and
[server local-only controls](https://docs.ollama.com/faq).

## Untrusted inputs (M01-G17)

The runner's optional fourth argument has exact fields `message`, `knowledge_query`
and `attachments`. The existing HTTP assistance endpoint accepts an optional
`untrusted_input` field alongside `configuration_id`. The three-argument API remains
compatible. The public read-only OpenAPI contract is unchanged.

Messages and permitted knowledge are carried as a separately labeled user-data
object, never appended to trusted skill instructions. Knowledge is resolved through
the task's current source/access boundary and rechecked after asynchronous calls.
Only existing, installed tools are offered. Tool arguments, source digests and fact
IDs are server-validated even if the model ignores every instruction. Raw message
and reference contents are not added to retained assistance receipts.

All attachment inputs are rejected before model execution. These tests bind TEST-026
only to the early disabled-input boundary: they do not qualify image scanning,
malware detection, OCR, archives or a future upload pipeline.

## Source-checked evaluations (M01-G18)

`packages/agent/evaluation.mts` compares structured facts and source identity, not
prose similarity. A separately supplied suite hash fixes case membership and expected
outcomes before scoring. Every enrolled case requires exactly one observation.
Unknown cases, duplicate IDs, non-JSON values, missing outcomes and mixed configuration
IDs are rejected. Failed, cancelled and pending cases stay in the denominator.

Correct handoffs are distinct from factual answers. Correct facts with unauthorized
actions still fail. Missing cost or latency remains unknown. All costs are integer
micro-USD strings. Reports include hashes and sanitized outcome flags, not raw fact
values or prompts. Inputs may still be sensitive: keep real observations outside Git.
Configuration pins and evidence categories separate fixture and observed runs; labels
and hashes are not proof that an external party actually ran a model.

```sh
node --experimental-strip-types tools/evaluate-status.mts \
  SUITE_JSON EXPECTED_SUITE_SHA256 CONFIGURATION_JSON OBSERVATIONS_JSON
```

A valid report with failed cases exits 1; invalid inputs fail. The independently
hand-calculated five-case fixture is in `tests/fixtures/model-policy/`: two correct
cases out of five, one factual answer, one required handoff, one authority violation,
and unknown aggregate cost/follow-up latency. It intentionally does not pass quality.
No threshold in the release benchmark is modified by this evaluator.

## Roles and action/resource scopes (M02-G01)

`packages/commerce/authorization.mts` adds owner, operator, reviewer, integration and
agent roles, while retaining legacy worker/customer semantics. Additive migration
008 preserves existing members and sessions. Kernel and service actions check current
permissions; profile text and saved previews do not supply authority.

Only an owner may change member roles or narrow action/resource scopes. Changes use
expected revisions and atomic minimized audit entries. Role changes revoke existing
sessions; narrower scopes apply immediately even without a role change. The last
owner cannot be removed or restricted into losing administrative access. New owners
are provisioned by trusted server-local setup, never inferred from first HTTP access.
All credential provisioning remains server-local or under the existing privileged
surface. Legacy operators retain their earlier diagnostic permissions, but do not
receive role-management permission.

| Role | Typical scope |
| --- | --- |
| Owner | Existing operator actions plus member authority changes. |
| Operator | Current diagnostic read/configuration operations; no role administration. |
| Reviewer | Permitted reads and minimized audit history, not writes or model execution. |
| Integration | Scoped ingestion and worker/adapter reads, not merchant policy administration. |
| Agent | Scoped task reads and server-installed model execution; cannot change permissions. |

Permission decisions do not implement refunds, payments or policy publication.
Unsupported business actions remain unavailable, including to owners. Resource
restrictions intersect with existing tenant/store/customer and connector checks.
Node HTTP operations remain local. PostgreSQL concurrent enforcement is not qualified.

Authenticated HTTP additions: `GET /v1/permissions`, `POST /v1/permissions/change`,
and `GET /v1/permissions/events`. Change body: `actor_id`, `role`, `actions` (null or
restriction array), `resource_ids` (null or explicit order IDs), `expected_revision`.
Previews are informational; actual read operations repeat authorization checks.

## Currency-aware primitives (M02-G02)

`packages/commerce/money.mts` uses signed/unsigned decimal strings and BigInt minor
units, never binary floating-point money. Diagnostic currencies are USD/EUR/GBP/CAD
(two places), JPY (zero), and KWD/BHD (three). Unknown codes and excess precision fail.
The supported subset is explicit, not a complete ISO or payment-provider table.
Provider-specific exponent differences require future adapter qualification; see the
[primary currency reference](https://docs.adyen.com/development-resources/currency-codes/).

Arithmetic supports exact addition/subtraction; explicit half-even, half-up, floor,
ceiling and toward-zero rational rounding; signed rounding residues; and deterministic
largest-remainder allocations with identifier tie-breaking. Original and presentment
values remain separate with an external rate reference; no FX conversion is performed.
Cumulative-floor unit allocation preserves residual cents across partial returns.
Prior allocations must remain within the original amount and currency.

These are arithmetic primitives, not a ledger, atomic payment executor or refund
authorization. Callers must obtain trustworthy quantities and prior allocations from
future transactional operations. Passing an invented prior count cannot be detected
by a pure arithmetic function; no real money is moved by these methods.

## Commands and operational boundary

```sh
python3 tools/verify.py --runtime --harness
node --experimental-strip-types tools/demo-policy.mts
```

The demo provisions temporary in-memory roles, reads a synthetic order, revokes the
agent's action, demonstrates the next read fails, and shows exact cent allocations.
It does not change a persistent merchant or issue a payment. Existing `dev-commerce`
startup remains compatible and does not automatically enable a model endpoint.

The native test registrations retain old source and oracle expectations. Review the
actual candidate's counts and source identities in the separately packaged verification
report. Full M00/M01 qualification and independent production security review remain
outstanding. Local integration follows the delegated maintainer review exception,
not invented independent reviewer identities. Revert source only on diagnostic
clones; do not remove migration 008 from a populated database without a reviewed
forward recovery plan.
