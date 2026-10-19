# Optional decision model contracts

M13 adds a bounded classification interface beside the existing generative
`ModelStep` contract. A decision answers a fixed set of published questions. Its
output contains finite probabilities and labeled provider confidence, with no
tools, refund authority, permission changes or action gateway. The owning shadow
service remains responsible for current case/evidence authority and minimized
observations. The manual return workflow requires no model.

This is a local fixture implementation under
[ADR-0042](decisions/0042-decision-model-shadow-milestone.md). No connected inference,
quality, latency, billing or immutable hosted revision was observed by the author.
Formal goals and cumulative qualification are separate from source implementation.

## Canonical interfaces

`packages/agent/decisions.mts` exports `DecisionRequest`, `DecisionQuestion`,
`DecisionAnswer`, the discriminated `DecisionResult`, `DecisionModelAdapter`,
`DecisionCapabilities`, `validateDecisionRequest`, `validateDecisionResult`,
`validateDecisionCapabilities` and `unusableDecision`. The machine-readable
contract is [decision-model.v1.json](../packages/agent/contracts/decision-model.v1.json).

The request has exactly these fields:

| Field | Meaning |
| --- | --- |
| `task_id` | Logical task, such as return intake; independent of a provider thread. |
| `question_set_id` / `question_set_digest` | Stable question resource identity resolved by the orchestrator. |
| `serving_configuration_ref` | Opaque reference to trusted server configuration. |
| `state` | Complete, nonempty authorized text; no provider account, token or business permission field. |
| `questions` | Finite map of published IDs to `noul`, `choice` or `score` questions. |

`noul` carries instructions and returns `probability_true`. `choice` has named
`options`; its answer carries one selected option and the entire probability map.
`score` has ordered `levels`; its answer carries a probability-weighted zero-based
score and the probability of every level. Instructions/descriptions are nonempty
strings of at most 4,096 characters, subject to the smaller total byte bound.

Usable results have all requested answers and a null reason. Unusable results
have null answers and a fixed safe failure code. Both contain `usage`, `serving`
and `evidence_kind`. Usage is either two nonnegative safe integer token counts or
null. Serving identity/revision can be explicitly unknown. Provider confidence is
`{provider, metric:'provider_reported', value}`; it is neither permission nor a
claim of calibrated accuracy.

Validation rejects extra questions, missing answers, unknown options, wrong
types, nonfinite values, out-of-range values, mismatched score levels, inconsistent
distributions and unexpected fields. Unknown tool, refund and permission fields
therefore produce an unusable result. The normalizer preserves valid probability
values without repairing an invalid distribution.

