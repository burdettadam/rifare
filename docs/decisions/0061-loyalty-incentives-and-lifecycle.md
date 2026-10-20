# ADR-0061: Assign focused local loyalty incentives and lifecycle reporting

## Prior authority and ownership

The owner renewed the instruction on 2026-10-20 to keep tests to a minimum in
favor of progress and proceed with the next goals. From reviewed G03 closure
e9421d990489fdcdce5fbe080a3a1733669b797e, root assigns bounded local M19-G04 and
M19-G05 together. Root remains sole runtime writer and executor on
goal/M19-loyalty-milestone. The independent author owns only the three new test
artifacts on test/M19-loyalty-incentives-lifecycle in its own worktree. Independent
authority/privacy and regression reviewers remain nonauthors and do not execute.
Freeze independent tests before runtime edits. Native Git retains each checkpoint.

The accepted ledger still contains four M00 entries; formal dependency acceptance
is absent. This assignment permits local synthetic preparation, not formal M19
acceptance, merchant/provider qualification, production, release, deployment,
remote publication, paid effects or connected messaging. Keep main, the acceptance
ledger, planning baseline, old tests/oracles, schema, permission catalogs and
worker grants unchanged. G03 and existing financial owners keep their boundaries.

Root may add packages/adapters/loyalty-incentive-fixture-source.mts,
packages/commerce/loyalty-incentives.mts and loyalty-lifecycle.mts, and versioned
contracts loyalty-incentives.v1.json and loyalty-lifecycle.v1.json. Narrow runtime
integration is limited to growth-campaigns.mts, cart-recovery.mts and
support-service.mts. Existing delivery, consent, privacy, shopping, G01/G02/G03,
exception and economic implementations are reused unchanged. Root owns this ADR,
docs/LOYALTY-INCENTIVES-LIFECYCLE.md, docs/M19-LOCAL-ASSESSMENT.md, PLANS.md,
work/records/M19-loyalty-milestone.md, and necessary additive source/test/capability
inventories, catalog declarations and runtime/oracle hash pins. Keep all existing
privacy surface IDs and the 262-table core schema. New source configuration uses
only its separate synthetic marketing database and contains no customer data.

The independent author owns tests/development/loyalty-incentives-lifecycle.test.mts,
tests/development/loyalty-incentives-lifecycle-helpers.mts, and
tests/fixtures/loyalty-incentives-lifecycle/independent-values.json. Do not edit
existing helpers. Use CASE-M19-G04-01 through -06 and CASE-M19-G05-01 through -08:
14 cases, including all three G04 and all four G05 permanent IDs.

One coherent final batch selects those 14 cases plus the unchanged 24-case
growth-marketing.test.mts: 38 cases, two whole files, one 60-second deadline.
Use the installed native runner with NODE_OPTIONS=--test-isolation=none. Further
runs address an actual failure or material changed candidate; do not run broad
regression, repeat old loyalty batches or a restoration test campaign. Preserve
one isolated compact targeted-fault run for the two new goal behaviors, unchanged
independent expectations, exact source evidence and both nonauthor decisions.

## Native applicability source

Export LoyaltyIncentiveFixtureSource from the new adapter. Constructor:

    new LoyaltyIncentiveFixtureSource({marketing, shopping, redemption})

Require the actual MarketingFixtureSource, ShoppingCatalogFixtureSource and
LoyaltyRedemptionFixtureSource instances, same tenant/store, stable native handles
and durable identities. Their source databases must be physically distinct from
each other and from the core. The marketing source owns the new customer-free
fixture configuration table. Public readonly fields are marketing, shopping,
redemption, db, tenant, store, account, identity and contract. Freeze the wrapper;
validate native durable identities and handles again on configure/observe.

