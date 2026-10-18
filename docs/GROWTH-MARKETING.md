# M09 marketing and measurement development

This is the bounded local implementation of M09-G03 through G09 under
[ADR-0038](decisions/0038-m09-growth-development.md). It uses invented source
records, the existing CommerceKernel authority boundary, the existing support
send boundary, and existing approved order cancellation. It does not establish
connected marketing-provider qualification, commercial lift, financial settlement,
or a production service. M07-G99 and the original formal prerequisites remain open.

## Stable assignments and explicit measurement

`CheckoutExperiments.configure` freezes a scoped cohort, eligibility, variants,
256-bit server-generated allocation seed, experiment identity/version and observation
windows. HMAC-SHA256 maps each tenant/store/customer to the weighted treatment or
holdout arm. The stored assignment is returned on every subsequent frontend render;
reordering the two variant definitions cannot change it. Existing experiment IDs
cannot be reconfigured. A new explicit experiment identity is required for a new
version or allocation; it is a new experiment, never a silent reassignment.

Eligibility must be present and typed in the canonical order observation.
Unknown or bot traffic is excluded at enrollment; current ineligibility also blocks
new exposures and campaign offers. An exposure is counted once per scoped shopper
and channel. Additional channel observations can reveal holdout contamination, but
the shopper remains in the originally assigned denominator. These randomized
checkout records are separate from the retained nonrandom PreventionExperiments
diagnostic and do not change its interpretation.

`GrowthMeasurement.importEvent` imports an existing immutable source event.
Purchases deduplicate by original native purchase ID across channels, and conflicting
resource/customer/amount/time identities fail closed. Refunds and costs are included
through the frozen followup end; repeated original observations do not multiply
money. Source coverage must explicitly certify each cost category with an amount; a missing/null cost is unknown, and the imported event sum must match that independent source total. Missing original purchases, incomplete source coverage and erased subjects
remain unresolved in the report. Each frozen subject counts at most once in the
incomplete-unit count, even with several missing conditions. USD integer minor units use the existing money
boundary. Scaling unequal holdout cohorts uses explicit half-even rounding and
retains the exact residue.

The report keeps attributed revenue, randomized holdout estimates, refunds,
contribution margin and uncertainty separate. Its conversion uncertainty is a
conservative difference of Wilson intervals. Monetary uncertainty is not estimated.
The small synthetic cohort is labeled, contaminated cohorts remain qualified as
contaminated, and no result can promote a winner automatically. The fixture's two
purchases total 20,000 minor units. One email-attributed purchase contributes 10,000,
while the holdout-adjusted incremental revenue is zero. A late 3,000 refund and
3,000 of costs leave 14,000 of combined contribution margin. The treatment group's
margin is lower than its equally sized holdout's by 4,000.

## Reviewed segments, templates and campaigns

`MarketingSegments` supports a deliberately bounded typed definition: country,
required tag, minimum source spend and explicit required fields. Missing fields
make the preview incomplete. A source record from another tenant/store is rejected,
not used to improve the count. A segment's independent approval binds its definition,
exact template keys and rendered digest, source facts, audience digest and count.
Template synchronization creates one native fixture template under the original
operation ID. A lost response leaves `unknown`; retries read that original state,
and reconciliation looks up that operation without another source sync. A new caller
operation ID or reviewed template revision cannot escape an unresolved original
sync for the same scoped segment. An identical confirmed sync also retains its
original operation identity.

`GrowthCampaigns.draft` produces editable structured copy choices from the declared
brand/catalog/offer facts. Arbitrary new price or offer text is unsupported. The
editable headline and body keys can select reviewed source copy; adding new copy or
terms requires changing the source facts and obtaining a new campaign review. This
bounded slice has no model integration. A model may propose an input, and receives
exactly the same validation as any caller.

Campaign approval is independent of the author and binds the exact draft revision,
content, offer, audience definition/digest, sender version, schedule, budget, unit
estimate, experiment identity and recovery predicate. Editing a draft revokes the
prior approval. A queued campaign cannot be rewritten into a new logical send;
create and review a new campaign deliberately. Merchant configuration bodies retain
aggregate counts/digests, with individual members in subject-scoped recipient rows.

