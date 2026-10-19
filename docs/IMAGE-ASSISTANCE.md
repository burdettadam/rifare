# Image assistance — M17 recovery development

This is a local diagnostic implementation on `recovery/M17-images`, based on
recovered commit `a33c4ad57d13223c05ca985e5728404b671ab21a`. It is not a replacement
for the unavailable later M15/M16/M23 implementation. Recovered `main` stays at
that original checkpoint. Canonical milestone acceptance remains unchanged.

## Workflow and scope

The service adds explicitly approved image observations beside manual returns.
The current operator configures the purpose `return_evidence_usability`. An
ordinary verified customer uploads a restricted PNG, it passes the existing
quarantine/scanner path, and the customer approves that exact evidence ID and
SHA-256 for one configuration, case and task. Approval expires within 60 seconds.
An authorized operator who currently owns the support case can then prepare and
run the diagnostic observation. Legacy remote-worker grants do not gain access.

The new versioned bundle is under
`packages/commerce/skill-bundles/return-intake-images/return-intake-shadow/`.
Its inner directory retains the required base identity `return-intake-shadow`;
its version is `2.0.0`. The original text question resource is byte-identical,
and the original `1.0.0` bundle is untouched. The new optional resource asks
whether the relevant item is visible, whether clarity is usable, and whether
the requested detail is visible. Answers are `yes`, `no`, or `cannot_assess`.

All observations require review. They cannot establish authenticity, identity,
fraud, eligibility, warranty entitlement, physical receipt, refund approval or
inventory authority. Reviewers can record one of four bounded disagreement
reasons. The service does not mutate return, refund, resource, inventory or
ownership business state. The existing manual workflow remains available.

There are no new HTTP routes or general agent attachments. The old evidence
responses still say `model_access:false`: a signed manual download is not model
consent. Only the separate service can combine canonical bytes with an exact
current approval and the image-specific reader envelope. Gift-recipient image
consent/inference, audio and video remain unavailable.

## Processing and current authority

The path accepts one PNG per request, at most 262144 bytes and four million
pixels, using the existing RGB/RGBA 8-bit validator. It rejects ancillary
metadata, malformed chunks, oversized decompression and trailing content.
`restricted_png_identity_v1` is a bounded copy of the original validated bytes;
the derivative and source hashes are identical. It neither silently strips
metadata nor uses an arbitrary image decoder, thumbnail or remote URL.

The unchanged text snapshot supplies complete authorized messages, customer
corrections, current source facts, profile, policy and skill pins. An oversized
request becomes unavailable; no prefix is submitted. The separate image reader
reuses the logical decision validators without widening their text-only contract.
It permits a 16384-byte logical request, a 24576-token conservative context
budget (UTF-8 bytes plus 1024 image allowance and 512 marker allowance), and a
400000-byte complete image wire body.

Private preparations bind tenant/store, current operator and session, support
ownership generation, execution-stop stamp, case/task/profile/skill, complete
text evidence, exact image/hash/scan/expiry, customer approval/session, and
merchant/provider configuration. The service checks these before byte access,
before transport and after asynchronous work before persistence. Cancellation,
erasure, revoked sessions, credentials or configuration, and late corrections
prevent a late result from becoming a canonical observation.

The image reader has separate private identity and result branding. The exact
returned result must belong to the configured reader and the same invocation
object passed through the vault. A divergent vault installation or copied result
cannot acquire the configured reader's provenance.

## Transport and accounting

Cloudflare Clef-Omni has a fixed account/model allowlist and one endpoint. This
implementation accepts only an explicitly installed synthetic fixture transport;
there is no global fetch fallback or live-enable flag. It rejects redirects,
limits the complete response to 131072 bytes, uses a total deadline of at most
2000 ms, and supports cancellation. No retries or alternate providers run.
See [IMAGE-READER.md](IMAGE-READER.md) for the transport contract and primary API
documentation used to design the wire shape.

Credentials remain in the existing `SecretVault`. `ModelBudgets` reserves the
complete logical request plus the conservative image/marker allowance without
storing base64 in accounting metadata. The service accepts at most its actual
reserved input bound and one reported output token. Over-bound usage becomes an
unusable result and leaves the full reservation unknown/held. Unknown attempts
keep their original observation identity, including after receipt erasure, so a
replay cannot dispatch a second call. Prices and live billing remain unqualified.