configure accepts exactly {revision, expires_at, combinations}. Revision is a
strictly increasing safe integer and expires_at must be future. combinations is
one to 100 unique explicit {benefit_id, offer_id, eligible_variant_ids} records.
Each pair is unique and each variant list contains one to 30 distinct native IDs.
Every cart item must be in that pair's declared list. Independent offer/benefit
allowlists do not authorize undeclared cross-products. No inferred eligibility,
new discount arithmetic, enrollment, conversion or prospective earning rule.

observe returns a strict hashed envelope with schema_version=1, tenant_id,
store_id, account_id, source_identity, marketing_source_identity,
shopping_source_identity, redemption_source_identity, loyalty_account_id,
balance_source_identity, revision, expires_at, combinations and digest. Current
native cart/offer/loyalty facts are independently pinned in the comparison.
This source is a declaration of synthetic applicability, not a live entitlement.

## G04 quotation and mandatory final-send validation

Export LoyaltyIncentives(k,{redemptions,carts,campaigns,recovery,source}). Require
the actual same-kernel native owners, exact source handles, carts/recovery/campaign
relationships and all source identities. Constructor attaches the native owner
to recovery; a second different owner cannot replace it. No duck-typed substitute
or foreign kernel/source can supply this authority.

quote(scope, customerProof, input) accepts exactly {case_id, link_id,
expected_generation, cart_id, campaign_id, benefit_id}. It requires an actual
human owner/operator/reviewer, current action.propose and support ownership,
verified current customer proof, exact case/cart/customer/campaign linkage,
current native committed active cart and unchanged proposal, current approved
discount, explicit applicability and marketing consent.

It reuses G03.context and creates one ordinary durable G03 quote for the selected
native benefit's exact point cost. That is a terms record only. It creates no
approval, reservation, redemption, enrollment, experiment assignment, campaign
schedule or message. The existing G03 quote/privacy lifecycle remains canonical.
The entire comparison is transactional: failed comparison leaves no new quote.

The comparison result has exactly {quote,digest,execution_authorized,
enrollment_authorized,send_authorized,monetary_conversion_supported,
production_qualified}; all five flags are false and digest=contentDigest(quote).
quote contains schema_version, case_id, resource_id, cart_id, campaign_id,
loyalty_quote_id, loyalty_quote_digest, points={unit:'points',quantity:N}, benefit
(the unchanged native benefit), discount={offer_id,text,currency,discount_minor,
catalog_ref}, eligible_items (the unchanged native cart preview items),
cart_total_minor, cart_currency, cart_digest, campaign_digest, consent_stamp,
applicability_digest, source_references, created_at, expires_at,
prospective_earning_supported=false and qualification='synthetic_only'.
source_references contains loyalty_source_identity, snapshot_digest,
rules_digest, benefits_digest, shopping_source_identity, marketing_source_identity,
marketing_facts_digest and applicability_source_identity. Do not put raw tokens,
session/proof hashes or customer data beyond existing case/resource/item context
in this comparison. Available/held quantities are not immutable offer claims.

The quote expiry is the minimum of the original fixed G03 expiry, campaign end,
approval expiry, source offer expiry and applicability expiry. G03's maximum
10-second quote lifetime remains unchanged. Revalidation never renews proof,
last_seen, quote, campaign or approval lifetime. Quoted wording and items come
from native sources; input cannot override wording or economic terms.

validate(scope, comparison) reconstructs the exact current comparison using the
original stored G03 quote and loyaltyGatewayQuote. It returns
{valid:true,digest,expires_at,execution_authorized:false,send_authorized:false}
only when all terms match. Otherwise it throws the specific native control error
or LOYALTY_INCENTIVE_CHANGED. Consumed/minimized/revoked/expired G03 quotes fail,
even after terminal redemption. Current effective capacity must still suffice.

bind(scope,{recovery_id,quote}) takes that full comparison envelope, revalidates
it, requires current human action.propose/ownership and exact recovery context,
and stores {quote,digest} as body.loyalty_incentive in the existing recovery row.
The recovery must remain proposed. It cannot be attached after that recipient's
message operation exists. Exact replay is harmless; a different binding fails
LOYALTY_INCENTIVE_BINDING_IMMUTABLE. It returns
{recovery_id,quote_digest,bound:true,execution_authorized:false,send_authorized:false}.
The fixed binding is an explicit local availability limit: it is not silently
refreshed or replaced after expiry. No new personal table or history is created.

