# ADR-0056 — Current-state journey follow-ups

## Prior assignment and authority

The owner repeatedly instructed continuation through the next milestone and
delegated local development decisions. Root assigns this bounded local M18-G04
increment before its independent tests or runtime. It starts from reviewed G03
product 861a4bc0aaea93a0ed7c052268ab2ff8be403738 and documentation checkpoint
e7ae55378260e2ab1133fe863c53515b2c037197. Root is the sole runtime author and
executor on recovery/M18-followups; /root/m18_memory_tests independently authors
the assigned tests on recovery/M18-followup-tests. /root/m18_authority_scope and
/root/m18_regression_scope remain nonauthor reviewers.

Formal dependencies remain open. This local preparation does not accept M07,
M09, M15 or M18, invent missing source history, qualify remote clients, expand
worker grants, contact anyone, publish, deploy or use paid/production effects.
Recovered main a33c4ad and earlier checkpoints remain unchanged.

## One existing native path

Use the existing reviewed/published SupportRules queue_tracking action and
SupportDelivery tracking_status_v1 transactional template. Do not add a message,
consent, campaign, exposure, financial or operation ledger. The logical step is
fixed to tracking_status_v1; no arbitrary step, template, message text or policy
is accepted. The original rule event body stays byte-for-byte canonical and
immutable. Only one selected matching native rule is scheduled, without fan-out.

One logical follow-up is keyed by tenant, store, journey ID, intent ID and that
fixed step. Exact original request replay returns the same finite job projection.
Changed event IDs/bodies, rule revisions or other request fields for that logical
step raise JOURNEY_FOLLOWUP_CONFLICT, including after suppression or completion.
Terminal steps never reopen or acquire a second operation or exposure identity.

The selected intent/reference combinations are tracking/null, shopping/cart,
return or exchange/resolution, and edit/edit. A selected resolution must be the
original refund or store-credit operation. Fulfillment replacement/label, pending
return-request and additional-payment references are not completion references
for this profile. They retain their existing G03 provenance and native stages.

## Public API and authority

Add JourneyFollowups(k, journeys), requiring an actual same-kernel
CommerceJourneys instance with an actual same-kernel SupportDelivery owner.
Its existing native cart/resolution/edit owners must agree with the delivery
guard owners. Fake objects, getters, foreign kernels and unsupported owner keys
are refused before effects. Constructors do not invoke providers.

schedule(scope, customerProof, input) accepts exactly:

    {rule:{id,version,digest},
     journey:{id,version,context_digest,intent_id,reference},
     event:{id,case_id,trigger,channel,at,visited,depth,link_id,sender_id},
     expected_generation,expires_at}

reference is null only for tracking; otherwise it is an exact canonical
{kind,id,digest} already attached to the selected intent. Normalize JSON without
invoking getters, bounded to 32 KiB. IDs, hashes and safe integers use existing
validators. expires_at must be in the future, at most seven days away, no later
than the rule expiry, and strictly after the actual native due time. Native UTC
calendar, trigger, visited-rule and depth rules still apply. No additional keys
are accepted by existing public schedule/queue routes.

Use the separately supplied actual current customer proof, exact current case,
resource, customer, source-contact binding, verified email link and ownership
generation. Scheduling requires current support.reply, operation.read and the
existing support.send/native owner checks; customers acquire no new privilege.
The supplied journey ID/version/context_digest must match its current context
for new work. A context digest is not an authority token. Persist the server's
actual journey document digest, never confuse it with the context digest.

inspect(scope, customerProof, input) accepts exactly
{case_id,link_id,expected_generation,job_id}. Current proof and case/link scope
are required. Staff must own the current generation. Without operation.read,
including customer callers, return a restricted finite projection and perform
no native private observation. Neither method returns guard bodies, source pins,
memory values, references, proof tokens or model threads.

Both methods return {job_id,case_id,state,reason,operation_id,customer_delivered,
restricted,manual_action_required,execution_authorized:false,
production_qualified:false}. operation_id is null for restricted viewers.
States preserve waiting, queued, suppressed, unknown and actual delivery stages;
accepted remains customer_delivered:false. Restricted state is explicit.
Inspection may retire ineligible follow-up context, like existing memory reads,
but cannot queue, dispatch, confirm a cart or create a business effect.

SupportService adds followups and journey-followup-schedule/inspect routes,
each exact {customer_token,input}. Existing options.journeys native owners feed
the delivery guard. No new grant, model dependency or remote route is created.

## Native job and delivery binding

Reserve the job prefix sjf_; its suffix uses the existing native hash inputs
[tenant,store,rule ID,event ID]. Every sjf_ job or queue event requires a valid
guard, even when its job/result has been deleted or emptied. The positive
job.result.journey_guard pin is {guard_id,guard_version,guard_digest}. Native
completed results preserve this pin; ordinary SupportRules.job projections
remove it, and restricted guarded results omit private operation IDs.

