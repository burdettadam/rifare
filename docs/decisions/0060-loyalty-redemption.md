# ADR-0060: Assign durable synthetic loyalty redemption

## Prior authority, owners and limits

The owner's 2026-10-20 instruction to proceed toward the next milestone continues
under the existing delegated local development authority. From reviewed G02
closure c8e8240853bcd4434f71117f099695d6dfb0c286, root assigns bounded local
M19-G03. Root owns runtime and integration on goal/M19-loyalty-milestone and is
the sole executor. The independent test author works on test/M19-loyalty-redemption
in a separate worktree. Authority/security and regression reviewers remain
independent nonauthors. Freeze the independent tests before any G03 runtime edit.

The acceptance ledger still contains only its four earlier delegated entries;
it does not accept G03's formal dependencies. This assignment permits synthetic
local preparation, not formal M19 acceptance, provider qualification, public or
remote publication, a release, production, paid effects or messaging. Main,
accepted-goals, canonical planning baseline, existing tests and oracle values
remain unchanged. Missing later source from the interrupted chat is not recovered
by adopting its drafts. Current G01 uses safe-integer point numbers and transient
quotes; this assignment creates its own durable quote and operation records.

Root may add packages/adapters/loyalty-redemption-fixture-source.mts and
packages/commerce/loyalty-redemption-values.mts, loyalty-redemption-records.mts,
loyalty-redemptions.mts, loyalty-redemption-privacy.mts and
contracts/loyalty-redemption.v1.json. Narrow integrations are assigned in
packages/commerce/action-gateway.mts, operation-store.mts, work-leases.mts,
durable-work.mts, reconciliation.mts, exception-queue.mts, execution-stops.mts,
support-service.mts, privacy-lifecycle.mts, safe-recovery.mts and
merchant-portability.mts. Root owns this ADR, docs/LOYALTY-REDEMPTION.md,
docs/M19-REDEMPTION-DESIGN.md, PLANS.md, work/records/M19-loyalty-milestone.md and
necessary additive test/capability/source inventories, conformance declarations
and runtime/oracle pins. Existing privacy surface IDs and core schema stay fixed.
No permission catalog, worker grant, financial owner, G01 source API, migration,
model dependency or new inbox is assigned.

The independent author owns only tests/development/loyalty-redemption.test.mts,
loyalty-redemption-helpers.mts, an optional loyalty-redemption-race-worker.mts in
that directory, and tests/fixtures/loyalty-redemption/independent-values.json.
No existing test/helper/oracle may be changed. The selected native batch is 20 new
G03 cases, 21 action-gateway cases and 17 privacy-lifecycle cases: 58 cases in
three whole files under the unchanged single 60-second deadline. Additional
small verification requires a concrete unresolved finding. No broad suite is
implicitly assigned. Preserve and report the unchanged existing denominators.

## Native source and public owner API

LoyaltyRedemptionFixtureSource(balanceSource, clock=Date.now) wraps the exact
native G01 LoyaltyFixtureSource. It uses the same separate disposable loyalty
DB and has its own frozen source identity binding parent identity and
rifare-loyalty-redemption-fixture-v1. Native source/kernel references are fixed;
core and loyalty files must be physically different, including inode aliases.
The wrapper revalidates both persisted singleton identities on every call.
It exposes only these fixture methods:

- publishBenefits({revision, expires_at, benefits}), where each benefit has exactly
  id, points, unit='points', kind='synthetic_reward'. Benefits are 1–20 unique IDs,
  positive safe-integer costs and no monetary value. Catalog revisions are
  immutable, increasing and hashed. Identical current replay is idempotent.
- pinAccount(customer_id), explicitly anchors the current valid complete G01
  snapshot. The stable account_key binds tenant, store, parent source identity,
  source account and native subjectHash(customer). The private fixture anchor
  retains the raw customer ID; immutable core commands do not. Identical replay
  is idempotent; a missing or inconsistent existing anchor cannot be reset.
