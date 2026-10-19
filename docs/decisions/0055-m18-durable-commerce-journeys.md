# ADR-0055: Durable composition through existing commerce owners

## Prior assignment

The owner's 2026-10-19 instruction and standing delegation authorize continuation
of M18 local preparation. G02 product 6743310b67cf69569d307210c144242edd238d94 passed
57 native cases and both independent round-1 reviews without findings. Root now
assigns G03 before tests and implementation on recovery/M18-journeys, preserving
all earlier refs and recovered main a33c4ad. No formal dependency acceptance,
remote qualification, connected operation, publication or deployment is inferred.
The original goal/milestone objects and acceptance ledger remain unchanged.

Root is sole product executor and runtime writer. /root/m18_memory_tests authors
exactly 23 new native cases in recovery/M18-composition-tests before runtime;
/root/m18_authority_scope and /root/m18_regression_scope remain nonauthor final
reviewers. At most three corrective review rounds. Existing focused budget stays
60 native cases, four whole files and one 60-second deadline per invocation.

## Concrete contract fixed before tests

Add CommerceJourneys(k, reads, owners={}) with optional actual FulfillmentExecution,
ResolutionExecution, OrderEdits, ShoppingCart and SupportDelivery owners, named
fulfillment, resolution, edits, cart and delivery. Each must have the same kernel;
delivery.tracking.reads must equal reads. ReadContext must be its actual class.
No descriptor, callback or caller-supplied status can qualify an owner.

Common input fields are exactly case_id, link_id, expected_generation. Normalize
JSON (32 KiB) before reading fields. Every method binds the current opaque caller
and current customerProof, exact tenant/store/case/resource/customer/link, current
source/contact proof and ownership generation. Noncustomer callers must own the
current generation. Reads require native support.read. Mutations require current
support.reply for staff/agents, or support.customer_message for actual customers;
underlying native methods retain all their own permissions and worker fences.
A fresh customerProof does not replace the original case verification. No model
thread, transcript inference, new worker grant or approval authority is added.

Methods:

- open(scope, customerProof, common + expected_version + request_id). Only a new
  journey (expected_version 0) may open. Returns context. One deterministic
  journey per exact tenant/store/case/resource/retained subject. Forgotten or
  restored journeys cannot silently reopen on the same case.
- attach(scope, customerProof, common + expected_version + request_id + intent_id
  + kind + references). Appends new canonical references to the named intent;
  never replaces old references. kind is tracking, return, exchange, edit,
  shopping, followup or handoff, and is immutable for an intent. Empty references
  are permitted for tracking/handoff only. At most ten intents, 32 total refs.
- context(scope, customerProof, common). Returns id, version, status, case_id,
  resource_id, configuration_digest, ownership_generation, history, intents,
  unresolved, handoff_required, model_thread_required:false,
  execution_authorized:false, production_qualified:false and context_digest.
  Missing and retired states are explicit. History reports selected link status
  and source_revision; unknown history is never treated as an empty conversation.
  Intent states derive from canonical records and native owner inspection.
- prepare(scope, customerProof, common + expected_version + request_id + intent_id
  + kind + proposal). proposal is the exact native ActionGateway proposal. Routes
  only diagnostic.return.submit / diagnostic.return.resolve (return/exchange),
  diagnostic.exchange.create / diagnostic.label.purchase / diagnostic.label.void
  (exchange), and diagnostic.order.edit (edit). Native quote generation remains
  with existing owners. Calls the unchanged gateway.prepare and appends its exact
  preview ref in the same transaction. Returns {journey, native: originalPreview}.
- execute(scope, customerProof, common + expected_version + request_id + intent_id
  + preview_id + preview_digest + approval_id). The exact preview must be attached
  to that intent and its action must match the intent. Calls unchanged gateway
  execute; appends exact approval, receipt and resulting canonical operation refs
  atomically. Returns {journey, native: originalReceipt}. Does not approve or
  dispatch. Text acknowledgement and altered item/amount/source inputs are invalid.
- reconcile(scope, customerProof, common + expected_version + intent_id + reference).
  Only the exact attached canonical reference can be reconciled through its
  supplied native owner, with native operation.reconcile authority. Fulfillment,
  resolution, edit and delivery use their existing lookup-only methods. Cart
  uses its actual customer proof and confirm only after retained state is unknown
  or committed; proposed is JOURNEY_OPERATION_NOT_ATTEMPTED, never a commit.
  Returns {journey, native: original owner observation}; no new journey version or
  operation ID. Recheck the caller/proof/generation/version after awaited work.
  A native late observation may persist, but cannot grant the obsolete caller a
  new journey transition. Generic/native-return blockers require their existing
  native reconciliation path, which is not newly routed here.
