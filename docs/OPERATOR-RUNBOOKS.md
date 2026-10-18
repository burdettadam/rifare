# Operator recovery and migration drills

This development slice provides executable local drills for seven incidents and
two migration scenarios. The drills use existing commerce methods, real SQLite
transactions and separate synthetic source ledgers. They create disposable data;
they do not connect a merchant account, send a real customer message or move live
money. A successful local run is preparation for the required independent
operator and connected qualification in M07-G08 and M07-G09.

## Run one incident

Use the installed Node version supported by `package.json`, from the repository
root. Each invocation accepts one fixed drill name. There is no shell-command,
endpoint, credential or arbitrary script option.

```sh
node --experimental-strip-types tools/operator-drill.mts --list
node --experimental-strip-types tools/operator-drill.mts --run ambiguous-refund
node --experimental-strip-types tools/operator-drill.mts --run lost-webhook
node --experimental-strip-types tools/operator-drill.mts --run expired-token
node --experimental-strip-types tools/operator-drill.mts --run stuck-hold
node --experimental-strip-types tools/operator-drill.mts --run provider-outage
node --experimental-strip-types tools/operator-drill.mts --run restore
node --experimental-strip-types tools/operator-drill.mts --run agent-incident
```

To retain the structured trace, add `--output` with a new file in an existing
private directory. Existing output files are never overwritten. The trace records
the exact method, required permission, observed state and fixture-administration
steps. The process exits unsuccessfully if a command is absent, a state differs
from the runbook, a denial is missing, or an independent source ledger has the
wrong effect count. Unknown names and arbitrary command strings are rejected.

`packages/commerce/operator-runbooks.mts` defines the executable command and state
contract. `tools/operator-drill-fixtures.mts` seeds the fault, supplies the fixed
method implementations and inspects the independent ledgers. The CLI is a local
fixture tool, not a production recovery endpoint. Running it on an existing
production database is not supported.

## Incident procedures and boundaries

| Drill | Exact current procedure | Required authority and evidence | Expected result |
| --- | --- | --- | --- |
| `ambiguous-refund` | Read the original operation through `POST /v1/resolutions/operation`; reconcile it through `POST /v1/resolutions/reconcile`; after a separate fixture gateway settlement, reconcile the same ID again. Both routes take `{ "operation_id": "original_id" }`. | `operation.read` and `operation.reconcile`; Woo refund record and gateway movement are separate ledgers. `WooRefundGatewayFixture.settle` is explicitly a fixture-control step. | `unknown → accepted → settled`; one gateway refund, one fixture gateway movement, zero messages. An accepted refund is not a settled payment. |
| `lost-webhook` | `BusinessOperations.read(scope, id)`, then `Reconciliation.one(scope, id, journal)`. | `operation.read` and `operation.reconcile`; look up the original operation in the independent source journal. | The source-confirmed operation becomes `succeeded` with one source record even though no webhook delivery arrived. The command is not repeated. |
| `expired-token` | Observe `CommerceKernel.authorize` rejecting the stale session; local administration issues a fresh session with `CommerceKernel.issueSession`; authenticate it and call `CredentialLifecycle.probe(scope, slot)`. | Active local membership and `secret.invoke`; the stored credential remains in the existing encrypted vault. The fixture expires the operator's local idle session. | The old bearer remains denied; one probe succeeds under the fresh session. Tokens and credential values are absent from the report. This drill does not qualify a provider OAuth refresh flow. |
| `stuck-hold` | `OrderEdits.release(scope, editId)` first returns `EDIT_FOREIGN_HOLD`. The independent fixture hold owner clears only its `fraud` hold. The operator calls `OrderEdits.release` again. | The original approved edit and `operation.dispatch`; current source acknowledgment and every remaining hold are rechecked. | Picking remains inhibited until the foreign owner clears its hold. Rifare releases only its owned holds, then the fixture reports `released`. A `fulfillment.releaseAll` proposal is rejected. No physical shipping is observed. |
| `provider-outage` | Inspect the original operation, call `Reconciliation.one` while the source lookup is unavailable, restore the fixture source, then reconcile the same operation. | `operation.read` and `operation.reconcile`; independent journal entry and original payload hash. | The operation stays `unknown` during the outage. It becomes `succeeded` after the source returns, with exactly one source record and no resend. |
| `restore` | `createRecoverySnapshot`, independently retained `suppressionCheckpoint`, then `restoreRecoverySnapshot` with exact manifest and suppression digests and a new destination. Bootstrap a fresh local owner session and inspect state. | Server-local recovery administration; current erasure checkpoint, exact current migrations, private files and a fresh destination. | Quarantine, copied sessions rejected, old operation ID in the replay-deny list, work claim blocked, model egress blocked and zero source records. This is a same-host restore drill. |
| `agent-incident` | Issue and claim the existing worker lease, then `SupportOwnership.takeover(scope, {case_id, expected_generation, reason:'exception'})`; try the previous `WorkerApi.returnContext`. | `work.claim`, `support.takeover`, current case generation and existing actor permissions. | Human ownership, same case history, old lease rejected and stale generation rejected; zero message effects. |

