# M07-G06 through M07-G10 — focused development integration

## Authority and preserved baseline

The owner requested the next five goals after asking for fewer development
regression tests. ADR-0033 assigned these goals from
`45599f6ae4e23a342facae0a53798dec5986d725`; ADR-0032 supplies the focused default.
Root owns local integration and shared metadata. Compatibility, migration/runbook,
and installation authors used separate native Git worktrees. No remote exists;
this is a local development checkpoint with a cumulative source and Git bundle.

The original 2,544 registrations and 124 capability objects remain unchanged.
This batch adds 54 native cases, one helper regression, and five proposed
capabilities. All original native assertions, migration bytes, fixture semantics,
capability expectations, package inputs and acceptance prerequisites survive.
The conformance catalog refresh changes only the reviewed data-guard and consent
source hashes made stale by the assigned migration fence corrections. Source inventory/count changes account
for the additive files; they do not change licensing or qualification decisions.

## Implemented work

| Goal | Bounded outcome | Native cases |
| --- | --- | --- |
| M07-G06 | Exact evidence/configuration/source compatibility matrix; unsupported tiers remain explicit | 11 |
| M07-G07 | Merchant export, current suppression checkpoint, atomic quarantined import, explicit credential mapping | 14 |
| M07-G08 | Shared transaction ownership fence, single-merchant binding, source/receipt/current-authority comparison, cutover and paused rollback | 10 |
| M07-G09 | Seven executable recovery runbooks through actual methods, permissions and separate synthetic ledgers | 9 |
| M07-G10 | Pinned offline installation, 31 actual migrations, deterministic served workflow, staged upgrade/interruption/rollback | 10 |

The first G06–G10 author files passed in bounded invocations: compatibility 11,
merchant transfer 14, migration/runbooks 18, installation/upgrade 10. A separate
seven-case helper file passed after fixing a filename-wrapper false pass in the
development runner. Unregistered exploratory files now must also produce actual
case identities. The wrapper-only report is retained as invalid evidence.

The integrated selection is these four native files, 54 cases under the unchanged
60-case/four-file/60-second limit. The accompanying checkpoint records the actual
exit statuses, native XML, case identities, exact source/configuration pins,
timings and current source commit. A selected pass is neither full regression nor
formal goal acceptance. Historical full-gate evidence stays with the prior
first-five handoff and is not relabeled as current.

## Focused review and corrected findings

The nonauthor regression reviewer independently found and checked closure of:

1. **Late erasure resurrection.** A pre-erasure export originally exposed the old
   customer when imported later. Import now requires a separately pinned current
   owner-scoped suppression checkpoint, validates scope/timing/identity, and uses
   the existing erasure implementation before committing or exposing reads.
2. **Valid merchant prose rejected.** Bracket-leading attachment text was treated
   as JSON even when parsing failed. Export preserves ordinary strings and only
   traverses a nested JSON string after successful parsing.
3. **Unrelated merchant outage.** Migration binding originally allowed a database
   containing other merchants while applying a database-wide fence. Binding now
   rejects that condition before mutation and rechecks occupancy on every bound
   action and reopen. New disposable fixtures preserve original trigger SQL and
   foreign keys; no old helper or imported quarantine was altered.

The separate authority reviewer also demonstrated **a completed native return
missing from cutover history** on `c20bf0f`: the old installation created one
return, comparison accepted the pre-create mirror, and the new writer created a
second native return for the same approved request. The correction retains the
native request/operation identity, source and body digests, lifecycle and current
effect authority in comparison. Source review covered consent, erasure/holds,
execution stops, approvals, readiness, policy/profile activation and worker
authority as the same comparison boundary. Writable diagnostic mirrors require
exact authority; verified imported quarantine permits only its documented
disabling/revocation transformations and provides no activation. An explicit
migration write guard also covers verified-customer consent updates under the
prior corrective assignment `6568316`; existing role and consent permissions are
unchanged. One permanent case extends the migration file to 19 cases. The
authority review retains its unchanged single-case reproduction and corrected
result; the root's combined run supplies the current integrated observation.

These are retained behavioral assertions, not weakened expectations. Final
regression and authority/security reviews are separate nonauthor sessions; their
exact reviewed pins and conclusions accompany the integrated report. The source
record cannot fabricate reviewer identities or accept its own evidence.

## Integration and remaining limits

The delegated owner permits local nonrelease integration after the bounded checks
and focused reviews. Formal M05-G99, M06-G99 and M07 acceptance, connected accounts,
target-stack qualification, intended-use model assessment, independent-machine
installation and released-artifact qualification remain open. All five new
capabilities are `proposed_not_accepted`.

Imported work remains paused even if migration ownership changes. Old operations
are not replayable, and credential mappings do not create vault aliases or enable
egress. Rollback removes both migration writers rather than resetting history.
Operator drills use disposable synthetic sources; their observed settlement and
notification states do not describe live payments or customer delivery.

No automatic full regression, browser suite, nested catalog/controller run,
multi-level restoration audit, release tag, publication, paid model or live
external operation is part of this batch. Retain the source and all native Git
history when resuming. The next development assignment starts after M07-G10 only
when requested; blocked formal prerequisites do not become accepted by progress.
