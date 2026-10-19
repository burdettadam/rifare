# Portable individual-image suppression

This bounded M17-G03 continuation closes a local recovery gap: individual image
deletion used to clear the current evidence row while an older native backup or
merchant snapshot could still restore its bytes. ADR-0052 assigns an explicit
version 2 suppression checkpoint and durable minimized deletion identities in
the existing storage. Formal M17 acceptance and external erasure qualification
remain blocked. The final observed result belongs in the
[checkpoint record](../work/records/M17-suppression-checkpoint.md).

## Checkpoint format and meaning

Media-free state keeps the exact existing version 1 subject/resource shape.
Version 2 adds an `images` array whenever the state contains any return evidence,
image approval/observation/disagreement residue, or retained image suppression.
The merchant variant also retains its existing tenant and store fields and
includes only that owner's authorized scope. Existing public restore/import
argument shapes are unchanged.

Each image entry contains exactly tenant, store, evidence ID, case ID, resource
ID, SHA-256 and `source_created_at`. Creation is the canonical evidence row's
creation time. Checkpoint `generated_at` is the actual observation time, at which
the listed deletion is asserted to have already occurred. Neither value is
represented as a historical deletion time; the evidence schema has no such
column. There are no image bytes, notes, scanner text, customer IDs or session
credentials in the entry.

A canonical erased row is usable only when its bytes are null, note is empty
and scanner is null. Inconsistent erased rows are refused. IDs use the existing
validator; source hashes require 64 lowercase hexadecimal characters; times are
nonnegative safe integers. Creation cannot be later than the checkpoint. Each
input list and the complete merged image union are bounded at 10,000 entries,
without truncation. Existing canonical global checkpoint hashing has a 131,072
byte limit; merchant JSON has its existing 64 MiB limit. A global checkpoint can
therefore reach its byte limit before its row limit.

## Retention when the old backup has no source row

Suppression is retained under `commerce_support_documents` with kind
`image_suppression`, version 1, and ID equal to the evidence ID. Its exact body
is `{version:1,image:<entry>}` with the existing canonical content digest. The
author is the fixed identifier `privacy_replay`; reviewer, review digest and
expiry are null. Row creation records the first local checkpoint application
and is preserved on repeat replay.

Both `recorded` and `revoked` document states remain effective deletion records.
The generic merchant-import configuration revocation cannot reactivate an
image by changing that state. Full control metadata, body shape, scope,
identity, digest and time are validated before use. Snapshot membership or a
matching transfer digest alone cannot make a malformed control trustworthy.

An absent source row does not discard the deletion. A subsequent checkpoint or
merchant export carries the retained entry. The merge includes incoming
deletions, current retained controls and canonical erased rows. Merchant repeat
import also validates deletion records in the exact original package. Its
clean, quarantined and rejected evidence contributes only media detection and
source-identity checks. Replaying that package does not recreate its content.

The key is tenant/store/evidence ID. Different case, resource, hash or source
creation under the same key is a conflict. Duplicate entries in an incoming
checkpoint are refused even if their values match. A later smaller checkpoint
cannot remove deletion knowledge already retained by the destination.

## Atomic restore and import

All source tuples and retained controls are validated before subject replay.
Current subject suppression and exact individual-image suppression then run
inside the existing restore/import transaction, before image held-content
invalidation. Individual replay clears only the matching canonical image and
its three image receipt kinds. It does not erase an entire case, order or
customer as a shortcut.

An independently supplied deletion already authorized at the source supersedes
an obsolete hold copied in an older snapshot. Unselected held image receipt
content still causes the existing atomic refusal. Failed validation or a hold
refusal publishes no restored directory and commits no partial merchant import.

Version 1 is refused when the restored/imported state is image-bearing,
including erased evidence or image receipts whose original evidence is absent.
Repeat import checks both the original package and the current destination.
A genuinely media-free old snapshot can continue to use version 1. This is a
format compatibility rule; it cannot establish that a supplied checkpoint is
the latest checkpoint retained by the source operator.

Existing quarantine, revoked image configuration and authentication material,
unknown in-flight operation identity, replay prevention and no-live-activation
behavior remain in force. No ReturnEvidence API, reader, execution grant, HTTP
route, table, migration, dependency or business action is added by this change.

## Trust and verification boundary

A checkpoint's digest detects changed content against an independently obtained
expected digest. It does not authenticate the owner or establish recency on its
own. The source operator must quiesce relevant changes, retain the latest
checkpoint independently of old snapshots, and deliver it through a trusted
channel. Timestamp checks reject obvious stale/future inputs within the
existing recovery contract; caller honesty is not inferred from a self-chosen
timestamp or digest.

Logical suppression on restore does not destroy old backup files, database free
pages, caller downloads, operating-system snapshots or provider copies. The
local synthetic tests do not qualify connected storage erasure, actual image
inference, target-host isolation, or missing M15/M16/M23 implementation history.
Recovered main and the earlier M17 checkpoint remain preserved for explicit
future reconciliation.