When an outcome is ambiguous, retain the original operation ID, request key,
receipt ID, source identity and amount. Read the source before deciding what
happened. Do not allocate a replacement refund or message to obtain a different
idempotency key. A provider outage, missing webhook, expired session, renamed
command or elapsed timeout does not establish that the earlier effect was absent.

The runbook validator rejects blind retry, hold/permission bypass and shell
commands. It also rejects changed method names, changed permissions, reordered
steps and stale expected states. Runtime execution checks actual method output;
matching a document alone cannot make the drill pass. These checks do not grant
permissions: the existing commerce methods still enforce them.

## Shared migration authority

`packages/commerce/migration-cutover.mts` and `migration-fence.mts` implement one
shared SQLite coordinator for two local installations of the same merchant. One
owner covers refunds, fulfillment and customer notifications together. The
coordinator is separate from both commerce databases and retains its own immutable
identity, installation registrations, ownership epoch, execution records,
transition history and receipt digests.

The local-control document has kind `migration_binding`, ID `installation` and
version 1. Its exact body and digest bind the installation ID, merchant, absolute
commerce/coordinator paths and actual file identities. Three persistent SQLite
triggers make the binding immutable and prevent a second binding. These triggers
also detect a missing binding on a later reopen. Missing/corrupt bindings,
replaced files, an unavailable coordinator and conflicting installations fail
closed. Product document APIs do not accept arbitrary kinds; merchant exports
exclude this installation-local control.

All existing guarded ordinary writes in a bound database require
`withMigrationWriter(kernel, scope, callback)`. The wrapper holds the shared
coordinator's `BEGIN IMMEDIATE` lock for the entire callback, including awaited
native source calls. Another writer or cutover cannot acquire it concurrently.
The guard is enforced through the existing `data-guards.mts` authorization and
egress entrypoints; direct calls to ordinary methods such as `kernel.attach` or
`kernel.ingest` are denied without the live context. This context adds a fence;
existing actor permissions, approvals, recovery quarantine, source checks and
execution stops remain required.

The fence requires exactly one merchant in each database. Binding checks this
before creating either an immutable control row or an installation registration;
an existing multi-store database is rejected and its unrelated merchants remain
writable. Every later binding validation rechecks occupancy. A database cannot
bind again for another store. Use separate installations for independent
migration ownership. Existing
authentication bookkeeping and trusted local provisioning are not external
workflow effects. Direct database administration and a legacy binary that does
not enforce this guard are outside the shared-authority contract; do not qualify
an old external system until its actual effect paths enforce the same authority.

An execution-start record commits before the callback begins. A process failure
leaves that record unfinished, so new writers and ownership changes refuse it.
There is no timeout-based ownership takeover and no automatic abandoned-work
retry. Read-only inspection stays available. `withMigrationReconciliation` holds
the same coordinator lock while allowing only existing read and
`operation.reconcile` actions; it cannot authorize attachment writes, dispatch,
approvals or new effects. Existing restore egress restrictions still apply.

### Local API sequence

These are server-local TypeScript APIs, not invented HTTP routes. An owner with
current `recovery.manage` permission must supply both installation scopes to the
administrative methods.

```ts
const coordinator = MigrationCutover.create(coordinatorPath, {
  coordinator_id: 'merchant_migration', tenant_id: tenant, store_id: store,
});
coordinator.bind(oldKernel, oldOwnerScope, 'old', {initial_owner: true});
coordinator.bind(nextKernel, nextOwnerScope, 'next');

await withMigrationWriter(oldKernel, oldOperatorScope, () =>
  existingService.dispatch(oldOperatorScope, originalOperationId));

const review = coordinator.compare(
  oldKernel, oldOwnerScope, nextKernel, nextOwnerScope);
const switched = coordinator.cutover(
  oldKernel, oldOwnerScope, nextKernel, nextOwnerScope,
  {expected_epoch: 1, expected_history_digest: review.digest});
```