The published model implementation rounds to four decimals. With half-unit
`h = 0.00005` and floating-point allowance `e = 1e-9`, the supported profile uses
sum tolerance `n*h+e`, argmax tolerance `2*h+e`, and weighted-score tolerance
`(1 + sum(level indices))*h+e`. The score tolerance includes the rounded score and
each rounded probability's contribution. A selected option must still belong to
the exact request vocabulary. These are arithmetic consistency bounds, not
confidence or routing thresholds. See the
[official response implementation](https://huggingface.co/Cloudflare/clef-flash/blob/main/joint_schema_model.py).

## Text and context limits

The default project profile advertises `choice`, `noul` and `score`, with text as
its only modality. It permits at most 64 questions, 255 options for a choice and
10 levels for a score. Identifier syntax is deliberately narrower than arbitrary
text; unsafe object keys are rejected through the existing JSON-value validator.
Trusted capability overrides can only reduce these limits.

The complete encoded logical request and the provider body are each bounded to
16,384 UTF-8 bytes by default. No text is sliced. Exceeding the bound produces
`DECISION_CONTEXT_LIMIT` before transport. Root's evidence assembler must retain
claims, verified facts, missing evidence and any required correction explicitly;
reject attachments, signed media inputs and material excluded from model access.
Passing a string URL never causes this adapter to fetch it.

Cloudflare currently publishes a 24,576-token context for
`@cf/cloudflare/clef-flash`, reduced from 64K on 2026-10-09. It also documents
automatic truncation of long text to the remaining model context. The project
byte limit and protocol allowance are conservative safety limits; they do not
qualify an exact hosted token count or guarantee a future provider implementation.
The byte bound must be reconsidered with independently authorized connected
qualification if the serving contract changes.
[Model documentation](https://developers.cloudflare.com/workers-ai/models/clef-flash/) ·
[October 9 change](https://developers.cloudflare.com/changelog/post/2026-10-09-clef-omni-workers-ai/)

## Optional Workers AI reader

`packages/agent/workers-ai.mts` exports `WORKERS_AI_ADAPTER`, `WORKERS_AI_MODEL`
and `workersAIReader(options)`. It implements the existing `CredentialReader`
interface from `SecretVault`; there is no second secret store or model registry.
The existing generative providers, `ReadRunner` and local model behavior are
unchanged. Root owns the decision service's authorization, budget and receipt
integration beside those existing paths.

The trusted constructor requires `serving_configuration_ref`, `account_id`,
`approved_account_ids`, `model_id` and `approved_model_ids`. Optional values are
`fixtureTransport`, `allowLiveTest`, narrowed `capabilities`, `timeout_ms` and
`max_response_bytes`. The only implemented model is `@cf/cloudflare/clef-flash`.
The selected account must be a member of the snapshotted account allowlist, and
the model must be a member of its allowlist. Unknown constructor fields fail.

The resulting reader exposes immutable `serving_configuration_ref`,
`configuration_digest`, `capabilities` and `evidence_kind`. The digest covers
destination, allowlists, adapter and contract identity, native selector, all
bounds, live permission and provenance. Root can bind owner-approved configuration
to this digest even when a server configuration reuses an opaque ID. Mutating the
constructor's objects later cannot change the reader.

An installed vault invokes it with exactly
`{request: decisionRequest, expected_configuration_digest: approvedDigest}`:

```ts
const result = await vault.invokeReader(
  scope,
  opaqueTokenReference,
  WORKERS_AI_ADAPTER,
  { request, expected_configuration_digest: approvedServingConfigurationDigest }
) as DecisionResult;
```

The expected digest comes from the owner-approved server catalog entry. The
reader actually installed in the vault compares it with its own frozen digest
before dispatch. This detects a valid but different vault reader even when it
shares the approved reader's opaque reference and fixture provenance. A missing
or malformed digest is an invalid request; a well-shaped mismatch produces
`DECISION_CONFIGURATION_CHANGED` with no outbound call. The digest is outside
the logical request and is never included in the provider body.

The owning shadow service performs current authorization and budget reservation
before this boundary and revalidates evidence, scope, configuration and stop state
after it. `SecretVault.invokeReader` independently checks current credential access
and revocation before and after the asynchronous reader call, then zeroes its
decrypted credential buffers. This low-level invocation alone is not a shadow
receipt or an authorization to bypass the owning service.

The fixed wire is a POST to
`https://api.cloudflare.com/client/v4/accounts/{account}/ai/run/@cf/cloudflare/clef-flash`.
The token appears only in the Bearer authorization header. The JSON body contains
`model:'clef-flash'`, the complete `state`, and `questions`. Choice options and
score levels map to native `criteria`. Task metadata and opaque configuration
references remain outside that provider body.
[Official maintained REST adapter](https://github.com/cloudflare/langchain-cloudflare/blob/main/libs/langchain-cloudflare/langchain_cloudflare/decision_models.py)

The REST envelope must be successful and contain exact typed answers. Optional
`errors` and `messages` must be empty when present. Choice confidence and every
probability are retained; a score's native `legend` must exactly match the
submitted level descriptions. Missing/null usage is explicitly unknown; supplied
malformed usage fails. A reported model is accepted only as the configured full
model name or native selector. An absent/null model remains unknown. There is no
verified native revision field, so `revision` stays null. The model's released
implementation echoes the requested selector; that value is not proof of an
immutable hosted deployment.
[Published hosted schema](https://github.com/cloudflare/cloudflare-docs/blob/production/src/content/workers-ai-models/clef-flash.json)

Live calls are disabled by default. Supplying `fixtureTransport` fixes provenance
to `synthetic_wire_fixture`, even if `allowLiveTest:true` is also supplied. Caller
request fields and provider responses cannot relabel it. A constructor without a
fixture has `live_test_unqualified` transport provenance; an explicit unusable
disabled result still means no request was sent. Root records execution status
and checks returned provenance against the installed reader. No live request is
part of this assignment.

The default deadline is 10 seconds, including response consumption; lower trusted
values are allowed. The maximum response is 128 KiB. Redirects, unsuccessful
status/envelopes, invalid JSON/UTF-8/schema, oversized output and timeouts become
fixed unusable outcomes. Cancellation cannot extend the deadline. No raw error
body, exception message, header, input text or credential is returned. There is
one dispatch, with no retry, circuit transition or fallback destination.
The native REST profile omits `options.rejectIfBusy`, whose validator
incompatibility is documented in Cloudflare's SDK
[changelog](https://github.com/cloudflare/langchain-cloudflare/blob/main/CHANGELOG.md).

## Budget and evidence ownership

Use `ModelBudgets.reserve` before dispatch. Its existing request contract requires
`max_output_tokens >= 1`, so the owning service can reserve an internal envelope
with `max_output_tokens:1`; this field is never sent to Workers AI. Settle reported
usage when valid. Unknown usage must settle as null, retaining the maximum
reservation rather than treating a timeout as a free call.

Cloudflare currently bills Clef-flash input tokens only, at $0.038 per million.
The budget service accepts integer microUSD per token, so it cannot represent
that fractional microUSD rate exactly. Fixture/conservative rates remain
explicitly unqualified; no rate, latency, quality or actual spend is claimed by
the fixtures. No budget implementation or financial state owner is added here.

## Tests and handoff

The thirteen cases in `tests/development/decision-model.test.mts` include every
G01/G03 goal case plus arithmetic, text/modality, request-limit, redirect/error,
in-flight revocation and immutable-configuration/usage boundaries. Independent
fixture provenance and primary source revisions are in
[the fixture README](../tests/fixtures/decision-model/README.md).

Tests-first commits are `4a78ee9` and `41db34c`. The latter adds root's immutable
configuration digest requirement before implementation. Corrective tests-first
commit `e714a81` adds the independently identified catalog/vault reader mismatch,
using valid readers with the same reference but different account or bounds.
The thirteen-case count and all earlier assertions are retained. The author executed no
product imports, tests or demos. Root owns the source-bound focused invocation,
any corrective evidence and independent review. A suitable affected file is:

```sh
python3 tools/dev_tests.py --files tests/development/decision-model.test.mts
```

Root's coherent selection also covers its shadow service and the retained
affected privacy/provider contracts. Local fixtures establish neither actual
provider inference nor formal milestone acceptance.
