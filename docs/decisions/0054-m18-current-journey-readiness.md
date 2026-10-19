# ADR-0054: Current journey readiness and sequential M18 development

## Prior assignment and authority

The owner's 2026-10-19 instruction is to proceed working on goals for the next
milestone. Standing delegation authorizes bounded local development and review.
Continue M18 from saved checkpoint 86c1383b62134e68e82d6826e979997a3f32da83 in
recovery/M18-journeys, preserving recovery/M18-memory and every earlier ref.
M18's local-preparation clause permits this work; M07/M09/M15 and formal M18
acceptance remain open. Missing later source history is not reconstructed.

Root assigns G02 before implementation. After independent local review, record
the concrete G03/G04 contracts and proceed through supported local journey and
follow-up work. G05 may demonstrate local callers, while real independent
remote authorization and G99 connected/target-host qualification remain blocked.
Original goal packets, milestone objects and acceptance entries stay unchanged.

Root is the sole product executor. /root/m18_memory_tests independently authors
new tests before runtime implementation; /root/m18_authority_scope and
/root/m18_regression_scope remain nonauthor final reviewers. At most three
corrective review rounds apply.

## G02 contract fixed before implementation

Add JourneyReadiness(k, reads, options) in journey-readiness.mts. Options may
attach the current SupportDelivery, OrderEditWorkflow and ShoppingCart owners,
all for the same kernel. No injected boolean descriptor establishes readiness.
inspect(scope, input) accepts exactly case_id, link_id, expected_generation,
allocation_id, cart_id and sender_id. The last three are nullable identifiers.
Normalize input before reading properties. Require current case/support and
capability permissions, exact verified link/case/resource/customer association,
and the current ownership generation. Staff/agent callers must own that
generation; a customer may inspect their own currently verified case/link.

Return schema_version:1, case_id, resource_id, configuration_digest,
ownership_generation, channel, history, caller, actions, context_digest,
model_thread_required:false, execution_authorized:false and
production_qualified:false. History explicitly reports the selected link's
current completeness; missing history never means no prior reply.

The fixed actions are tracking.read, return.refund.form, return.exchange.form,
exchange.offers, order.edit.context, shopping.cart.context, followup.queue and
remote.continue. Every row reports action, stage, status, available, reason,
alternatives, evidence_digest, execution_authorized:false and
production_qualified:false. Status is available, disabled, needs_configuration,
unsupported, temporarily_unavailable or unverified. Available means only the
named local inspection/form/queue step; it never approves execution or confirms
eligibility of an unspecified item/amount. Rows include supported alternatives
as fixed actions or request_human_review/reverify_customer/refresh_source.

Use Capabilities.evaluate, current CaseConfigurations/ReturnIntake.form,
IntegrationReadiness, execution stops, SupportTracking, VariantExchanges.browse,
OrderEditWorkflow.status plus current edit settings/snapshot/source contract,
ShoppingCart.currentPreview/readCart, SupportConsent and actual delivery source,
sender and contact owners. A missing optional owner is needs_configuration.
Missing allocation/cart/workflow input is explicitly needs_configuration. An
unrecognized/integrity failure stays unavailable, never permissive fallback.
Different merchant policies produce different return outcome rows through their
published configuration, without merchant IDs or duplicated skills.

Recheck source freshness, current registry connection, pinned configuration,
permissions, sender/contact eligibility, stops and restore quarantine. A fresh
customer session does not silently replace the case's original verification;
expired case proof must report needs_configuration/reverification for form
steps. Preserve the narrower agent execution allowlist: these rows grant no
new built-in or external worker action. remote.continue always reports
unsupported/REMOTE_QUALIFICATION_MISSING in this recovered source. A stale
displayed readiness result is never accepted as input to a native action.

Readiness creates no quote, preview, workflow pin, approval, customer consent,
journey document, operation or delivery. Ordinary existing audit authorization
and session freshness bookkeeping are permitted. No new persistent privacy
surface, table, migration, transport, provider, registry or dependency is added.

## Allowed paths and preservation

Root may add packages/commerce/journey-readiness.mts,
packages/commerce/contracts/journey-readiness.v1.json, docs/JOURNEY-READINESS.md,
this ADR and work/records/M18-journey-checkpoint.md. Root may narrowly wire
SupportService.readiness and post action journey-readiness in support-service.mts.
Root may append actual progress to PLANS.md and append registrations/inventory,
privacy implementation pins, catalog oracle pins and licensing source count.
The new independent author owns only tests/development/journey-readiness.test.mts
and optional journey-readiness-helpers.mts in recovery/M18-readiness-tests.

Preserve all 3,115 previous native registration objects, 210 capabilities,
521 protected paths, 1,806 source members, 305 runtime pins, 608 oracle pins,
38 adapter objects, 262 tables and fifteen privacy surface IDs. Do not modify
Capabilities, native action/approval handlers, worker grant lists, authorization,
old tests/helpers/fixtures, runners, migrations or dependencies. Current hashes
for the assigned support-service path may be refreshed; no old oracle changes.

## Verification

Independent author supplies exactly 20 meaningful native tests including all
three permanent G02 cases, current role/proof/generation, profile differences,
all status classes, optional owners, source/sender/stop/quarantine changes,
scope and input integrity, absence of created effects and stale-display refusal
by the real existing action owner. Tests are committed and integrated before
runtime code. A separately committed isolated fault bypasses one decisive
current readiness check and must fail an unchanged behavioral test. Missing
modules, syntax failures and metadata mismatch do not count as feature proof.

Run new readiness 20 + retained commerce-capabilities 15 + integration-readiness
13 + support-delivery 9 = 57 native cases in four whole files under one 60-second
deadline using tools/dev_tests.py. Preserve every actual attempt and source
hashes. Root executes; reviewers inspect without imports/builds/tests/probes.
No full regression, live provider, deployment, push, release or publication.
Local integration requires two independent reviews of the exact clean candidate.
Save cumulative source and actual evidence in a verified recoverable checkpoint.

## Preimplementation native-boundary clarification

Read-only scope review found that support.read itself is denied by native restore
quarantine. Preserve that top-level RESTORE_WRITE_BLOCKED error. Outside
quarantine, recovery egress restrictions can be shown on the queue row without
bypassing the existing native guard. ReadContext hides its kernel; when a
delivery owner is attached, require its actual tracking.reads object to equal
the supplied reads object. Other native owners expose their kernel directly.
An unrelated ReadContext cannot use scopes from this kernel.

Independent test-author agreement fixes disabled/OUTCOME_DISABLED for a policy
that excludes a return outcome, disabled/ACCESS_DENIED for per-row permissions,
unverified/PROOF_MISSING_EXPIRED_OR_REVOKED for the current revoked draft proof,
and temporarily_unavailable/SENDER_UNAVAILABLE for revoked or expired senders.
Missing owners are EDIT_WORKFLOW_REQUIRED, SHOPPING_WORKFLOW_REQUIRED and
DELIVERY_WORKFLOW_REQUIRED; they remain needs_configuration. Form reads retain
CUSTOMER_VERIFICATION_REQUIRED for an expired or revoked original case proof.
Current customer contact changes also invalidate old customer inspections and
an obsolete stored email contact; no contact address is returned by readiness.