Only a narrow internal optional SupportRules schedule argument selects the exact
native rule and guard pin. The new service creates the guard and native waiting
job atomically. It checks the actual due_at and immutable job digest before
commit. Legacy job IDs, event bodies, action selection, results and manual-work
decision routes remain compatible. Guarded cancelled jobs are terminal in
SupportRules.execute. Ineligible waiting jobs become cancelled/suppressed with
no delivery operation or source call.

The delivery payload adds only journey_followup:
{job_id,guard_id,guard_version,guard_digest}. Guard discovery/association checks
run before queue's existing-operation early return, including direct calls to
the ordinary queue route with an sjf_ event ID. An existing operation with an
absent or different payload pin is not reused or retrofitted. The guard binds
the exact case/resource/link/sender/template/generation, rule/event/job and due
time. Direct early queue attempts cannot dispatch around the rule: final send
requires the original job completed with result.operation_id equal to this
exact delivery operation.

Add optional native guard owners as SupportDelivery's sixth constructor argument
{cart?,resolution?,edits?}; validate actual classes and kernel ownership. Guard
code must not depend on a model, arbitrary callback or CommerceJourneys import
cycle. Existing five constructor arguments remain compatible.

The new final guard executes inside SupportDelivery.#final immediately before
DurableWork.beginSend. Preserve all current parent-session, owner, sender,
contact, consent, tracking-freshness, stop and recovery checks. There is no await
between the final transaction and source.send. Use current dispatch authority
and retained source pins, not a saved customer proof/session; scheduling proof
expiry alone must not manufacture a new credential or silently extend one.

Unknown/already-attempted delivery retains its original operation and payload.
Native reconciliation remains lookup-only and is not blocked by later journey
ineligibility. An accepted or unknown send is never relabeled as an unsent
suppression, and processing never repeats that effect under a fresh event.

## Current eligibility and stage meanings

Check the latest guard version/digest, actual current journey version/document
digest, exact selected canonical reference, ownership generation, verified link
revision, original rule/reviewer authority, source identity/version/digests,
expiry, current consent and native owner availability at waiting execution and
final send. No automatic repinning occurs. Native source uncertainty remains a
manual/reconciliation condition and blocks a new send. Resource-wide G03
uncertainty checks retain their documented bounded capacity refusal.

Guard reasons distinguish cart_purchased, refund_settled, credit_issued,
edit_released, edit_cancelled, edit_abandoned, native_unknown,
native_owner_unavailable, journey_changed, memory_changed, source_changed,
ownership_changed, rule_changed, consent_changed, expired and unavailable.
Integrity failures remain JOURNEY_FOLLOWUP_INTEGRITY, not eligible/missing data.
New ineligible schedules refuse JOURNEY_FOLLOWUP_INELIGIBLE; final guarded
ineligibility refuses JOURNEY_FOLLOWUP_SUPPRESSED. Existing native authorization
and expiry errors may remain more specific.

Only ShoppingCart.readCart status purchased establishes purchase; proposed is
not confirmed by inspection, unknown is unresolved, and committed/active is not
purchased. Only ResolutionExecution cash_settled or credit_issued establishes
the corresponding completed financial stage. Accepted refund is still pending.
OrderEdits ready_for_release remains pending; released, cancelled and abandoned
are distinct terminal workflow outcomes. A replacement created or label bought
does not prove shipment, refund or completion of these selected steps.

Retain only the shopper-memory ID and latest version (explicit zero if missing),
not preference values or their body digest. Validate the actual native memory
record's schema/hash, expiry and original source/link provenance at use. A new,
corrected, forgotten, expired or source-invalid memory version suppresses old
follow-ups. G01 modules and their privacy rules remain unchanged.

## Retained guard records and privacy

Use existing commerce_support_documents kind journey_followup, author
journey_followup, reviewer/review_digest NULL. Maximum 10,000 retained rows per
checked scope, no truncation. Versions start at one and remain contiguous;
older versions are revoked. The logical/request identity remains fixed across
retirement versions; redacted histories cannot become active again.

Finite schema_version 1 current body fields are case_id, resource_id, subject_ref,
logical_key, request_hash, status, job_id, job_digest, journey, memory, source,
link_id, link_revision, rule, sender_id, generation, due_at and expires_at.
logical_key hashes ['rifare-journey-followup-v1',tenant,store,journey ID,intent ID,
'tracking_status_v1']; guard ID is jfg_ plus its first 40 hexadecimal characters.
request_hash binds the exact normalized public scheduling request. journey is
{id,version,digest,intent_id,reference}; memory is {id,version}; rule is
{id,version,digest}; source is {customer_resource_id,customer_source_version,
customer_source_digest,order_source_version,order_source_digest,observed_at}.
job_digest hashes the actual immutable native job columns, excluding state/result.
No transcript, addresses, preferences, credentials or finance payload is copied.