- observeAccount(account_key) returns a strict scoped anchor, current snapshot,
  current benefit catalog and complete original-ID journal, with a digest.
- redeem(command) performs one exact original-ID synthetic redemption or a
  journaled zero-effect rejection. Repeated exact command returns its original
  result; a different command under that ID conflicts.
- lookup(operation_id) returns the exact original terminal result or null. It
  never issues, cancels, releases or retries an effect.
- setMode(mode) is fixture administration only. Allowed modes are redeem,
  reject_insufficient, reject_unsupported, timeout_before_effect and
  timeout_after_effect. The last commits the one debit/reward before throwing;
  the before-effect mode throws without a booking. No mode comes from an end-user
  command, approval or service request.

LoyaltyRedemptions(kernel, {balances, source}) accepts only native same-kernel
LoyaltyBalances and the native wrapper of its exact source. Public methods are:

- context(scope, customerProof, {case_id,link_id,expected_generation});
- quote(scope, customerProof, {case_id,link_id,expected_generation,points,unit,
  snapshot_digest,benefit_id});
- read(scope, operation_id), dispatch(scope, operation_id),
  reconcile(scope, operation_id), expire(scope, operation_id).

Human owner/operator/reviewer roles use their existing specific permissions;
agent, integration, worker and customer callers cannot authorize/issue redemption.
Current G01 case/link/customer proof and human support ownership apply to new
quotes. context additionally reports provider_available_points, held_points,
accounted_held_points and effective_available_points, with no execution authority.
quote returns {id,digest,quote,approval_required:true,execution_authorized:false}.
The quote's points and named benefit are exact; a G01 quote cannot substitute.
A quoted or reserved quantity is not provider-issued, redeemed or converted money.

SupportService may receive optional loyaltyRedemptions, bound to its same G01
owner, and add loyalty-redemption-context/quote (exact customer_token/input),
plus loyalty-redemption-read/dispatch/reconcile/expire (exact operation_id).
Unconfigured calls fail explicitly. Existing route behavior is retained. No
HTTP or autonomous worker redemption entry point is assigned.

## Atomic source booking and complete history

Four STRICT source tables are assigned: fixture_loyalty_redemption_identity
(id=1,body,digest), fixture_loyalty_redemption_benefits(revision,body,digest),
fixture_loyalty_redemption_anchors(account_key,customer_id,body,digest), and
fixture_loyalty_redemption_journal(operation_id,account_key,seq,body,digest), with
unique account_key/seq. Every row and body is scope-bound, hashed and validated.
An anchor contains the exact immutable G01 snapshot and its digest. It is never
recreated from a later balance when prior evidence is missing.

The wrapper owns one BEGIN IMMEDIATE source transaction. It validates parent and
wrapper identities, anchor and complete journal correspondence, current native
snapshot, exact command, benefit, rule, point unit/cost/capabilities and freshness.
For success it inserts exactly one next immutable G01 snapshot and one journal
entry atomically. Only source_revision increments by one, redeemed increments by
points and available decreases by points; every other snapshot/rule/capability
field remains equal, including observation and expiry times. Reuse native G01
snapshot/envelope validators. Check all safe-integer counter/revision bounds.
Do not call G01.publish inside the wrapper transaction. Validate the resulting
history before commit. A rejected command adds a strict no-debit journal result,
with an explicit reason and equal before/after source revisions and digests.

Bound each account to 1000 journal entries and retrieve at most 1001 when checking
completeness. Every post-anchor source snapshot must be explained by one exact
journal debit; detect orphan, missing, duplicate, reordered, altered or foreign
rows. An external G01 publication, even a refresh, is deliberately unsupported
for further spending under this bounded fixture protocol. It cannot reset holds.
Historical lookup validates the original journal and its before/after snapshots
without requiring current freshness, current benefit availability or a new source
snapshot. Expired terms or an unrelated later snapshot cannot turn a null lookup
into proof of no effect.

## Exact approval and durable operation