- forget(customerScope, common + expected_version + request_id). Only an actual
  currently verified customer may forget. Scrub all unheld historical versions,
  retain held values revoked and inaccessible, and append a redacted tombstone.

## Canonical references, uncertainty and state

A reference has exactly {kind,id,digest}. Allowed kinds: preview, approval,
receipt, return_request, fulfillment, resolution, edit, cart, delivery. The digest
is the canonical row digest except approval uses preview_digest and cart uses
its stored preview_digest (stable when a native receipt is later observed).
Validate actual scoped canonical row/body identity, case/resource/customer and
related original preview/receipt associations. Financial/private refs are exposed
only to staff/agent callers with current operation.read; other readers receive
an explicit restricted projection, never approval IDs. Canonical lookups validate
all retained personal versions before ordinary use. Missing or corrupt references
fail closed; missing optional execution owners produce explicit handoff states.
Returned artifact refs are provenance, not a claim that an old preview is usable.
Current native gateway checks are decisive for preparation/execution.

Before prepare/execute, inspect unresolved canonical effects across the entire
resource, including effects not attached or created under a second case. Bound
queries; no silent truncation. Cover commerce_operations sending/unknown,
commerce_native_return_operations unknown joined through return_requests,
commerce_resolution_operations unknown, commerce_fulfillment_operations unknown,
commerce_edit_steps unknown and parent commerce_order_edits unknown, and
commerce_shopping_carts unknown. Display original IDs, family, state and applicable
native-reconciliation handoff. Refuse new preparation/execution with
JOURNEY_RECONCILIATION_REQUIRED. The conservative edit-parent guard remains until
native continuation advances it; observing a child step is not edit completion.
Unrelated order uncertainty must not block this order. No additional instant,
disposition or arbitrary action routes are assigned.

## Persistence and lifecycle

Use existing commerce_support_documents kind commerce_journey; no new table or
ledger. Finite schema_version 1 body includes case_id, resource_id, subject_ref,
request_hash, status current/redacted, link_id/link_revision,
configuration_digest, ownership_generation, intents, and reason only when redacted.
IDs and low-entropy source data are never inferred. Retain no transcripts,
addresses, customer proof credentials, preference values or copied finance state.
Author is fixed journey_coordinator; reviewer/review_digest/expiry are NULL.
Versions start at one, are contiguous, and have unique hashed request IDs.
Supersede prior versions as revoked without removing original intent refs from
current history. Exact version conflicts and request replay are rejected.
Historical data is validated without requiring live source/case ownership for
privacy export/erasure. Maximum 10,000 journey document rows per checked scope.

Reuse current privacy, holds, uninstall, safe recovery and merchant portability
hooks. Subject selection includes historical retained subject_ref even with zero
current resources after source reassignment/deletion. Export an allowlisted
subject-only projection. Erasure scrubs all versions before case pseudonymization;
canonical financial records remain governed by their existing lifecycle. Forget
and uninstall revoke held records and scrub unheld data. Release of a hold allows
later cleanup without reviving old context. Preflight destination and original
transfer records separately, including repeat import. Restore/import conservatively
scrubs/revokes all journey personal refs, including already revoked versions; no
auto-resume or send. Unsuppressed held personal records cause atomic restore/import
refusal; current erasure suppression supersedes a copied obsolete hold. Preserve
the existing checkpoint format, suppression replay, image and memory protections.

## Assigned paths and protected baseline

Root may add packages/commerce/commerce-journeys.mts, journey-records.mts,
journey-references.mts, journey-privacy.mts, contracts/commerce-journeys.v1.json,
docs/COMMERCE-JOURNEYS.md and this ADR. Narrow existing runtime hooks may change
only support-service.mts, privacy-lifecycle.mts, safe-recovery.mts and
merchant-portability.mts. Add SupportService.journeys with options.journeys (native
owners except delivery) and post routes journey-open/context/attach/prepare/execute/
reconcile, each exact {customer_token,input}, plus journey-forget with direct
customer input. Existing readiness options.journey remains compatible.

Independent author owns only tests/development/commerce-journeys.test.mts and
commerce-journeys-helpers.mts in its separate branch. Root may update PLANS.md,
work/records/M18-journey-checkpoint.md, append registrations/capability/inventory,
refresh assigned runtime/oracle pins, and update existing privacy surface
implementation/retention/erasure text and licensing source count. Preserve all
3,135 prior native test objects, 211 capabilities, 525 protected paths, 1,813
source members, 306 runtime pins, 612 oracle pins, 38 adapters and 262 tables.
Do not alter old tests/helpers/fixtures/expected results, action owners,
permissions, worker grant lists, runners, migrations or dependencies.

