# ADR-0063: Assign the local drop-off credential lifecycle

## Prior authority, ownership and boundary

The owner again requested progress toward the next milestones with minimum useful
test execution. From reviewed G01 closure
599b29f461d1b09f8d7ca48b4c121c9a9a11a1ee, the delegated maintainer assigns bounded
local M20-G02. Canonical accepted dependencies and connected/physical qualification
remain open. This is synthetic local preparation, not canonical goal acceptance.
Keep protected main, the acceptance ledger, original planning requirements, old
tests/oracles, permissions, worker grants and the 262-table core schema unchanged.
No external provider, message, paid effect, production, deployment or publication
is assigned. QR issuance cannot establish acceptance, custody, stock or settlement.

Root is the sole runtime writer/executor in Rifare-M20-credentials on
goal/M20-dropoff-credentials. The independent author owns only the three new
dropoff-credentials test artifacts in a separate test worktree. Freeze those
artifacts before runtime implementation. Independent authority/privacy and
regression reviewers are read-only nonauthors and do not run products or tests.

Assigned additions are packages/adapters/dropoff-credential-fixture-source.mts;
packages/commerce/dropoff-credential-{values,records,privacy}.mts;
packages/commerce/dropoff-credentials.mts and
packages/commerce/contracts/dropoff-credentials.v1.json. Narrow native hooks are
assigned in dropoff-choices.mts, qualified-return-destinations.mts,
action-gateway.mts, durable-work.mts, reconciliation.mts, execution-stops.mts,
operation-store.mts, work-leases.mts, exception-queue.mts,
operation-receipts.mts, privacy-lifecycle.mts, safe-recovery.mts and
merchant-portability.mts, all under packages/commerce. SupportService and HTTP
routes are outside this increment. SecretVault and CredentialLifecycle remain
unchanged: deployment authentication slots are not customer handoff credentials.
Root also owns this ADR, docs/DROPOFF-CREDENTIALS.md, PLANS.md, the M20 work record
and necessary additive inventories/catalog declarations and exact source pins.

## Public owner and native approval

Export DropoffCredentials(k,{choices,source}). Require the actual same-kernel
DropoffChoices and DropoffCredentialFixtureSource attached to its exact directory
source. Freeze public handles and recheck native brands, identities and physical
separation on each effect/read. Use existing commerce_support_documents for strict
typed quotes and operations, native ActionGateway previews/approvals/receipts,
queueOperation, immutable operation commands/targets/receipts and execution controls.
Do not add another core table, scheduler, consolidation ledger or worker grant.

ActionGateway accepts optional dropoff:DropoffCredentials. Export
DROPOFF_ISSUE_ACTION='diagnostic.dropoff.issue' and
DROPOFF_REVOKE_ACTION='diagnostic.dropoff.revoke'. Both gateway arguments are
exactly {quote_id,quote_digest}; prepare/approve/execute retain native inputs.
Credential commits return before the generic money/effect fallback. The gateway
receipt names dropoff_operation_id, state='authorized', the action and
financial_effect=false. No credential payload is in a preview or receipt.

Owner methods and exact public inputs:

- quote(scope,{request_id,choice_id,expected_source_digest,replaces_operation_id})
  where replaces_operation_id is null for first issuance, otherwise the exact
  previously issued operation. Return {id,digest,quote,approval_required:true,
  execution_authorized:false}; quote includes action, request_id, items, method,
  source_digest, generation, replaces_operation_id and credential_expires_at.
- quoteRevoke(scope,{issue_operation_id}) returns the same quote envelope with
  action revoke and the exact issued operation as issue_operation_id.
- dispatch(scope,operation_id) returns the secretless operation view.
- read(scope,operation_id) returns the secretless operation view.
- reconcile(scope,operation_id) returns {disposition,operation,command_repeated:false}.
- cancel(scope,{operation_id}) closes only a live provably unsent authorized
  operation, with original-ID lookup absence and zero attempt/history proof.
- deliver(scope,issue_operation_id) returns {operation_id,credential_id,kind,
  payload,expires_at,generation,qualification:'synthetic_only',financial_effect:false}.