Add only diagnostic.loyalty.redeem to the existing ActionGateway proposal,
preview, approval and execution dispatcher. Constructor options may contain
{loyalty: native LoyaltyRedemptions}; verify same kernel. Arguments are exactly
quote_id and quote_digest. Reuse distinct proposer/approver, single-use approval,
current approver membership and permission revision, execution permission,
configuration/source pins and ExecutionStops. Declare separate synthetic loyalty
readiness; do not reuse a diagnostic refund readiness claim.

The preview and receipt contain typed point terms and the named synthetic benefit,
financial_effect=false and no amount/currency/amount_ceiling pretending points
are money. Route the loyalty branch before unrelated return policy/write-state
checks. Exclude it from diagnostic case-effect and record fallbacks. Existing
human financial/return branches and result shapes stay byte-behavior compatible.
An independent approver validates the quote under its own authority, while
checking the recorded original human owner/generation and current customer-proof
session/binding; it does not impersonate the proposer or take over the case.

A durable quote has immutable terms and terms_digest separate from its mutable
consumed_by/authority/privacy state. Pin original proof hash (never a raw token),
owner/generation/link, customer/resource/case/configuration, source/account,
snapshot/rule and catalog/benefit digests, typed points, control stamp and expiry.
Quote/reservation TTL is exactly 10000 ms, bounded by proof, snapshot, rule and
benefit expiry. The independent source/proof/benefit windows exceed that TTL.

The approval-consumption transaction also binds that quote to one original
operation, creates its reservation, native operation, target, work and receipts.
Use native queueOperation(...,'case',receipt.id,...). Derive the operation ID from
the existing tenant/store/case/receipt-ID formula before composing the gateway
receipt. The immutable generic command's source_id is receipt.id and source_digest
is the digest of the finished receipt. This preserves BusinessOperations,
WorkerApi and ExceptionQueue associations without a digest cycle. A quote cannot
be consumed through another preview/receipt/operation.

The immutable generic/source command contains schema_version, action,
operation_id, tenant_id, store_id, resource_id, source_id, source_digest,
source_identity, source_account_id, account_key, subject_ref, quote_id,
quote_digest, points, unit, benefit_id, benefit_digest, benefits_revision,
benefits_digest, source_revision, snapshot_digest, rules_revision, rules_digest,
expires_at and financial_effect=false. It contains no raw customer ID, proof
hash/token, message, full source snapshot or monetary field. Source responses bind
this complete command digest and original operation, source/account, points,
benefit, terminal state/reason, synthetic provider reference and exact before/after
snapshot revisions/digests. All fields and row bindings are mandatory; partial
shape matching is not evidence.

## Reservation state and accounting

The stable entitlement is source/account/customer scoped across cases, resources,
processes and kernel handles. Admission uses core BEGIN IMMEDIATE and BigInt
arithmetic with safe-integer public points. Serialize the complete capacity check
and reservation creation with approval consumption. Reserve only currently
available provider points after all other applicable local holds.

States are reserved -> unknown or released; unknown -> redeemed or rejected;
terminal replay only. A known live never-dispatched reservation can expire to
released. Unknown never expires/releases/retries. Quote expiry, missing lookup,
changed ownership, erased data, process restart or a new key cannot release it.
Persist unknown and attempt count before invoking the provider. Recheck final
current issue authority adjacent to the synchronous native invocation, with no
intervening await or deferred callback. Dispatching unknown again performs no
second redeem call; reconciliation uses lookup of the original ID only.

held_points is the sum of reserved and unknown quantities. Exact source journal
proof may identify an unknown hold whose debit is already included in the current
provider snapshot. accounted_held_points includes only that exact original
command/debit proved in the validated complete history. Effective availability
is provider_available - (held_points - accounted_held_points), with BigInt and
nonnegative safe-integer checks. This avoids subtracting the same debit twice
without releasing the unknown record. Missing/invalid correspondence fails
closed. A claimed redeemed core state without the exact reflected booking is
not spendable evidence. Provider rejection releases only its original hold.