GrowthCampaigns.approvedOffer(scope,campaignId,caseId) factors the current source,
approval, scheduled-state and exact recipient checks already used by render.
It returns campaign_id, campaign_digest, case_id, resource_id, sender_id,
offer_id, offer (unchanged copy.offer), source_identity, source_facts_digest,
starts_at, ends_at, approval_expires_at, offer_expires_at and recovery_after_ms.
This read never calls render or assigns experiment membership. render retains
the same old output and behavior for ordinary campaigns.

CartRecovery.attachIncentives accepts only its actual native G04 owner.
CartRecovery.final requires it whenever body.loyalty_incentive is present, then
calls its final(scope,recoveryId). This method reads the persisted binding,
revalidates it and returns {digest}. The recovery's existing digest already binds
the comparison; GrowthCampaigns.render includes that digest in its source basis.
SupportDelivery's unchanged final authorization compares the queued source digest
and preserves its own consent, contact, sender, owner, control and source checks.
Missing configuration must fail LOYALTY_INCENTIVES_NOT_CONFIGURED, never send an
unvalidated marked offer. A changed balance, purchase, consent, native terms or
original proof invalidates/suppresses the actual queued offer before source.send.

Do not weaken G03 human checks or reconstruct human authority for workers.
Loyalty-bound campaign dispatch is human-only in this local increment. Ordinary
campaign workers retain their existing behavior. Privacy export/erasure/hold,
uninstall and restore use the existing G03 quote and marketing recovery owners:
minimization removes the binding, restore cancels recoveries and revokes quotes,
and current suppression prevents old copied context returning. Provider-side
data, caller-held copies and old archives remain separate retention boundaries.

## G05 transient lifecycle reporting

Export LoyaltyLifecycle(k,{accrual,redemptions,incentives,campaigns,measurement?}).
Require actual same-kernel native owners with the exact shared balances,
redemptions, campaigns and marketing source; optional measurement must be the
native GrowthMeasurement with the same marketing source. No current report cache
or persisted customer projection is created.

report(scope,customerProof,{case_id,link_id,expected_generation,campaign_id,
experiment_id}) requires actual human support.analytics, support/resource access
and native current proof/ownership. campaign_id and experiment_id may be null.
Non-null experiment requires a non-null campaign, its exact declared experiment,
the current case's native recipient/assignment and the configured measurement
owner. Missing owner throws LOYALTY_MEASUREMENT_NOT_CONFIGURED; mismatched linkage
throws LOYALTY_LIFECYCLE_SCOPE_MISMATCH. Neither absence nor error means zero cost.

Output fields include schema_version, case_id, resource_id, status, reconciled,
account, projection, redemptions, exceptions, economics, recovery, exception_queue,
source_effects_dispatched=0, execution_authorized=false, production_qualified=false
and report_digest. The digest covers all other output fields.

- account contains scope='provider_account', source_identity, snapshot_digest,
  balances (the current G01 account totals), rules_revision and G03 capacity's
  provider_available_points, held_points, accounted_held_points and
  effective_available_points.
- projection is the unchanged native G02 original-order projection. Targets and
  original financial/unit IDs remain proposals, never attributed provider issues.
- redemptions contains scope='resource_operations', operations and
  observed_redeemed_points. Each operation includes the unchanged G03 read
  projection plus source_observation, the exact validated original-ID journal
  result or null. Read only strict records for this original resource/account;
  use the existing 1000-record bound. Do not interpret a truncated queue as a
  complete ledger. Actual source bookings can coexist with core unknown state.