## Native evidence and supported fixture

Use fulfillmentFixture's actual resolution_case and gamma equal-price exchange.
Create original replacement preview/approval/receipt through the existing gateway,
attach exact refs, set the independent fulfillment source fault to after, dispatch
once, then reconstruct the coordinator/caller and reconcile the original ID.
Observe calls.replace === 1 and unchanged original case, preview, approval,
receipt and operation IDs. Existing verified email/webchat links and ownership
handoff demonstrate local manual continuation. No remote client is qualified.

Exactly 23 new native cases include the three permanent G03 IDs, authority,
normalization, scoped canonical refs, version/replay, native approval/source
checks, each of the six unresolved families, private projection, historical
integrity, subject lifecycle, holds, backup/restore and repeated merchant import.
Retained return-portability 15 + support-workflows 8 + merchant-portability 14
make exactly 60 in four whole files. Root runs unchanged tools/dev_tests.py;
retain every attempt. An isolated fault bypasses the cross-intent unresolved
guard and must make unchanged behavioral assertions fail (a cached label proposal
while an actual replacement is unknown is suitable). Never integrate the fault.
Two independent reviews bind the clean executed candidate. Formal M18-G99 and
real M15 remote/channel/target-host gates remain separately blocked.

## Preimplementation native-owner and projection clarification

Independent source review established that ReturnIntake.prepare owns the pending
request's exact preview binding; a separate gateway.prepare cannot create that
request. Therefore journey prepare explicitly excludes diagnostic.return.submit
(JOURNEY_ACTION_UNSUPPORTED). Pending intake is created/revised by the existing
ReturnIntake owner; attach retains its original immutable preview, and execute
may consume that exact preview through the unchanged gateway. Direct return_request
references are allowed only in submitted/native_unknown/native_created states;
awaiting_review returns JOURNEY_REFERENCE_MUTABLE because its digest can change
legitimately during native revision. Successful journey execute may append the
now-submitted canonical request reference. No native owner is altered.

Top context status is missing, active, forgotten, restored or unavailable.
Current active documents yield active. The projection also includes
retained_under_hold and configuration_current booleans. An intent has id, kind,
references, state, restricted and observations. Reference values are exact
{kind,id,digest}; observations are allowlisted {reference,state,native_id,
qualification}, never raw payloads or copied addresses. State is restricted,
unknown, handoff, available (current tracking), awaiting_approval (preview only),
recorded (request/receipt/approval provenance) or observed (known native effect).
Observation state retains the native effect stage; cart purchased is distinct
from an unpurchased committed cart. These states never assert financial settlement.

Unresolved rows contain family, id, state and handoff_required:true. Family is
generic, native_return, resolution, fulfillment, edit or cart. Native-return rows
may add request_id; edit rows use original edit id and edit_steps containing the
original operation_id, stage and state. Private-restricted readers see no refs,
observations or unresolved IDs; handoff_required still reflects hidden uncertainty.
Expected-version conflicts use JOURNEY_VERSION_CHANGED; request replay uses
JOURNEY_REQUEST_REPLAY. These clarifications precede new tests and runtime.

Current operation.read is additionally required for prepare, execute and
reconcile before returning a raw native preview/receipt/observation. Existing
native action.execute and operation.reconcile permissions still apply. The
customer role gains no new permission. Cart reconciliation is performed by a
staff caller with operation.read and operation.reconcile using the separately
supplied current customerProof in ShoppingCart.confirm, gated on canonical
unknown/committed state. Direct customer reconciliation remains ACCESS_DENIED.
The restricted context covers all nested observations and unresolved IDs as well
as references, preserving only an explicit handoff flag for hidden uncertainty.

Read-only continuity may use a fresh current customerProof while the original
case verification is expired. open/context/attach retain provenance without
replacing case.verification_hash. context.case_verification_current is the native
cases.verified outcome; false requires handoff. configuration_current separately
reports the native current configuration resume outcome. Native prepare/execute
still enforce their original case proof. Supplied proof must itself always be
current. Reconciliation remains an observation through its native owner.

PrivacyLifecycle.export adds journey_records, a subject-only array of
{id,case_id,resource_id,version,state,intents,retained_under_hold,subject_projection}.
Retired unheld records can be scrubbed before export. Redacted bodies clear
link_id, link_revision, configuration_digest and ownership_generation to NULL,
and intents to []; no historical approval, preview, operation or link is retained
there. The deterministic identifier uses journey_ plus forty hexadecimal digits.