Immediately before dispatch revalidate current owner/generation, original proof,
exact consumed approval and preview/receipt chain, active distinct approver and
permission revision, unchanged source/rule/benefit terms, control stamp and
capacity excluding this operation's own hold. Other valid reservations do not
make the immutable quote digest change. After the source advances its own balance,
completion validates the exact result and current completion/retention authority;
it does not demand the pre-issue snapshot still be current. An unavailable current
completion authority leaves unknown for explicit lookup reconciliation.

## Strict core records and shared dispatch fences

Use only commerce_support_documents, kinds loyalty_redemption_quote and
loyalty_redemption_operation, one current row at version 1 per identity. No
append-only personal history/cache is needed. Every read validates strict field
sets, row/body kind/id/tenant/store, canonical digest, state, expiry and all
cross-bindings to native command, target, work and receipt. A mutable operation
record must agree with native operation state/revision and original quote/receipt.
Unknown/redeemed/rejected/released are economic states; generic row state=revoked
only removes authority and can never change economic meaning.

Bound admission to 1000 quote and 1000 operation records per store; bounded scans
retrieve limit+1. Replays do not create rows. Terminal observation, privacy,
release and restore updates remain possible at capacity. Active personal records
hold the current case/proof/owner/approval context; minimized records retain only
schema/kind/identity/scope, subject_ref, source/account/command linkage, points/unit,
original benefit and quote digests, reservation/attempt/recovery/authority state,
minimum timestamps and exact minimized terminal observation. All removed personal
fields are absent/null according to the strict retained variant, not arbitrary
copied JSON. Retain enough command linkage to recognize and encumber unknowns.

Separate valid typed loyalty work in BOTH operation-store.blockingOperation and
work-leases.unresolvedEffects. Do not exempt an action string with a missing or
malformed typed record. Preserve original financial/diagnostic and support
streams. A real operator-parent WorkerApi return dispatch must remain usable
while valid loyalty outcome is unknown. Generic DurableWork and Reconciliation
must reject typed loyalty mutations; synthetic_recorded never proves redemption.
Only the dedicated source/owner can resolve these holds.

Reuse ExceptionQueue. An optional native loyalty owner in its constructor gives
valid loyalty items a typed read/reconcile branch before generic resource/timeline
reads. Missing owners do not create authority; malformed typed records fail.
The normal queue and resolver contracts remain for all existing actions.

## Privacy, restore and retained reconciliation

Add strict preflight/has/export/erase/uninstall/restore helpers for both typed
kinds. Historical-only subject selection must support export, erase AND hold.
Call erasure minimization before the resource-list branch of eraseSelected.
Current holds retain personal data as required but revoke all issue authority on
uninstall/restore. Suppression from a current checkpoint overrides obsolete
copied holds. Erasure removes quote/proof/customer/approval payload copies,
revokes dispatch, and retains the minimum unknown quantity/original-ID linkage.
Live provably unsent reservations can release on erasure; unknown cannot.
No late source observation may recreate a minimized personal payload.

Reconciliation grants no new effect. For ordinary personal records require current
human operation.read/reconcile permission and original resource binding; a new
quote/proof/benefit or fresh balance is unnecessary. For erased, restored or otherwise
minimized records require active-store human privacy.manage plus current
operation.read/reconcile permission on the original resource, checked through
permissionDecision under that actual caller. This narrow retained branch does
not load erased customer content or call G01 egress/proof. It may return only
minimized original-ID status, point quantity and source outcome. It cannot issue,
reauthorize or repeat. Native inactive-store uninstall remains inaccessible
until a separately authorized recovery/import; no authentication bypass.

Physical restore and first/repeated merchant import validate original and
destination typed rows. BEFORE suppression/quote retirement, turn restored
reserved work into unknown, because dispatch may have occurred after the snapshot.
Retain all unknown encumbrances, revoke authority and add original replay fences.
Repeated import must preserve a destination terminal outcome. Null lookup of a
restored queued operation still means unknown. Replaying suppression applies even
where an older suppression receipt already exists. Keep the same core schema,
storage inventory chain and 15 privacy surface IDs; extend their precise coverage
and runtime pins. Fixture-side retention/cleanup remains separately unqualified.