Retirement revokes all personal versions, scrubs unheld personal fields and
appends a minimized redacted tombstone when necessary. Keep case/resource/subject,
logical/request hashes and original job ID as exact historical/replay identity;
clear job_digest, journey, memory, source, link, rule, sender, generation, due and
expiry fields to null, adding a finite reason. Held older content stays revoked
and inaccessible until cleanup after hold release. A terminal job cannot reopen.

Privacy export is allowlisted journey_followup_records by exact retained subject,
including subjects with zero current resources after reassignment/deletion.
Include only id, case_id, resource_id, version, state, job_id,
retained_under_hold and subject_projection:true. Erasure scrubs every version
before canonical case/source minimization; uninstall revokes all histories.
Journey forgetting invalidates linked follow-ups dynamically; no G01/G03 core
mutation hook is needed. Invalidated waiting jobs cancel without effects.

Native backup restore and original/destination merchant import preflight validate
all retained structure separately, even revoked historical rows, before cleanup.
First and repeated import both invalidate copied context. Current subject erasure
overrides an obsolete copied hold; unsuppressed held personal guards refuse
atomically with JOURNEY_FOLLOWUP_RESTORE_HELD. No restored guard/job automatically
resumes. Existing native operation/receipt IDs and suppression formats remain.

## Paths, independent oracle and evidence budget

Root may add packages/commerce/journey-followups.mts,
journey-followup-records.mts, journey-followup-guard.mts,
journey-followup-privacy.mts, contracts/journey-followups.v1.json,
docs/JOURNEY-FOLLOWUPS.md and this ADR. Narrow existing runtime hooks are limited
to support-rules.mts, support-delivery.mts, support-service.mts,
privacy-lifecycle.mts, safe-recovery.mts and merchant-portability.mts.

Independent author owns only tests/development/journey-followups.test.mts and
journey-followups-helpers.mts. Root may append the 19 registrations and one
proposed-not-accepted capability, new protected paths/inventory members, assigned
runtime/oracle pins, existing privacy implementation/retention/erasure text,
licensing source count, PLANS.md and work/records/M18-journey-checkpoint.md.
Preserve all 3,158 prior test objects, 212 capabilities, 532 protected paths,
1,822 sources, 310 runtime pins, 619 oracle pins, 38 adapters, 15 surfaces and
262 tables. Do not change old tests/helpers, oracle expectations, native effect
owners, permissions, worker grants, runners, migrations or dependencies.

Use supportFixture and native reviewed rule, current CommerceJourneys and actual
ShoppingCart/ResolutionExecution/OrderEdits where needed. The independent oracle
is the separate fixture source ledger, original IDs, actual literal native stages
and unchanged operation/job/event counts. The final purchase race uses a guarded
transactional tracking message and actual fixturePurchase in beforeFinal while
tracking, memory and journey records remain unchanged, so an older campaign/cart
recovery guard cannot mask the new guard's deliberate bypass.

Exactly 19 new native cases include CASE-M18-G04-01/02/03 and the independently
proposed input/scope/native-guard/rule/memory/cart/resolution/edit/delivery/pins/
service/history/privacy/holds/restore/reimport cases. The only focused selection
is these 19 plus support-delivery 9, support-rules 8 and growth-marketing 24:
60 native cases, four whole files, one 60-second invocation deadline using the
unchanged tools/dev_tests.py. Root alone executes. Retain every failed attempt.
After a coherent candidate, run an isolated final-guard fault with unchanged
tests, preserving the behavioral failure and never integrating it. Two
independent exact-candidate reviews are required, at most three corrective rounds.
Local approval is separate from formal G04/G05/G99 or external qualification.

## Prior clarifications from independent contract review

These decisions precede runtime and the independent test freeze. An attached
canonical proposed cart may have a waiting transactional tracking follow-up;
inspection leaves it proposed and creates no cart-source effect. Waiting native
rule execution returns state cancelled on ineligibility; follow-up inspection
returns suppressed with the exact guard reason. The final purchase race throws
JOURNEY_FOLLOWUP_SUPPRESSED and native delivery inspection reports suppressed.
manual_action_required is false for waiting/queued/accepted/delivered and for
suppression because of cart_purchased, refund_settled, credit_issued or a terminal
edit outcome. It is true for unknown, restricted and other ineligibility/failure
conditions that need current human review. Accepted never implies delivered.

Native schedule must check both sj_ and sjf_ counterparts for each selected
[tenant,store,rule,event] identity. Ordinary scheduling cannot create an sj_
duplicate when the guarded counterpart or its retained guard exists, including
after deletion of the original job/result. Guarded scheduling refuses an already
existing legacy counterpart. A conflicting original event body also refuses.
These checks do not change unrelated legacy scheduling or event identities.

