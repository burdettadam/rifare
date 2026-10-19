# ADR-0052: M17 portable individual-image suppression

## Prior owner authority and scope

On 2026-10-19 the owner instructed "Continue developing towards milestone" after
receiving the saved M17 diagnostic checkpoint. Standing delegation authorizes
reversible local development decisions. The delegated maintainer assigns this
bounded continuation of M17-G03 before product changes. M18 remains unassigned:
its M15 remote-client authority implementation is absent from the recovered
source. This choice does not accept missing M13/M14/M17 qualification or recover
missing M15/M16/M23 history.

Base is the saved M17 checkpoint `26587c94925a1693060236824b74f128f8eac644`,
tree `6270c0f1e9d7f86c9f95b190f8435ce18e7263bf`. Root owns the isolated
`recovery/M17-suppression` branch. Preserve the previous M17 branch and recovered
main `a33c4ad57d13223c05ca985e5728404b671ab21a`.

Independent read-only feasibility reviews by /root/m17_suppression_scope and
/root/next_milestone_scope support this scope. Those reviews are not product
approval. Both agents remain nonauthors and perform no product execution;
they provide the final security and regression reviews respectively. At most
three corrective review rounds apply.

## Concrete gap and assigned outcome

Existing individual deletion and retention leave a minimized erased evidence
row, but the v1 subject/resource checkpoint cannot carry that image identity.
Restoring or importing an earlier image-bearing snapshot can therefore restore
its old source bytes even though image authority is revoked.

Implement a versioned suppression checkpoint that applies an independently
retained current image erasure before restored data is exposed. Preserve exact
source identity, unrelated content, existing holds and restored quarantine.
Persist imported tombstones whose source row is absent so subsequent exports
retain the same suppression. This qualifies only local logical replay behavior,
not destruction of older backup files or external/forensic erasure.

## Contract fixed before implementation

- Preserve the exact v1 subject/resource shape for media-free source state.
  Emit explicit version 2 with an additional `images` array when return evidence,
  image receipt residue or retained image suppression exists. Existing API input
  arguments remain unchanged; this is an explicitly versioned format extension.
- Each image entry contains exactly `tenant_id`, `store_id`, `evidence_id`,
  `case_id`, `resource_id`, `sha256`, and `source_created_at`. IDs must satisfy
  existing validation, SHA-256 is lowercase hexadecimal, and creation time is a
  nonnegative safe integer no later than checkpoint generation.
- `generated_at` is the actual checkpoint observation time. Do not invent an
  `erased_at` from evidence creation, expiry or checkpoint generation. Entries
  assert the source is already erased when the checkpoint is observed.
- Derive entries from canonical `state='erased'` evidence with null bytes,
  empty notes and null scanner. Refuse inconsistent erased rows. Never read
  image bytes into the suppression payload. Preserve current global checkpoint
  JSON limits, merchant limits and bounded record selection; no truncation.
- Retain imported entries in the existing `commerce_support_documents` kind
  `image_suppression`, version 1, ID equal to evidence ID. The exact body is
  `{version:1,image:<entry>}` with its canonical content digest. Author is the
  fixed local identifier `privacy_replay`; reviewer, review_digest and expiry
  are null. The row creation time records first local checkpoint application.
  Both recorded and revoked document states retain suppression; state changes
  do not grant or remove erasure authority. Validate all retained control fields.
- Merge incoming, existing stored and canonical erased identities monotonically.
  The same tenant/store/evidence ID with different case, resource, SHA or source
  creation time is a conflict. Reject duplicates in input and conflicts before
  exposure. Do not discard absent-source entries or trust snapshot-carried
  suppression bodies merely because the database/transfer digest matches.
- Require v2 whenever the restored/imported state has evidence (including erased
  evidence), image approval/observation/disagreement residue or image suppression
  documents. On repeat import also inspect the current destination. Reject a
  v1 downgrade. A genuinely media-free old snapshot may still accept v1.