## Independent oracle, fault and closure

Literal baseline: pending900, earned1000, provider-reserved150, redeemed200,
reversed50, available600. A primary synthetic benefit costs400; another costs200.
Two simultaneous400 reservations on distinct cases/handles cannot both consume
that account. Use real concurrent workers/processes and a start barrier, not two
synchronous calls inside Promise.all. The loser consumes no approval or quote.

Before-effect timeout: source600, held400, accounted0, effective200. Advance past
10000ms while proof/source/rule/benefits remain current; reopen and null-lookup;
a new400 remains insufficient. After-effect lost acknowledgment: source200,
held400, accounted400, effective200; original-ID reconciliation produces one
400 debit/reward and effective200. A later exact200 redemption gives source
redeemed800/available0 with exactly two effects. Native rejection releases to600;
a live unsent expiry also releases to600. No case converts pending900 into funds.

Freeze 20 native cases including the three permanent goal IDs, exact approval and
revocation, source/owner/physical isolation, strict journal and core integrity,
accounting overlap, real concurrency, final terms, atomic rollback, unknown versus
rejection/expiry, generic dispatch fencing, actual worker refund independence,
ExceptionQueue, erasure/retained late reconciliation, historical-only holds,
uninstall, physical restore and initial/repeated merchant import. The actual
financial fixture oracle remains independently fixed by its native source values.

After a clean candidate pass, create one isolated exact-parent fault that expires
an unknown BEFORE-effect hold (or permits a new identity) while all other terms
remain current. The unchanged frozen tests must fail behaviorally. An after-debit
balance alone must not mask the defect. Preserve the fault separately, actual
native reports/source hashes and both nonauthor decisions. Close only the bounded
local scope. Formal G03/M19 and connected/provider/target-host/full qualification
remain open. G04, G05 and G99 need separate bounded assignments.

## Frozen API shape details

The source wrapper's public readonly fields are balanceSource, db, tenant, store,
account, identity and contract. The native owner exposes k, balances and source.
Its binding includes tenant_id, store_id, source_account_id, balance_source_identity,
source_identity and source_contract. pinAccount returns a hashed envelope with
account_key, subject_ref, customer_id and snapshot (the full original G01 envelope).
observeAccount returns schema_version, the source binding, account_key, subject_ref,
anchor, current (full G01 envelope), benefits (current catalog), journal and digest.
Each journal entry contains its seq, original command/command_digest, result and
row-bound digest. Catalog envelopes contain schema_version, source binding,
revision, expires_at, benefits and digest.

A source terminal result has exactly schema_version, source_identity,
source_account_id, account_key, operation_id, command_digest, points, unit,
benefit_id, benefit_digest, state, reason, provider_ref, before_revision,
before_digest, after_revision, after_digest, observed_at and digest. state is
redeemed or rejected; a rejected provider_ref is null. A redeemed provider_ref is
`reward_` plus the first 40 hex characters of the original command digest.
Terminal reason codes are LOYALTY_REDEEMED, LOYALTY_INSUFFICIENT_POINTS,
LOYALTY_REDEMPTION_UNSUPPORTED, LOYALTY_SNAPSHOT_CHANGED, LOYALTY_RULES_CHANGED,
LOYALTY_BENEFIT_CHANGED or LOYALTY_TERMS_EXPIRED as applicable. Hash all fields
except digest. Lookup returns this original result; no new timestamp on replay.

context exposes schema_version, case_id, resource_id, account_key, source_identity,
snapshot_digest, status, reason, provider_available_points, held_points,
accounted_held_points, effective_available_points, benefits, execution_authorized
and production_qualified. Available status is available/LOYALTY_CURRENT_ENTITLEMENT;
invalid or incomplete evidence cannot produce a spendable numeric result.
quote.quote is its immutable terms and quote.digest is contentDigest(terms).
A reservation-insufficient quote throws LOYALTY_INSUFFICIENT_POINTS; it creates
no quote. Immutable terms do not include changing local held totals.