Quotes pin original native return/request/resource/items and quantities, exact
eligible method and separate unsummed fees, source/account/parent identities,
G01 source digest, original human owner and ownership generation, original
customer verification identity, configuration/resource versions, execution
control stamp, creation/dispatch expiry, credential expiry and predecessor.
No caller-supplied customer, category, item subset, provider override or expiry is
accepted. Baseline gift requests fail closed; no new gift outcome is assigned.

Synthetic constants are DROPOFF_QUOTE_TTL=5000 milliseconds and
DROPOFF_CREDENTIAL_TTL=20000 milliseconds. The dispatch window is bounded by G01
and original proof freshness; credential expiry is quote creation plus 20000.
The intervals intentionally differ. Successful delivery after the consumed
approval/quote expires is permitted while current authority and provider validity
remain valid. Delivery never refreshes either interval.

## Canonical reviewer seam and final authority

Existing G01 quote remains current-owner-only. Add
DropoffChoices.review(scope,{quote_id}) resolving a strict stored G02 quote, not
caller-supplied owner or request overrides. The actual distinct human reviewer
requires current resource action.approve and support.read. Separately validate
the original proposer member, current permission, ownership and generation.
Compute the original owner's canonical G01 projection through the shared private
projection implementation. Reviewer identity is not substituted into immutable
terms. No fabricated Scope or customer reauthentication is permitted.

Add QualifiedReturnDestinations.reviewItems(scope,{request_id}) with actual
action.approve permission and the identical native item/source binding logic.
Ordinary evaluate/evaluateItems retain their current semantics. This is a read
seam, not authority to own, prepare, execute or dispatch the case.

Prepare, execute and final dispatch require the pinned original human owner;
approve requires a different current human. Recheck current tenant/store/resource,
case lifecycle, original proof without renewal, ownership generation, unchanged
items/method/fees, capability/configuration, execution controls and actual approver
membership/authority revision/revocation at final send. Revoke uses the pinned
original issuance and current human/proof/resource authority but need not require
a now-unavailable method to become eligible again. Protected delivery requires
current original human/proof/resource authority, recovery/privacy permission and
current source usability, not continued validity of consumed approval expiry.

## Separate immutable outcome and current usability

Typed operation states are authorized, unknown, issued, revoked, rejected and
cancelled. Native operation/work states map respectively to queued/pending,
unknown/unknown, succeeded/done, succeeded/done, failed/dead and failed/dead.
Issue outcome issued remains immutable after credential expiry, revocation or
replacement. Current credential states active/expired/revoked are separate source
observations, with replaced_by metadata. No local timeout resolves uncertainty.

Persist original operation identity and unknown/attempt_count=1 in a committed
core transaction BEFORE source effect. A second core transaction revalidates
authority, calls the synchronous fixture, validates its exact response and
completes the operation. Source commits survive a later core rollback. Never
automatically resend; repeated dispatch of unknown performs no effect. Reconcile
is lookup-only on the same immutable operation ID/command digest. Null/unavailable
lookup, elapsed expiry, missing encryption key or changed directory retains
unknown and cannot authorize a new identity.

Use an opaque scope/request family fence independent of method/source choices.
At quote, commit and dispatch, block a second issue or revoke while a same-family
operation is authorized/unknown. A known active credential blocks new issuance.
Replacement requires known original issuance plus fresh authoritative expired or
revoked status, exact predecessor, new independent approval and next generation.
The provider independently enforces one active credential per family and atomic
predecessor/generation updates. Rejected/cancelled unsent attempts confer no
credential. An unknown revoke does not mark the credential revoked or permit
replacement/delivery. Authoritative rejection leaves the original active.

cancel cannot act on unknown, restored, minimized or previously attempted work;
it uses a distinct additive credential_cancelled receipt code. Typed records
cross-check native command/target/work/control/approval/receipt lineage and a
bounded complete history. Missing/malformed/orphan typed records fail closed.
Optional note/correction receipt mutations are denied for this new domain, so
bounded classification cannot be exhausted by irrelevant receipt history.

## Synthetic provider and encrypted payload