- Global checkpoints retain exact tenant/store scope; merchant checkpoints and
  import entries must match the authorized owner's tenant/store. Suppression
  applies only the exact matching image and linked image receipt kinds, without
  erasing a whole case, order or subject as a shortcut.
- Within the existing transaction, validate and apply current subject and image
  suppression before image held-content invalidation. A deletion already
  authorized at the source supersedes an obsolete hold copied in an old backup.
  Unselected held image content still refuses restore/import atomically.
- All existing quarantine, revoked credentials/configuration, unknown-operation
  identity, restore replay and no-live-activation behavior remains required.
  A smaller later checkpoint cannot remove retained image suppression.
- Integrity hashes do not authenticate a checkpoint owner or prove recency by
  themselves. Independently trusted delivery, source quiescence and retention
  of the latest checkpoint remain caller/deployment obligations.

## Ownership and paths before writing

Root writes new `packages/commerce/image-suppression.mts`,
`packages/commerce/contracts/image-suppression.v1.json`,
`docs/IMAGE-SUPPRESSION.md`, this ADR and the M17 suppression work record.
Root may narrowly modify `privacy-lifecycle.mts` checkpoint generation,
`safe-recovery.mts` checkpoint validation and replay ordering, and
`merchant-portability.mts` scoped generation/validation, replay and repeat import.
No modification to ReturnEvidence, image execution/reader, image privacy,
decoders, old text contracts, grants or business operations is assigned.

The separate /root/m17_suppression_tests author owns only the new
`tests/development/image-suppression.test.mts` on `recovery/M17-suppression-tests`.
It may read existing fixture helpers and use independent expected outcomes;
no old test/helper edits, runtime edits, metadata edits or product execution.
Root integrates its tests-first native commits before runtime changes.

Root may update IMAGE-ASSISTANCE.md and PLANS.md to report actual new local
progress while retaining historical claims and formal blockers. Refresh exact
changed runtime/oracle hashes and add new paths/capability/test registrations in
the existing inventory, privacy storage contract, regression registry, catalog
oracle pins and licensing source-count metadata. Preserve all 3078 existing
test objects, 208 capabilities, 512 protected paths, 1791 source members,
301 runtime pins, 38 adapter objects, 599 catalog oracle pins, 262 tables and
all old migrations/goal/acceptance objects. No catalog count assertion change,
new adapter, dependency, HTTP route, database table or migration is assigned.

## Tests, review and checkpoint boundary

Root is the sole product executor. Write the 12 new native behavioral cases
before implementation, using existing public restore/import APIs so the old
source can demonstrate actual image resurrection rather than a missing import.
Record a meaningful red and the fixed candidate result. Preserve every actual
attempt, including setup failures if any, without counting them as proof.

The planned coherent selection is new suppression 12 + retained return evidence
20 + safe recovery 14 + merchant portability 14 = 60 native cases/four whole
files/one 60-second deadline. Keep the existing runner limits. New cases include
exact v1/v2 shape/minimization, individual and retention replay, unrelated
evidence/scope preservation, merchant repeat import, absent-source persistence,
invalid digest/types/duplicates/bounds, tuple conflicts/rollback, legacy downgrade,
obsolete and current holds, late observations and all image authority invalidation.
The existing image-assistance 20 and privacy-coverage 9 are explicitly deferred
from this selection; new cases cover their changed restore/hold interactions.
Repeat or add only affected whole files for a concrete failure or remaining risk.
No broad regression, browser/provider campaign or actual image evaluation.

Fix findings and obtain both independent reviews on one exact clean candidate.
Save a verified M17 recovery update and its real evidence. The stopping point is
portable individual-image suppression implemented and locally verified; formal
M17, connected retention/deletion, target-host isolation and image model quality
remain blocked. No release, push, paid/production effect, external message or
retry of the previously rejected complete M16 archive is authorized.