read/dispatch/expire return a minimized operation projection: schema_version,
operation_id, state, reason, points, unit, provider_ref, held_points,
authority_revoked, restored, minimized, command_digest, source_identity,
observation, execution_authorized=false, production_qualified=false and
financial_effect=false. Reconcile returns {disposition,operation,command_repeated:false},
where disposition is unconfirmed, reconciled or unchanged and operation is that
same projection. Null lookup gives unconfirmed and preserves unknown. expire
returns unchanged unknown; for an expired live never-sent reservation it releases
only after checking no contradictory source booking. Replays do not create rows.
The independent accounting oracle credits overlap only when observeAccount has
already supplied exact original-ID journal proof; unknown status itself is not
confirmation. Without that proof the full local hold continues to subtract.

ActionGateway(kernel,{loyalty}) and ExceptionQueue(kernel,resolver?,{loyalty})
retain their existing defaults. Their optional loyalty reference must be the
native same-kernel owner. Generic ExecutionStops.reauthorize also refuses valid
typed loyalty work; a changed stop cannot renew its original points approval.
Keep existing gift restrictions, then route loyalty before return-writability
checks. No human proof's last_seen or expiry is refreshed by quote revalidation.

## Native state and receipt mapping

The new gateway preview and action receipt use points={unit:'points',quantity:N}
and benefit={id,points,unit:'points',kind:'synthetic_reward'}. The receipt's
original-operation field is loyalty_operation_id, its effect is
synthetic_loyalty_authorized, and its state is reserved. There is no amount,
currency, amount_ceiling or financial resolution substitution.

The typed operation body fields for economic state and dispatch attempts are
state and attempt_count. native_revision binds commerce_operations.revision.
Native mappings are reserved=queued/pending, unknown=unknown/unknown,
redeemed=succeeded/done, rejected=failed/dead and released=failed/dead, where each
pair names operation/work state. Rejected and released remain distinct typed
states with distinct reasons. The one initial dispatch sets attempt_count and
work.attempts to1 before source invocation. No second attempt is permitted.
Restored reserved work becomes unknown with attempt_count0; this records copied
uncertainty without falsely claiming the original snapshot observed a dispatch.

Add only reservation_released to operation-receipts.mts RECEIPT_CODES; that file
is an additional narrowly assigned integration path. Live unsent release records
this code, not provider_rejected or source_confirmed. Existing queued,
outcome_unknown, source_confirmed and provider_rejected codes retain their
semantics. Native schema and immutable receipt/operation-identity triggers stay
unchanged.

The wrapper methods redeem, lookup and setMode and the owner methods context,
quote, read, dispatch, reconcile and expire are synchronous. Existing async
service/exception adapters may await their results. Timeout modes are deliberate
synthetic transport faults before/after an actual source transaction, not claims
of measured remote network behavior.

## Final authority and concurrency clarifications

Every owner/gateway G03 entry requires actual owner/operator/reviewer role AND
kernel.workerIdentity(scope)===null. An operator-parent restricted worker scope
still has role operator and must not inherit redemption or retained-administration
access. Quote additionally requires action.propose; dispatch requires both
operation.dispatch and action.execute; read requires operation.read; reconcile
requires operation.read and operation.reconcile. expire requires operation.dispatch.
Current context uses existing support/resource access and customer proof. Retained
read/reconcile additionally requires privacy.manage with the same human restriction.

Dispatch commits unknown in its first core transaction. It then holds a new core
BEGIN IMMEDIATE across the final current-authority checks, synchronous native
redeem invocation and validated completion update. This prevents another core
connection changing approval/ownership/control between the final check and call.
The provider still has its separate atomic transaction: a provider throw or a
second-phase core rollback leaves the previously committed unknown intact.
This is not a claim of a distributed atomic transaction.