- exceptions contains {code,operation_id} records. Always expose
  LOYALTY_AWARD_EVIDENCE_MISSING and LOYALTY_REVERSAL_EVIDENCE_MISSING in this
  source protocol; operation_id is null. Preserve a non-ready G02 reason and
  reserved/unknown operation reasons without inventing retryable operations.
  status is needs_reconciliation and reconciled=false while these gaps remain.
- economics contains proposed_earned_points, proposed_reversal_points and
  proposed_net_points from G02 or null; attributed_issued_points=null,
  attributed_reversed_points=null, observed_redeemed_points,
  expected_monetary_liability_minor=null, actual_reward_cost_minor=null,
  loyalty_inclusive_net_margin_minor=null, currency=null, and
  basis='separate_point_targets_observed_redemptions_and_unvalued_costs'.
- recovery is {campaign,measurement}; null means unrequested/unconfigured.
  campaign is the unchanged native campaign summary and measurement the unchanged
  native GrowthMeasurement report. Match exact recipient, assignment and declared
  experiment before composition. Preserve all denominators, coverage, attribution,
  actual-versus-estimated cost and qualification fields; no recomputation.
- exception_queue is the existing queue result with items filtered to these
  operation IDs; retain its scan_limit/truncated flags. Unknown correction remains
  the existing original-ID ExceptionQueue.reconcile route. Report never calls it.

Never subtract original-order targets from account totals or account debits to
claim purchase reconciliation. A settled refund is financial evidence only;
missing provider reversal/award identity survives. Do not publish fresh G01
snapshots to bypass G03's anchored history. No instrument conversion, debt,
monetary valuation or loyalty-inclusive profitability is established.

retained(scope,{operation_ids}) accepts one to 100 distinct native IDs. Require
actual human support.analytics and privacy.manage plus every original G03
read/retained permission. Return only {schema_version:1,mode:'retained_operations',
operations,status:'limited_retained_evidence',reconciled:false,account:null,
projection:null,recovery:null,source_effects_dispatched:0,execution_authorized:false,
production_qualified:false}. operations are unchanged minimized G03 projections;
no current G01/G02/source/customer lookup. This does not bypass inactive stores,
recovery quarantine or original-resource authorization. It does not reconcile.

SupportService gets optional native loyaltyIncentives and loyaltyLifecycle owners
and actions loyalty-incentive-quote, loyalty-incentive-bind,
loyalty-incentive-validate, loyalty-lifecycle-report and loyalty-lifecycle-retained.
Quote/report use the existing {customer_token,input} wrapper; the other actions
pass their strict native input directly. No implicit source configuration/grants.

## Independent literal oracles and closure

G04: basic quantity1 cart USD2000 minor, approved offer-five USD500 minor,
native synthetic reward400 points, available600 before its explicit redemption
and200 after. No monetary reward value or prospective earning claim.
G05: original paid USD3000 minor, two lines/three units, one settled alpha refund
USD1000 minor gives proposed300 earned/100 reversal/200 net. This is independent
of account earned1000/pending900/reserved150/redeemed200/reversed50/available600.
Native redemption400 reduces account availability to200; it never proves that
this original purchase issued300 or reversed100.

Preserve tests for real final-send changes, no implicit effects, applicability,
immutable binding, actual human/proof authority, original financial evidence,
missing reversal, economic distinctions, privacy/restore and retained reads,
settlement stages, unknown original-ID continuity and read-only reporting. Every
authority negative starts with otherwise valid, fresh, unconsumed evidence.
The single compact fault campaign changes only new G04/G05 runtime predicates:
bypass mandatory loyalty final validation and falsely reconcile missing reversal
evidence after a successful refund. The unchanged permanent behavior cases must
fail through assertions, not import/setup errors. Preserve fault outside product
ancestry. No broad fault campaign or full regression follows automatically.

Close only this bounded local implementation after both independent reviews.
G99's local assessment will identify observed coverage and missing obligations;
it cannot accept unperformed provider, messaging, target-host or full-suite work.
