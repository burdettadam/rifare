# M19-G03 integration design for the next bounded assignment

This source-derived preparation informed the separately committed
[ADR-0060 assignment](decisions/0060-loyalty-redemption.md), following reviewed
G02 closure c8e8240. ADR-0060 is the controlling concrete API, path and independent
oracle contract. This design itself is not implementation or qualification
evidence; current progress belongs in the milestone work record.

## Intended result

A named points action passes through the existing separate-actor ActionGateway
approval. Its durable reservation and original operation identity protect the
same provider account/customer entitlement across cases, processes, restarts and
restores. A provider timeout keeps the original points encumbered. Only exact
authoritative original-ID evidence changes that uncertainty. No alternate money
charge, new retry identity or enrollment/send permission is inferred.

## Native integration points

Use a dedicated loyalty execution owner and strict typed records, while retaining
the existing commerce_operations identity, work, target and receipt tables.
Typed records in commerce_support_documents can hold erasable quote and operation
payloads without a new migration. A dedicated parser must validate row/body IDs,
tenant/store/account/customer scope, version, state, digest and operation binding;
generic saveDocument alone is insufficient. The immutable generic operation
command should contain only the minimum original identity, point quantity,
source/command digest and permitted reconciliation linkage. Full snapshots,
customer tokens and raw personal messages do not belong in that immutable row.

ActionGateway's proposal parser, quote dispatcher and commit/receipt dispatcher
need one explicit diagnostic.loyalty.redeem branch. Keep all old actions and
result shapes. The new preview/receipt needs typed points terms and a named
synthetic nonmonetary benefit. It must not encode points in USD, store credit or a
refund amount. Exclude it from the generic case-effects and diagnostic-record
fallback branches. Retain single-use approval, distinct proposer/approver,
current approver permission revision, execution permissions and control stamps.

An approval validator cannot simply call G01's quote method: the independent
reviewer is not the current support owner. Revalidate the pinned original owner
and generation, original current customer proof, resource/configuration and
provider terms under the reviewer's own approval authority. Do not impersonate
the proposer or transfer support ownership to approve the quote. Recheck source,
rule, benefit and expiry immediately before dispatch. Start with the existing
human approval path; autonomous points execution is not qualified by the current
money-shaped support automation envelope.

ExecutionStops needs the explicit action and existing global/store/restore
fences. The old readiness contract only recognizes diagnostic resolution; do not
mislabel it as loyalty qualification. Declare separate synthetic source readiness
in the new owner. A restored original operation cannot be dispatched again.

## Provider journal and balance accounting

G01 snapshots have no accounted-operation list. A newer balance cannot be assumed
to include or exclude local reservations/redemptions. The new synthetic source
needs an explicit immutable anchor and journal protocol tying each debit to its
original operation, command digest and before/after snapshot revisions/digests.
Current availability must account for local reservations without counting a
provider-recorded debit twice. An unexplained externally published snapshot must
remain unreconciled instead of resetting holds or silently changing the anchor.

Use the existing separate LoyaltyFixtureSource for observations and a dedicated
native redemption fixture owner for effect journals. Keep G01's absent effect
methods and strict snapshot contract intact. Original source identities,
capabilities, point units and exact request fields must be validated at every
boundary. The source transaction serializes original-ID idempotency and balance
debit. A lost response after commit is demonstrably different from no source
effect. Full and limited capability declarations are fixture semantics only.

The source may return a fixed synthetic reward reference; no monetary benefit is
invented. An insufficient-balance or unsupported result is a native rejection,
not permission to issue a charge or substitute store credit. Original-ID lookup
must return strict evidence; a missing lookup result never proves cancellation.