## Privacy and retained copies

No tables or migrations are added. Merchant configuration uses versioned support
documents. Approvals, observations and disagreement records use existing
task-bound assistance receipts. Receipts retain hashes, fixed observations and
provenance; they do not retain image bytes, image notes, raw customer messages,
credentials or raw provider errors. Approval session hashes are internal only.

Individual evidence erasure and retention purge remove every linked unheld new
receipt kind. Subject/gift erasure removes new case-bound copies, and export
uses a fixed projection that excludes sessions and purchaser gift data. The
receipt timestamp must be a nonnegative safe integer matching the canonical
row's `created_at`; a recomputed body digest cannot authorize an arbitrary
imported object or a different timestamp in that projection. The
gift test seeds historical/imported records into a real gift case to exercise
privacy cleanup; it does not execute a gift image model workflow.

Holds preserve retained content. Held consent withdrawal marks the approval
revoked in place; unheld withdrawal deletes its linked image records. Uninstall
revokes every image configuration version and the existing sessions/secrets,
preserving held content for local retention administration. Restore/import
rejects held image copies; unheld restored image approvals/results are deleted
and configuration is revoked, even when no subject suppression is requested.
Subject erasure is also replayed through the existing suppression checkpoint.

At the first saved M17 checkpoint, individual-image erasure had no portable
image suppression ledger. The subsequent ADR-0052 continuation implements
[portable image suppression](IMAGE-SUPPRESSION.md): v2 checkpoints and retained
minimized controls prevent individually erased source images from reappearing
on native restore and merchant import. Subject and selected image suppression
now precede held-image invalidation; unrelated held image records still refuse
the restore/import atomically. Formal backup-erasure qualification remains
pending. Canonical SQL erasure is not external-provider deletion. Owned byte
buffers are cleared promptly, but JavaScript strings, caller downloads, OS
snapshots, database free pages and remote copies need separate handling.
Text DLP does not establish inspection of encoded images.

## Qualification and milestone boundary

The evaluation preparation fixes purpose, question/options, preprocessing,
cohort roles/strata, denominators, review handling and proposed metrics/thresholds.
The semantic protocol digest is
`07dcdda89316fa8825fdf31b311e05159a95bac326f62b608e5be6f62d47fe8f`.
Actual authorized image membership and independent reference labels still need
to be frozen before a qualifying run. No actual image inference or accuracy
measurement is represented by the synthetic wire fixtures. The assessment API
always reports quality as pending, including when a caller forges qualification
flags or tries to reuse image evidence for audio/video.

M17-G01–G04 are bounded diagnostic implementation targets on this branch.
M17-G05 is qualification preparation; M17-G99 remains blocked. Formal M13/M14
acceptance, actual image inference, intake/privacy/provider retention evidence,
target-host processing and missing-history reconciliation are still required.
This checkout does not contain or inherit the missing M16 managed isolation.

The final focused selection passed all 20 service cases, 10 reader cases,
20 retained evidence cases and nine retained privacy cases in 35.664 seconds,
using the unchanged 60/4/60 development budget. Both independent reviewers
approved candidate `0fa3b7ebe7c41b880077d4a40619a84dbfd4ed6a` for local diagnostic
recovery. The [M17 recovery checkpoint record](../work/records/M17-recovery-checkpoint.md)
retains every actual attempt, the corrected privacy finding and the scoped
decisions. The expanded adapter catalog retains its broad 262-case campaign,
which is deferred from this development selection.

The later [individual-image suppression checkpoint](../work/records/M17-suppression-checkpoint.md)
adds 12 independently authored cases and passes its assigned 60-case selection
in 21.240 seconds on candidate `949e0c14787febee9ced799b526daaa3ee57eed7`.
Both independent reviewers approved that bounded local continuation. It retains
the preceding service/reader qualification contract and all original tests;
it does not establish image-model quality or full milestone acceptance.

## Recovery and rollback

Do not fast-forward recovered main over the missing later checkpoint. Preserve
this branch and its native commits for later reconciliation with the actual
M15/M16/M23 history. Reconcile shared privacy/restore edits explicitly and rerun
their applicable checks on that integrated candidate. There is no schema rollback
because no migration is added. For a diagnostic deployment, disable the image
configuration first, preserve holds, revoke sessions/credentials, and use the
existing privacy owner for unheld stored image records. Never erase held records
as a shortcut to rollback.
