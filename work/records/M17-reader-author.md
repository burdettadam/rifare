# M17 image reader author handoff

State: ready_for_review; product execution and formal qualification pending.

Prior assignment: 71664531476bae98159223c3cfcc4a372bc0aff5, ADR-0051.
Author: /root/m17_image_reader_author, recovery/M17-reader, dedicated worktree.
This recovery branch starts from the independently recovered M14/roadmap
checkpoint. It contains none of the missing later M15/M16/M23 implementations
and does not replace their recorded source identities or evidence.

## Tests before implementation

Commit d0775c7f757d26998267c42f9ecb6840a64cd473 creates exactly ten stable
native cases in `tests/development/image-reader.test.mts`, eleven supporting
fixture files, and no runtime implementation. The wire and normalized examples
are independently declared fixtures. Original synthetic RGBA rasters include
a 261463-byte bounded input; independently constructed bad PNGs retain correct
hashes so parser checks cannot be bypassed by hash-only behavior.

The author ran zero product imports, tests, builds, installations, runtime
probes or provider calls. Test code has not been executed by this author.
Static reading, file authoring, fixture construction with standard-library
PNG chunks, native Git inspection and `git diff --check` are the performed
activities. A missing import at the tests-only commit is not behavioral proof.
Root must record actual coherent-candidate results and a meaningful targeted
fault on a separate ref, such as omitting the wire `images` field or removing
the post-response guard. Never integrate that deliberately broken candidate.

## Bounded implementation

`packages/agent/image-reader.mts` adds IMAGE_ADAPTER, IMAGE_MODEL,
`imageReader`, the ImageReader types and `isImageReader` private branding.
It does not modify any old file. Separate media capabilities retain the old
logical request and result validators without widening text capabilities.

The new contract pins one strict original PNG, matching source/sent SHA-256,
complete context and wire bounds, exact approved model/account, fixture-only
availability, bounded typed output and provider-usage sanity limits. Request
callbacks are validated as own data properties and never JSON-serialized.
The trusted authority guard runs before dispatch and after asynchronous work;
its exception propagates. Caller abort and a total response/body deadline
fence late completion. No retry, redirect, fallback, persistent cache or log
exists. No live-enable flag or global fetch fallback exists.

The author read the current official Clef-Omni model page on 2026-10-19:
https://developers.cloudflare.com/workers-ai/models/clef-omni/ . It documents
the image input and context/truncation behavior used for this narrower profile.
That reference is an interface specification, not observed Rifare inference.

## Integration and remaining boundaries

Root owns runtime execution, shared inventory/registry/source hash metadata,
the canonical image service, vault/budget ownership, integrated privacy and
the two independent candidate reviews. The author's new paths remain within
the exact assigned file list. Existing runtime, fixtures, migrations, pins,
accepted-goal ledger and canonical planning remain unchanged on this branch.

Synthetic wire results do not establish image accuracy, serving revision,
merchant approval, connected inference, provider deletion, host isolation,
audio/video handling or M17 acceptance. Credential-buffer clearing remains
with SecretVault. JavaScript strings and transport/caller-retained copies
cannot receive a forensic-erasure claim. Restore/import and image receipt
lifecycles remain duties of the coordinating canonical service.

Rollback before integration is to leave the recovery/M17-reader commits out
of the integration branch. Preserve this branch and fixture-first commit for
review and later reconciliation. No remote, release tag, publication or
artifact upload was performed by this author.

## Assigned compatibility follow-up

Root requested a read-only author compatibility check of the uncommitted image
service after cherry-picking the initial reader. This was not an independent
candidate review. The check identified a mismatch between accepted reported
usage and the service's reservation, and the separate vault-reader/catalog-reader
installation identity boundary. Root subsequently added its own per-invocation
usage check; that change is outside this author worktree and is not a recorded
execution result here.

Root separately assigned a result-branding follow-up confined to the original
new reader paths. Commit ce0679d62147ab40a75e988371820116408e220b adds assertions
to the existing M17-IMAGE-WIRE-01 case before implementation, preserving all
previous expected assertions and the total of ten native cases. The assertions
cover the real reader versus an equal-configuration reader, copied readers,
copied results, different invocation objects, deeply frozen nested answers,
and a branded credential-refusal result.

The implementation exports `verifyImageReaderResult` and uses private weak
keys for both the actual invocation and returned result. Only results produced
by this reader's execution receive its identity. The canonical service verifies
the original object returned unchanged through SecretVault before normalization.
No extra asynchronous boundary is introduced, guard failures still propagate,
and the index does not retain request/base64/guard objects through a result.
Callers must construct a fresh invocation object for each execution. The result
is deeply frozen, and serializing or copying it does not preserve its brand.

The author again ran no product execution. Root owns actual behavioral evidence,
the divergent-vault service test, independent reviews and milestone decisions.