Core reservations are serialized by account/customer entitlement, across all
cases and kernel handles. Creation of the reservation, original command identity
and operation/receipt shares approval consumption's transaction. Persist unknown
before provider invocation. Quote expiry may release a demonstrably unsent live
reservation, but cannot release an unknown effect. Restoring an earlier queued
snapshot is also uncertain: that operation may have been sent after the snapshot.
Restore must conservatively retain its encumbrance until original-ID evidence
resolves it, rather than trusting the old queued state as current proof of no send.

## Preserve refund independence in both native fences

operation-store.blockingOperation currently places all nonsupport actions in the
same resource stream. Add a narrowly recognized loyalty stream without changing
other actions. Account-level point concurrency still belongs to the loyalty
owner; a resource stream alone is insufficient.

work-leases.unresolvedEffects independently includes every generic sending or
unknown operation. assertCaseWorkerScope and worker-api check it before managed
financial writes. A generic loyalty operation would therefore block a worker
refund even if the first stream filter were fixed. Classify only strictly
validated typed loyalty operations separately in this financial uncertainty
fence. Preserve the old financial/diagnostic blocker set. A human-only refund
demo would not prove this worker-path requirement.

## Existing exception and recovery paths

ExceptionQueue can list the generic operation, but its resolver currently uses
SyntheticJournal and Reconciliation. Those owners prove synthetic_recorded for
diagnostic record actions; they do not prove points redemption. Add a native
loyalty resolver branch with exact typed evidence, preserving the old dispatcher.
Do not create a separate inbox or let an arbitrary resolver-shaped object grant
points settlement authority.

Separate new-effect validation from minimized reconciliation. G01 context calls
assertRecoveryEgress; using it for original-ID lookup would make restored unknown
effects unreconcilable. Reconciliation after erasure also needs deliberately
bounded retained-record authority: ordinary k.authorize with an erased resource
is denied. Define the required store/operation authority and permitted minimized
lookup explicitly, without restoring customer content or new dispatch authority.

## Privacy must ship with the first durable operation

Add dedicated has/export/erase/uninstall/restore helpers for the typed loyalty
records. Subject selection must work from retained subject identity even when
the customer owns no current resource. PrivacyLifecycle.eraseSelected must call
minimization before its resource-list branch, so hash-only suppression works.
Honor holds, revoke quotes/approval/dispatch, remove personal copies and retain
only the declared minimum unknown quantity and original reconciliation linkage.
Revoked authority does not mean the economic effect is absent.

Physical restore must validate original records, apply current suppression,
revoke authority and preserve uncertainty before exposing the destination.
Merchant import needs the same checks on original and destination rows, including
repeated import. The generic support-document state='revoked' transform must
never release points. Late provider observations can update minimized original-ID
outcome evidence but cannot recreate erased customer payloads. Provider-side
retention/deletion coverage remains separate from Rifare-controlled storage.

If no table changes, retain the existing schema digest and storage inventory
chain. Update runtime pins and the existing privacy surface declarations for the
new lifecycle. Synthetic fixture journals need independent operator cleanup.

## Independent verification to freeze

The primary native demonstration should race two reservations against one
entitlement, lose a successful provider acknowledgment, expire the reservation,
reopen the kernel and prove that the second operation still cannot consume the
unknown quantity. Lookup the first operation by its original identity and verify
one provider debit/reward. Exercise separate kernels sharing the core database.

Other essential cases cover exact approval/benefit/rule binding, revoked approval
and permissions, ownership generation, stale balances, provider rejection,
foreign source/kernel/physical alias, no fresh key retry, actual worker refund
independence, typed exception reconciliation, minimized erasure, historical-only
subjects, uninstall/hold behavior, physical restore and initial/repeated merchant
import. Preserve existing targeted suites within an agreed native development
budget. The fault must expire an unknown hold or permit a new identity, and the
frozen independent tests must catch it behaviorally.

Two nonauthor reviewers must assess the exact candidate, especially the shared
gateway/work/exception/privacy hooks. Formal M19 still needs accepted entry
dependencies, merchant-owned provider qualification and current full/connected
evidence. This design does not waive those gates.