Export DropoffCredentialFixtureSource(directory:DropoffFixtureSource,keys:Keyring).
Use directory.db (the separate partner database), existing stable parent handles
and the directory source clock. Reject core/foreign/aliased parents before DDL.
Contract is rifare-dropoff-credential-fixture-v1; identity binds this contract,
scope and directory identity. Public readonly fields are directory, db, tenant,
store, identity, contract and account (native partner account ID).

Public fixture administration/observation methods:

- mode(kind:'issue'|'revoke',mode:'apply'|'reject'|'timeout_before_effect'|'timeout_after_effect')
- lookupAvailable(boolean)
- issue(command), revoke(command): synchronous effects with immutable secretless
  result; timeout modes throw only bounded nonsecret error codes.
- lookup(operation_id): immutable original result or null; unavailable throws.
- credential(issue_operation_id): separately hashed current metadata/status.
- deliver(issue_operation_id): same original plaintext only while active.
- verify(payload): read-only {usable,state,operation_id,credential_id,generation,
  financial_effect:false,physical_handoff:false}; no item/custody acceptance.
- journal(): strict secretless {operation_id,command_digest,command,result} array.
- forgetSubject(subject_ref): retire encrypted delivery material only; preserve
  original operations and lineage. It is not provider revocation.

Provider persistence contains identity, bounded immutable command/result journal
and current credential metadata plus AES-256-GCM ciphertext. Source commands
retain scope, operation ID, source/account identity, opaque family/subject refs,
quote ID/digest, item and term digests, site/destination/method, credential kind,
generation/predecessor, dispatch/credential expiry and financial_effect=false.
They do not copy customer/contact/item payloads. Exact item/method/fee terms remain
in the approved core quote and can be retired under privacy lifecycle.

Cryptographically random bounded payloads are encrypted with the injected Keyring;
keys are not stored in provider/core files or exports. AAD binds immutable command
digest, operation, scope/source, credential ID, kind and expiry. Missing keys or
authentication failure blocks delivery without changing original outcome or
replacement authority. Journal/lookup/status/export/receipts/errors have no
plaintext. Retained payload hashes can support provider validity after local
forgetting without implying erasure of caller-held copies or provider revocation.
No QR rendering/camera/customer transport or real provider integration is assigned.

Source schema and observation envelopes are fixed before the test freeze. Tables:
fixture_dropoff_credential_identity(singleton,body,digest),
fixture_dropoff_credential_operations(operation_id,command,command_digest,result,digest),
and fixture_dropoff_credentials(operation_id,family_ref,generation,body,digest,
key_id,nonce,cipher,tag,payload_hash). operation_id is the primary key in the last
two tables. The provider journal is capped at1000 operations; reject overflow
before creating a partial view or effect. No journal row is deleted by forgetting.

The exact command fields are schema_version, action, operation_id, tenant_id,
store_id, resource_id, source_id (native gateway receipt ID), source_digest
(receipt digest), source_identity, source_contract, source_account_id,
directory_identity, family_ref, subject_ref, quote_id, quote_digest, items_digest,
method_digest, fees_digest, site_id, destination_id, method_id, credential_kind,
generation, replaces_operation_id, issue_operation_id, expires_at,
credential_expires_at and financial_effect. For issuance issue_operation_id is
null; for revocation it is the exact issued operation. family_ref is
contentDigest([tenant_id,store_id,request_id]); digests use the native canonical
encoding. Public command construction is not an authorization API.

The immutable result fields are schema_version, operation_id, action,
command_digest, source_identity, source_account_id, family_ref, items_digest,
method_digest, generation, issue_operation_id, credential_id, credential_kind,
credential_expires_at, state, reason, provider_ref, observed_at and digest.
state is issued, revoked or rejected. Success pins the exact issued operation,
credential ID/kind/expiry and provider_ref; rejection has null credential_id and
provider_ref. No partial acceptance is a successful G02 result: extra fields,
partial state, wrong item/method digest or operation/source binding fail closed.
Result digest covers every field except digest. lookup returns this exact stored
immutable result even after current credential status changes.