A live release requires attempt_count=0, restored=false, no prior dispatch/outcome
receipt and no contradictory original-ID source booking. Restoration's unknown
with attempts0 is explicitly ineligible for live release. Historical completion
and minimization update existing rows, so admission capacity cannot prevent them.

## Pre-freeze interface confirmations

Both stored typed record kinds use boolean minimized and authority_revoked
fields. Quote terms use numeric points with unit='points'; gateway previews and
receipts use the separate typed points={unit:'points',quantity:N} projection.
After required current authorization and stored-evidence validation, dispatch of
a redeemed, rejected or released operation returns its unchanged terminal
projection. It creates no attempt, provider call, receipt or typed record.
A consumed quote may be rejected during preparation, approval or execution, but
cannot create a second reservation. Concurrent admission failure reports
LOYALTY_INSUFFICIENT_POINTS and consumes neither the losing quote nor approval.

Explicit pinAccount may anchor a valid complete limited-provider snapshot.
Anchoring is evidence capture, not spending authority: reserve=false still
prevents spendable redemption context and quotes. The disposable source tables
retain their native fixture corruption seam; isolated tests may change and
restore their own journal/anchor rows. Core immutable command, target and receipt
triggers remain unchanged.

The retained exception is limited to read and reconcile. expire keeps ordinary
operation.dispatch, resource and recovery authorization; it does not bypass
quarantine or erased-resource write fences. A denied retained expiry attempt
leaves the unknown state, attempt count and held quantity unchanged, observable
through authorized retained read. An ordinary live authorized unknown still
returns its unchanged projection from expire. Terminal dispatch replay likewise
remains subject to ordinary current dispatch/execution authorization.

## Candidate-review corrections

Independent review of initial product candidate 258d9cf identified that optional
native receipt payloads could consume the bounded loyalty audit chain and prevent
its required completion. Before implementing that correction, this assignment
extends the existing operation-receipts.mts integration to a loyalty-action-only
admission guard. Its 1000-receipt budget reserves two native transitions while
queued, one while unknown, and one future erasure receipt for each outstanding
payload attached to that exact operation. Every append checks the budget after
the enclosing payload mutation; failure rolls that mutation back. Other actions,
receipt schemas, codes and immutable triggers remain unchanged. The independent
authority reviewer confirmed this accounting before implementation.

Privacy live-release evidence includes the exact native source registered by the
validated owner on that core kernel. Different source handles for the same durable
identity are rejected. Physical separation and source identity/history are checked
again on release. Without that transient binding, erasure may revoke and minimize
the reserved record but must keep its original quantity held; it cannot invent a
send attempt, restore flag or source absence. Such a revoked reserved operation
cannot currently use the unknown-only reconciliation path. Recovery itself has no
provider availability dependency and converts copied reservations to unknown.

Historical loyalty subjects associated with resources about to be erased join the
existing related-subject hold check by hash. An active hold preserves their native
context. When erasure is eligible, minimize only the affected historical loyalty
records and retire their own previews/approvals before generic case erasure; do not
create an unrelated subject tombstone or erase that subject's other resources.
Historical-only minimization must also retire those native preview copies even
when the subject has zero current resources. A current suppression checkpoint
remains authoritative over copied held context.

Fresh merchant import reconstructs local operation replay fences after original
package validation and insertion but before strict validation of the populated
destination. Existing-destination and repeated-import preflight remain strict and
precede any reconstruction. This permits a validated re-export whose deliberately
excluded local fence table is absent without accepting missing destination fences.

The initial independent test freeze b8134dec and failed native report remain
evidence. A root-owned host transport probe demonstrated that child fd0 is a
socket, but this host's Node standard-stream wrappers discard input/output;
explicit fd-backed input and writes preserve the bytes. A narrowly independent
fixture transport correction may use those descriptors while preserving all
20 cases, literal values, process isolation, the start barrier, network-deny
preload and deadlines. This does not relax any product expectation.
