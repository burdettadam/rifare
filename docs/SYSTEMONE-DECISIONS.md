# Optional SystemOne decisions

M14-G04 adds a second text-only transport for the existing logical decision task.
It is a server-installed `SecretVault` reader with immutable configuration,
default live denial and the same strict `DecisionRequest`/`DecisionResult`
contract used by M13. Root owns selection through `DecisionShadow`, current
credentials, provider budgets, minimized observations and later qualification.
This module grants no business-action or routing authority.

The assignment is [ADR-0043](decisions/0043-calibrated-routing-and-backend-replacement.md).
The implementation contract is
[`systemone-decision.v1.json`](../packages/agent/contracts/systemone-decision.v1.json).
Existing [decision semantics](DECISION-MODELS.md) remain unchanged.

## Verified protocol and selected subset

The official SGLang Clef guide specifies `POST /v1/systemone`. The body carries
an explicit model, shared state and named questions. Responses have a raw
`model`, `answers` and optional usage envelope. The route is different from the
Cloudflare account-scoped `success/result` envelope. Clef's SGLang implementation
refuses the general decision, chat and generation routes. The transport therefore
requires an approved complete `/v1/systemone` endpoint and does not infer one
from an OpenAI base URL.

[SGLang Clef guide](https://docs.sglang.io/cookbook/autoregressive/Cloudflare/clef)
and [System One HTTP reference](https://docs.system-one.dev/en/docs/api), read
2026-10-19, are the protocol sources. No API account, decision endpoint or model
process was exercised during authoring.

Rifare sends only text, even where a backend supports other modalities. It does
not send images, media URLs, tools, generation options or business-action fields.
Choice options become `criteria`; ordered score levels become `criteria`;
Noul retains its type and instructions. Logical task/resource IDs, configuration
digests and budget-only fields remain outside the provider body.

The selected model must be explicitly allowlisted and the reported model must
equal that selected value. SGLang can accept arbitrary request aliases while
returning its actual served name; configure the served model's explicit ID for
this narrower reader. The reader does not switch models because another response
name happens to appear in an allowlist. Unknown output fields and envelopes are
rejected instead of becoming authority or business data.

Native missing/null token counts become `usage:null`. A reported zero remains
zero. The hosted System One API also has accounting headers, but those are not
token usage and this reader does not reinterpret them as budget settlement.
The existing budget owner keeps the maximum reservation when usage is unknown.
Configured revisions remain metadata; the wire supplies no revision observation,
so normalized `serving.revision` stays null.

## Reader interface

The module exports `SYSTEMONE_ADAPTER`, `systemOneReader`, `SystemOneReader`,
`SystemOneReaderOptions`, and `assessSystemOneReadiness`. The reader has the same
structural interface as `WorkersAIReader` and adds deeply frozen metadata.

```ts
const reader = systemOneReader({
  serving_configuration_ref: 'approved-decision-server',
  endpoint: 'https://approved-server.example/v1/systemone',
  approved_endpoints: ['https://approved-server.example/v1/systemone'],
  model_id: 'Cloudflare/clef',
  approved_model_ids: ['Cloudflare/clef'],
  model_revision: null,
  serving_revision: null,
  effective_context_tokens: 16384,
  confidence_profile: 'sglang_systemone_adapter_v1'
});
```

This example configures a disabled reader; it performs no operation. Endpoint and
model allowlists come from trusted server configuration, never logical requests,
skill text or customer data. The endpoint must be canonical HTTPS with the exact
path and no query, fragment or credentials. The existing vault supplies its
server-held token as a Bearer header when an authorized invocation occurs.

Root installs the reader under `SYSTEMONE_ADAPTER` in the existing vault's reader
map and stores the credential with provider `systemone`. Invocation is exact:

```ts
await vault.invokeReader(scope, secretRef, SYSTEMONE_ADAPTER, {
  request,
  expected_configuration_digest: approvedReader.configuration_digest
});
```

The actual reader inside the vault checks that digest before transport. A valid
but different digest returns `DECISION_CONFIGURATION_CHANGED`; absent or malformed
input returns `DECISION_REQUEST_INVALID`. The logical serving reference must also
match. This preserves M13's approved-reader/actual-reader binding even when two
valid readers share an opaque name but have different destinations or limits.

The digest covers the captured endpoint and model allowlists, selected model,
configured revisions, context/confidence profile, bounds, artifact claims,
metadata, provenance and live permission. Later mutations to the caller's options,
arrays, callback reference or artifact object cannot change the reader.

| Metadata | Meaning |
| --- | --- |
| `adapter`, `provider`, `protocol` | Fixed adapter/provider and this local compatibility profile. |
| `model_id` | Explicit model selected by trusted configuration. |
| `model_revision`, `serving_revision` | Configured pins or unknown; not observations supplied by the response. |
| `effective_context_tokens` | Declared deployed cap, kept distinct from qualification. |
| `confidence_profile` | Selected backend statistic semantics, with separate qualification identity. |
| `input_modalities` | Text only. |
| `context_qualification` | Always `declared_unverified` in this transport. |
| `self_hosted_readiness` | Supplied artifact completeness, never observed qualification. |

## Context and confidence

SGLang's Clef encoder caps the complete prompt at 16,384 tokens, with potentially
lower limits from server context, token-pool capacity and prefill settings. It
truncates state to make room for the schema. Its confidence statistic follows the
System One adapter, while Cloudflare's reference `systemone()` uses top-option
probability. These differences are why endpoint compatibility does not imply
equal input capacity, probabilities or transferable thresholds.

[SGLang configuration notes](https://docs.sglang.io/cookbook/autoregressive/Cloudflare/clef)
and [reference answer conversion](https://huggingface.co/Cloudflare/clef/blob/main/joint_schema_model.py)
establish those distinctions. The
[SGLang API notes](https://docs.sglang.io/docs/supported-models/decision_models#system-one-compatible-api)
describe confidence as uncalibrated and distinguish joint-head decisions from
ordinary answer-label scoring.

This reader requires a declared effective cap between 1,024 and 16,384 tokens.
It defaults to at most 8,192 encoded bytes, further reduced to leave a 512-unit
margin below a smaller declared cap; trusted capability overrides can only narrow
the limits. Both the full logical request and encoded wire body are checked.
Oversized required text is rejected, and admitted text is sent unchanged. This
is a conservative byte bound, not a proof about the deployed tokenizer or server
truncation. Actual no-truncation qualification remains separate.

The two local confidence profiles are `sglang_systemone_adapter_v1` and
`clef_reference_top_probability_v1`. Their names are Rifare descriptors, not
claims that an endpoint has authenticated its implementation. The normalizer
preserves reported confidence within finite `[0,1]` bounds. It does not recompute
that value, treat it as calibrated correctness, or transfer a threshold from
another profile. Question/option membership, distribution sums, selected options
and weighted scores retain M13's existing validation and rounding tolerance.

## Self-hosted readiness evidence

Clef includes a trained joint schema head in addition to its backbone. The release
contains `joint_head.safetensors` and `joint_head_config.json`; the reference
loader constructs the head and loads its state strictly. Loading only the Qwen
backbone does not load the Clef decision implementation.

[Cloudflare model files](https://huggingface.co/Cloudflare/clef/blob/main/README.md)
and [reference loader](https://huggingface.co/Cloudflare/clef/blob/main/joint_schema_model.py)
are the primary sources for the required artifacts.

`assessSystemOneReadiness` accepts exactly:

```ts
{
  model_id,
  model_revision,
  serving_revision,
  effective_context_tokens,
  self_hosted_attestation // optional partial supplied evidence object
}
```

The attestation can name `model_repository`, matching `model_revision`, matching
`serving_revision`, matching `effective_context_tokens`, SHA256 pins for
`backbone_sha256`, `joint_head_sha256`, `joint_head_config_sha256`,
`tokenizer_sha256`, `serving_artifact_sha256`, `loader_observation_sha256`, and
both `backbone_loaded` and `joint_head_loaded` claims. Unknown fields are rejected.
Completeness requires a named Clef repository matching the selected model,
matching configured pins/context, all six hashes and both true load claims.

The deeply frozen result contains `status`, `qualified:false`,
`observed_runtime:false`, `evidence_basis:'supplied_configuration'`, a `missing`
list and `attestation_digest`. Missing or mismatched fields produce
`missing_evidence`. Complete supplied claims produce `attestation_supplied`.
That result never authenticates the claimed loader observation or changes
qualification, even when a caller supplies convincing hashes and true flags.

Actual self-hosted qualification needs separately authorized deployment evidence:
the selected backbone and trained head loaded from the pinned artifacts, the
effective tokenizer/context and no-truncation checks, exact serving build and
configuration, and current frozen-cohort observations. Independent qualification
and publication remain with the canonical owner. Two synthetic transports cannot
establish that a second model implementation was actually exercised.

## Failure, evidence and rollback

The reader permits one fetch with redirect mode `error`. A single deadline covers
fetch and bounded body reading, at most ten seconds; the response is at most
128 KiB. Timeout aborts the operation and cleanup never waits on a stalled
cancellation. A late aborted response cannot produce a usable result. There is
no retry, automatic fallback or endpoint discovery. Provider errors, redirect
destinations and secrets become fixed safe failure codes.

Providing `fixtureTransport` fixes provenance as `synthetic_wire_fixture`, even
if `allowLiveTest:true` is also supplied. Without a fixture, provenance is
`live_test_unqualified` and dispatch remains disabled by default. Construction,
responses, copied metadata and readiness claims cannot mint qualified provenance.
This assignment authorizes no live or paid operation.

Eight permanent cases cover logical transport replacement, readiness and missing
trained head, confidence differences, synthetic-only provenance, destination and
configuration binding, context bounds, native result validation, missing usage,
finite failures and real vault revocation before/during dispatch. The fixtures
precede implementation and contain independent expected mappings. Root owns
all native execution and its exact-candidate evidence; author executions are zero.

Disable a configuration through the canonical owner to stop new observations.
Keep prior receipts, unknown budget holds and historical metadata intact.
Replacement or rollback uses root's versioned publication/qualification controls;
removing a transport does not authorize replaying uncertain work or changing
manual case, skill, policy, rule or action contracts.