Before due_at, direct guarded queue refuses without creating an operation. At or
after due time it can retain a valid queued operation while the job is waiting.
For such not-yet-attempted work, dispatch checks that the job is completed with
this exact operation before DurableWork.claim, and repeats the same requirement
in #final. An early refusal leaves operation/work/guard untouched; it must not
consume a lease or mark the operation permanently failed. Native rules.execute
can then reuse that original queue, complete the job atomically and dispatch once.
Already-attempted unknown/succeeded work preserves native replay/reconciliation
behavior. No new internal queue token, callback or permission is needed.

Retirement changes personal guard bodies and therefore their digests. Keep
original job and delivery payload pins immutable. Validate every retained row
and exact guard/job identity, then recognize a legitimately revoked/redacted
guard as permanently ineligible even if its old redacted digest differs from
the original pin. Any active new queue/final send still requires the exact
latest original version/digest. A tombstone is never repinned as eligible.
Restore preflight is structural and allows legitimately stale journey references
to reach retirement. To isolate the new held-content refusal, the independent
fixture may forget G03 while unheld, then create a hold and snapshot without
reading/retiring the still-personal guard.

The exact-subject privacy hook selects its original guarded native job and
guarded delivery copies by retained job/operation identity even when the subject
owns zero current resources. Apply the existing logical-redaction/cancellation
semantics to those copies without rewriting an attempted operation ID or stage.
Ordinary event immutability does not prohibit established privacy erasure.
Restore/uninstall cancel waiting jobs and never call a message source.

Restricted projections apply through legacy owners too. For guarded jobs and
deliveries only, current customers or callers without operation.read receive a
finite restricted result with no operation/native/source IDs, private stages,
guard pins or source-specific reasons. SupportService.context inherits the
guarded delivery restriction. Strip the entire richer native result where
necessary; removing only operation_id is insufficient after queue reuse.
Unguarded legacy result shapes and permissions remain unchanged.

The reserved event boundary also applies to direct delivery calls using an sj_
counterpart of a retained sjf_ guard, and to queueHelpdesk: unsupported message
routes cannot reuse a guarded event as an unguarded effect. A guarded native
result is always restricted through legacy views when operation.read is absent.
The delivery parent's existing restricted session is not widened; private native
guard reads use the actual dispatch scope. Memory validation rechecks its own
original source link as well as the selected follow-up link. All guard versions
retain the same case/resource/subject/logical/request/job identity tuple.

Exact scheduling replay follows current proof/scope/ownership validation but
precedes new-work journey-version comparison. A caller after takeover uses
inspect with the new generation; replay does not waive the generation binding.
Native sender expiry (at most one day) and queued delivery expiry (at most one
hour) remain unchanged despite the follow-up's possible seven-day horizon.
Positive edit fixtures use actual released/cancelled methods. The native
abandoned terminal reason is retained without fabricating an unavailable public
abandonment transition or claiming that positive observation.

Permanent guard retirement also terminally cancels an exactly associated,
provably unattempted direct delivery so it cannot block later support-stream
work. In the same transaction, require operation queued, work pending with zero
attempts and no lease/owner, no native observation/provider reference, and no
contradictory dispatch/confirmation history. Use the existing work dead /
FINAL_AUTHORIZATION_DENIED and transitionOperation failed / provider_rejected
outcome, preserving original command, payload, target, operation ID and pins.
Use the actual actor when available or the explicit journey_followup_lifecycle
internal actor for restoration; never fabricate a session. Repeat retirement is
idempotent. Leased, sending, retrying, unknown, succeeded or otherwise attempted
work keeps its existing final-send/reconciliation path. An eligible direct queue
whose rule job is only waiting remains untouched by the pre-claim refusal.
The independent author covers retirement of a pending direct queue, release of
its native stream blocker and immutable replay within the assigned 19 cases.

## Prior fixture correction after the first actual invocation

At product f0de7f4, attempt-01 executed all 19 new cases: 16 passed and three
failed during permission-fixture construction. Permissions.change permits at
most 30 actions; copying the complete operator ROLE_ACTIONS minus one exceeds
that native limit and raises INVALID_PERMISSION before the intended denial.
The other three selected files were not run. The runner's zero successful-batch
count is not the native executed count.

Before another invocation, root assigns the independent test author only the
bounded operator action-list setup correction in the two already assigned test
paths. Use an explicit valid set retaining the current case/context, follow-up
and native dispatch permissions except the deliberately denied action. Keep
all 19 IDs and every behavioral assertion; establish that the intended action,
rather than an unrelated omitted permission, is the refusal. Native permission
code, limits and existing tests remain unchanged. Preserve attempt-01 in full.
