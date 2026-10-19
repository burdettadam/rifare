# Bounded image reader

The M17 reader is a server-installed, privately branded media transport for
synthetic wire execution. It accepts exactly one restricted PNG alongside an
unchanged logical `DecisionRequest`. It neither enables the original attachment
channel nor activates hosted image inference. The prior scope is
[ADR-0051](decisions/0051-m17-recovery-image-assistance.md); the executable
contract is [image-reader.v1](../packages/agent/contracts/image-reader.v1.json).

## Configuration and exact media

`imageReader` fixes an approved Cloudflare account and the approved
`@cf/cloudflare/clef-omni` model. It snapshots both allowlists and binds the
endpoint, selector, complete bounds, serving reference and evidence kind to a
configuration digest. Options, reader metadata and capability arrays cannot
widen a constructed reader. `isImageReader` checks membership in a private
WeakSet; copying its public properties does not create a branded reader.

`verifyImageReaderResult(reader, invocation, result)` additionally binds the
actual returned result to that reader instance and the exact invocation object.
The canonical service creates a new invocation object for every execution,
passes it directly through `SecretVault.invokeReader`, and verifies the raw
returned object before calling a JSON validator that creates a copy. A copied
result, a different invocation, or another reader with the same configuration
digest fails this identity check. Returned usable and unusable results are
deeply frozen. Guard exceptions still propagate without a returned result.

The private result index uses weak keys for both invocation and result; the
provenance index does not retain media requests through a retained result.
This is process-local execution provenance, not a serialized signature, media
approval or model-quality attestation. Non-object inputs cannot receive a
verifiable invocation identity. These checks add no asynchronous boundary.

The media envelope supplies `request`, `image`, the expected configuration
digest, a trusted current-authority `guard`, and an actual `AbortSignal`.
Top-level properties must be own data properties with exactly the declared
keys. The callbacks stay process-local; they are never serialized through the
logical JSON validator. This interface is for the canonical image service,
which owns case, evidence approval, purpose, budget and authority checks.

An image includes `mime`, canonical `base64`, `sha256`, `source_sha256` and the
transformation `restricted_png_identity_v1`. The two hashes must match each
other and the complete PNG bytes. The retained `validateEvidencePng` enforces
262144 bytes, four million pixels, eight-bit RGB/RGBA, full chunk checksums,
decompression bounds, and complete input consumption. Metadata is rejected.
This profile forwards the original validated bytes without a thumbnail,
metadata-stripping claim or arbitrary decoder. Extra images, remote URLs,
alternate MIME types, audio, video and unknown fields are refused.

## Complete context and wire

[Cloudflare's Clef-Omni documentation](https://developers.cloudflare.com/workers-ai/models/clef-omni/)
documents embedded images, a 64000-token upstream context, at most 1024 tokens
per image, and possible text-state truncation after media and questions consume
context. This reader uses a deliberately smaller profile. It retains the
existing 16384-byte logical request limit and counts every UTF-8 byte of the
complete mapped model/state/questions object as a conservative text token,
then adds 1024 image tokens and 512 marker tokens within 24576. The complete
serialized wire is also limited to 400000 bytes. Exceeding a bound fails before
transport; no state, correction, instruction, option or score level is removed.
This bound is a conservative project rule, not an observed tokenizer count.

The request contains only `model: clef-omni`, the complete text `state`, typed
`questions`, and one `images` data URI. Choice options and score levels map to
the documented `criteria` field. The credential appears only in the bearer
authorization header for the fixed endpoint. Case IDs, hashes, callbacks,
configuration digests and internal transformation fields are not wire fields.

## Response, cancellation and privacy

The total response deadline is configurable from 1 to 2000 milliseconds and
includes reading the response body. The reader races the complete operation
against both the deadline and caller cancellation, forwards cancellation to its
transport, bounds streamed response bytes to at most 131072, validates UTF-8
and JSON, and rejects redirects, a different reported response URL and non-200
responses. No retry or fallback exists. A fixture that ignores cancellation
cannot delay the returned failure; its late response is discarded and cancelled.
JavaScript cannot forcibly terminate arbitrary injected fixture code.

The trusted guard runs immediately before dispatch, after asynchronous response
and body work, and again before returning. A guard failure propagates its exact
exception so the canonical service can preserve its authority or erasure fence.
A caller abort produces `DECISION_AUTHORITY_CHANGED`, with no answers. Failed
transport cannot promote a late response into usable content.

Normalization reuses `validateDecisionResult` for exact question vocabulary,
finite probabilities, complete distributions, declared rounding, score
expectations and typed confidence. Reported input usage may not exceed 24576
and reported output usage may not exceed 131072; these are sanity limits, not
measured usage. Unknown model/usage stays null, only the two exact Clef-Omni
model names are allowed when reported, and serving revision remains null.
Provider errors and unexpected response content never enter failure messages.

The reader adds no persistent storage, cache or content logs. Owned byte copies
are cleared and local request/string references are dropped after execution.
This does not prove forensic deletion of JavaScript strings, caller-owned
copies, parser allocations, operating-system snapshots, a fixture's retained
arguments or data already obtained by an external provider. The existing vault
owns credential-buffer clearing. The canonical image service owns retention,
erasure, restore and derived-record behavior. Text DLP is not claimed to inspect
the encoded media.

## Availability and evidence

With `fixtureTransport`, the reader and every result are labeled
`synthetic_wire_fixture`. Without it, execution returns
`DECISION_CAPABILITY_UNAVAILABLE` and `live_test_unqualified`; it never invokes
global `fetch`. There is no live-enable flag. A later qualified activation needs
its own authorized change and actual media observations. A fixture callback is
trusted installed code, not a sandbox or a source of provider identity evidence.

The ten permanent native cases and independently declared fixtures cover wire
shape, clear and ambiguous normalization, strict media, complete context,
configuration/reader/result branding, malformed output, no retries, stream bounds, total
deadline and authority/cancellation races. The author performs static source
review only under ADR-0051; root records actual candidate execution and valid
targeted fault evidence. No current test pass, live model result, task accuracy,
audio/video capability, target-host isolation or milestone acceptance is claimed
by this transport document.