credential returns schema_version, tenant_id, store_id, source_identity,
source_account_id, family_ref, subject_ref, operation_id, command_digest,
items_digest, method_digest, credential_id, kind, generation, expires_at, state,
revoked_at, replaced_by, delivery_available, observed_at and digest. Missing ID
returns null. Current state is computed from authoritative fixed expiry and
revocation; source observations never renew it. Core validates the complete
envelope against the original immutable command/result before trusting status.
The persisted body has those metadata fields except computed state,
delivery_available, observed_at and digest. Corruption tests may patch existing
prototype methods to return independently rehashed malformed observations;
strict rejection must not depend only on a stale envelope hash.

## Native isolation, privacy and recovery

Generic DurableWork, Reconciliation and ExecutionStops reauthorization reject
typed credential operations. WorkLeases excludes them. OperationStore separates
their unresolved stream from existing money/support streams without exempting
malformed records. ExceptionQueue optionally accepts the actual same-kernel
dropoff owner for secretless original-ID reconciliation only; no generic retry.

Add strict privacy preflight/revocation helpers following existing typed loyalty
integration. Cover historical-only subjects, current/old resource links, holds,
export, erasure, uninstall, file recovery and both merchant-import paths.
Retire personal quote/preview/approval copies and receipt payloads before generic
scrubbing; a hold retains evidence but never issue/delivery authority. Reapply
subject/resource suppression even with existing tombstones. Validate original
and destination records before mutation. Source forgetting removes encrypted
delivery copies; preserve minimized immutable IDs/commands/outcomes/unknown fences.
Restore never revives authority or permits unsent cancellation of uncertain work.
Retained read/reconcile requires actual human privacy.manage plus original-resource
operation.read/operation.reconcile. No secret is returned through retained paths.

## Independent specification, selection and exact fault

The author owns tests/development/dropoff-credentials.test.mts,
tests/development/dropoff-credentials-helpers.mts and
tests/fixtures/dropoff-credentials/independent-values.json. Reuse unchanged G01
native fixture: alpha shirt quantity2 and beta hat quantity1, main qr-bag method,
partner fee250 USD and destination handling estimate150 USD, kept separate.
Use literal expected values and actual original-ID provider journal assertions.

Freeze CASE-M20-G02-01 through -14 before runtime edits:
01 lost ACK/original lookup/expiry/replacement; 02 lost-before/null lookup retains
unknown; 03 named actual duplicate-generation fault; 04 distinct native approval
and rollback; 05 unsent exact item/fee/method freshness; 06 revoke uncertainty and
replacement; 07 malformed/partial/wrong binding evidence; 08 source/encryption;
09 human/worker/scope/proof/ownership/final-send revocation; 10 protected delivery
and separate expiry windows; 11 generic owner fences and no unrelated effects;
12 persisted reopen/historical lookup; 13 export/erasure/uninstall/held historical
subjects; 14 restore/import/suppression. Do not create an additional financial
fixture just to assert absence of credential-caused financial effects; preserve
actual financial/custody/capacity tables around actions.

One coherent final native batch selects these14, unchanged G01 eligibility12,
unchanged action-approvals18 and unchanged exception-queue14: 58 cases/four whole
files, one 60-second deadline, NODE_OPTIONS=--test-isolation=none. Additional runs
require concrete failure or material correction. No broad campaign or probes.

After a passing exact product, one isolated exact-parent fault deliberately
bypasses both core family uncertainty guard and provider family exclusivity.
CASE03 loses ACK after original issuance, then attempts a fresh independently
approved quote/operation. If faulty runtime permits a stage, continue all the way
through dispatch. Catch runtime denial only around that attempted chain; the
literal final oracle outside the catch must see exactly one native credential
and original ID. The mutant must actually mint a second credential for the same
unresolved family. Keep unchanged tests, run only the new file, preserve patch/
behavioral failure/native observations and never merge the fault.

Static preservation/pin checks and bundle-only recovery validation are not product
test credit. Exact candidate reviews, observed limitations and a recoverable
checkpoint close this assignment. G03 item acceptance, G04 custody progression,
G05/G99 partner/physical/device/accessibility/target-host/financial qualification
and formal accepted dependencies remain separate work.