Only the added `SupportDelivery.queueCampaign` path can queue a reviewed campaign.
It constructs content from the campaign reader, obtains the current verified contact,
and creates the existing canonical operation and target. It accepts no arbitrary
send payload, sender override or caller-supplied purpose. The existing final send
checks retain current consent and blanket suppression, contact revision, support
ownership, the original owner's current session/permissions, sender identity,
execution stops, recovery quarantine and original unknown operation semantics.
Campaign facts, approval, schedule, holdout and recovery are rechecked inside that
same final boundary.

The budget reserves the approved per-recipient estimate atomically with the logical
operation. Holds remain conservative after uncertain or suppressed sends; elapsed
time never frees budget for a duplicate operation. Summary fields distinguish
provider acceptance from observed delivery. The approved synthetic unit estimate
is reported as an estimate; an actual provider bill or settled cost is unavailable.
Callbacks and reconciliation retain the original message reference and version.

## Cart recovery and scanner-safe email

`CartRecovery` consumes the canonical `ShoppingCart.readCart` interface and requires
a committed active cart with the configured inactivity interval. It stores one
logical proposal per cart. The existing send boundary checks the current cart
source again immediately before sending, so an intervening purchase, resumed cart,
or consent withdrawal blocks the message. A proposal does not apply a discount.
The service is labeled an automated recovery proposal; it is not human staffing.

`emailActionHandler` is an executable Request/Response boundary. GET and HEAD return
a generic plain-email fallback without reading the token, consuming it, authenticating
a session, or changing any link/order/consent state. POST requires an existing
authenticated customer session, its current proof binding, an unexpired link scoped
to that same resource/customer, the exact current preview and `confirmed: true`.
A link token alone grants no authority.

This slice supports only an already independently approved canonical order
cancellation. Customer confirmation calls the existing OrderEdits dispatcher under
the original issuer's current restricted authority. Live link revocation/expiry and current customer proof are rechecked before every precommit stage; after a canonically confirmed commit, original completion retains the existing OrderEdits guards. It preserves that edit's native
operation IDs, approval, source revision, execution stops, fulfillment holds and
financial stages. Repetition returns the original state; an unknown source step
requires the existing operator lookup. Cancellation may have been observed while
its refund remains only provider accepted. Other link operations remain unsupported.
No served browser/production route or real delivery qualification is claimed.

## Storage, privacy, restore and cleanup

Migration `037_growth_marketing.sql` adds eleven explicitly scoped tables. Six hold
subject data: assignments, exposures, imported outcome observations, campaign
recipients, cart recoveries and email action links. The other five hold merchant
experiment/segment/campaign configuration, campaign approvals and original template
sync operations. Merchant configurations contain no copied member array.

`growth-marketing-privacy.mts` provides the canonical integration helpers used by
PrivacyLifecycle. Subject exports include only that subject's records and relevant
configurations. Experiment seed and email token/session hashes are omitted from the
export projection. Erasure always reconstructs a minimal allowlist, including when
an imported body already claims to be redacted. Assignment arm columns and immutable
denominators remain, while the subject becomes unavailable. Original source-event,
message, template, cart and cancellation identities remain where needed to prevent
replay; approval and consent never become replay authority.

Affected campaigns pause and their approvals revoke. Restore revokes segment and
campaign approvals, pauses schedules, cancels recovery proposals and revokes email
links; existing generic operation recovery guards still apply. This slice has no
automatic post-erasure repair or reactivation path. The earlier post-erasure inventory
limitation is unchanged. Separate marketing, sender and shopping fixture source
databases and caller-owned previews/token copies require separate cleanup. Deleting
the central copy does not claim to recall an accepted message or erase a provider.

## Evidence and rollback

The tests-first commit precedes implementation. The one selected file contains 24
actual native cases: three for each assigned goal, TEST-034, PORT-027, and the distinct
local M09-PREP-PORT-026. Connected G06/G07 preparation uses distinct PREP IDs and does
not register the original formal connected cases as completed. Every named unsafe
behavior executes a changed isolated module/source and reaches an independent
assertion. Mutation source is temporary; the canonical candidate is unchanged.

Authors executed zero product tests or demos. Root runs this complete file once as
part of the coherent 60-case/four-file/60-second development selection, binds native
reports to the exact candidate, and obtains independent authority/regression review.
The actual results are in the final checkpoint; this source guide does not preclaim
them. No broad regression, connected campaign, production effect or external message
was authorized. Roll back source using native Git while retaining the added data,
original unknown identities and quarantine; never delete a pending operation to retry
with a new ID. Formal goal acceptance remains a separate maintainer decision.