Comparison reads canonical source IDs/versions, case/configuration histories,
operation commands, financial amounts/states, receipt digests, source-native
references, support observations, inventory reservations, order-edit stages and
fulfillment/instant-operation histories. It reports differences and unresolved
work. It does not perform a provider request or treat local history agreement as
independent proof of live settlement. The cutover repeats the comparison under
the held coordinator lock, verifies the supplied history digest and current
epoch, rejects unresolved effects/unfinished executions, and changes one owner.
Queued, unknown, accepted-but-unsettled financial work, active reservations and
unresolved holds/stages block it. Receipt IDs and digests are retained.

For a real merchant transfer, export and import with the APIs in
[MERCHANT-PORTABILITY.md](MERCHANT-PORTABILITY.md) before binding the destination.
Import into a fresh, locally bootstrapped target and verify the separately
supplied snapshot digest. Obtain the current merchant-scoped erasure checkpoint
with `exportMerchantSuppression(sourceKernel, sourceOwnerScope)`, and pass
`{suppression, suppression_sha256: merchantSnapshotDigest(suppression)}` as the
fifth argument of `importMerchant`. The current checkpoint can reject an older
snapshot that would resurrect an erased subject. Imported auth is disabled and the target starts in
quarantine. A coordinator cutover does not activate it, re-enable credentials,
unrevoke approvals, dispatch old refunds or resume copied queues. The focused
integration case exercises exactly this export/import/cutover sequence and
observes the quarantine and egress denials.

### Rollback is a pause

```ts
const paused = coordinator.rollback(
  currentKernel, currentOwnerScope, previousKernel, previousOwnerScope,
  {expected_epoch: currentEpoch});
```

Rollback removes the writer, advances the epoch and records the unresolved work
and compared history. It does not reset states, rebuild commands, restore old
approval uses, reverse money, or transfer pending work to the previous system.
Both installations stay paused. This slice intentionally supplies no automatic
resume or live activation after rollback. Preserve the coordinator and both
original databases for separate reconciliation and review. Do not overwrite the
coordinator with a backup, remove its binding, copy its installation identity or
resume a pre-cutover worker to circumvent the pause.

## Rehearse the migration boundaries

```sh
node --experimental-strip-types tools/operator-drill.mts --run migration-overlap
node --experimental-strip-types tools/operator-drill.mts --run migration-pending
```

The reusable legacy fixture builders seed three merchants. The new diagnostic
fixture driver first constructs a single-merchant test input in its disposable
database: it removes only the other synthetic merchants while temporarily
removing deletion-blocking triggers, restores the exact trigger SQL, and checks
foreign keys and the complete trigger inventory before binding. This fixture
construction is not a supported migration command and never alters imported
quarantine or any source-controlled original fixture/helper.

The financial mirror drills then use explicitly labeled disposable SQLite
snapshots of that diagnostic application **before binding**. They do not claim
to activate a merchant import. They retain separate Woo refund, gateway and
support source databases and compare original receipt/operation identities in
the two application databases.

`migration-overlap` permits the designated old installation to dispatch a refund
and message within the shared fence. The other installation's ordinary refund
dispatch is denied. The observed source counts are one gateway refund, one
fixture gateway movement and one accepted message command. The fixture does not
claim customer delivery. Rollback leaves both installations paused; histories
that differ after those effects are reported as differing.

`migration-pending` seeds a lost refund response, reconciles the refund only to
the accepted stage, and loses the response to its pending-status message. The
two databases retain the original IDs and receipts. Cutover is denied because
the refund is unsettled and the message outcome remains unknown. Rollback pauses
both installations, and attempts to dispatch through either are denied. The
independent ledgers remain at one refund, zero gateway movements and one accepted
message command.

## Focused development verification

```sh
python3 tools/dev_tests.py --files tests/development/migration-operations.test.mts
```

This is one 18-case file. It covers all six goal CASE IDs and PORT-022, rejection
of multi-store binding without affecting other merchants, coordinator
loss/restart, durable binding tampering, an in-flight cutover race, stale epochs,
reconciliation-only authority, real merchant quarantine, CLI execution, all seven
incidents and unsafe/stale instructions. The final reviewed development run
passed all 18 cases in 4.6 seconds, with no skipped/cancelled cases. It also
exercised a persisted unfinished execution across reopen and rejection of a
copied bound database. The initial
17-case run exposed the fixture's seven resources and the exact current
`EDIT_FOREIGN_HOLD` code; the retained failed report records those two new-drill
expectation errors.

Full regression, browser suites, catalog/controller runs, connected accounts,
physical shipping, an independent host and a non-author operator observation were
not run for this development slice. Formal goal/milestone acceptance remains a
separate decision under ADR-0033. Reports identify the local fixture qualification
and explicitly set `independent_operator_observed: false`.
