# Grounded shopping, original-order additions and reviewed catalog growth

ADR-0038 assigns M09-G01, G02, G10 and G11 as part of the owner's whole-milestone
development request. This is a bounded local implementation. G02, G10 and G11
remain preparation for their connected goals; their original formal cases and
M07-G99 prerequisite are unperformed. No connected checkout, real model, customer
message, catalog publication or payment was authorized or observed.

## Current source and authority

`ShoppingCatalogFixtureSource` wraps the existing `OrderEditFixtureSource`. It
uses that source's identity, catalog and stock in the same separate SQLite store.
Additional source listing metadata records approved descriptions and terms.
Source catalog revisions are hashes of current native catalog facts plus listing
revision and metadata, so price, stock, description or terms changes invalidate a
stored preview. This creates no competing inventory owner or fulfillment system.

`ShoppingCart.recommend` verifies supplied model product and price claims against
the source. `propose` accepts variant IDs and quantities, derives exact prices,
tax, available stock and approved terms, and stores a scoped proposal. A new cart
ID cannot repair a conflicting or unknown old commitment. `currentPreview`
returns current facts and says whether a new proposal is required.

`confirm` requires the current authenticated customer for the same order and the
exact preview digest. It persists an unknown original operation before calling
the source; the source callback rechecks customer scope, current preview,
execution controls and recovery before its write. A response lost after commit
remains unknown until original operation lookup. Repeated confirmation never
resends an unknown effect. Native cart commitment is not checkout, purchase,
payment or stock reservation.

`readCart(scope, cart_id)` synchronously reads the original source cart. It returns
resource and subject IDs, active/purchased status, revision, updated time, native
order identity when observed, and commitment state. A draft has no native cart
identity and `committed:false`; recovery must require a committed active cart.
`fixturePurchase` is trusted synthetic source administration, never an exposed
checkout action. It supplies a separate purchase observation for final recovery
checks without letting a stale marketing cache declare a cart abandoned.

The repository-native `catalog-shopping` instruction bundle is versioned through
its existing manifest and resource hashes. Its claims and settings grant no
permission. It remains portable guidance for the service boundaries rather than
a new model runtime, credential channel or execution scheduler.

## Pre-fulfillment additions

`PreFulfillmentUpsells.offer` prepares an `add` quote in the original order-edit
core using a qualified current catalog variant, quantity and existing warehouse.
The addition uses the retained item window and stock buffer. It refuses picking
or shipped lines, subscriptions, unqualified tax changes, unavailable stock and
unsupported financial state. The original order's existing fulfillment row is
updated with one deterministic new line. It creates no new order or fulfillment.

An authenticated customer confirms the exact offer, total, item, quantity,
source order revision and approved terms. Both the canonical confirmation and a
separate native consent record bind the original edit identity. Creating an
unlabelled `add` quote through the old order-edit methods does not bypass the
confirmation guard. Current customer proof and terms are checked before native
commit, including inside the original source transaction.

The existing independent ActionGateway approval is still required. The existing
OrderEdits dispatcher owns named edit/payment holds, source calculation/commit,
one invoice, original-operation reconciliation, settlement observation, warehouse
acknowledgment and release of only owned holds. Repeated customer acceptance
returns the original confirmation, including after an invoice response is lost.
Unpaid, failed, partial or uncertain payment cannot release fulfillment. Source
commit, settled payment, acknowledged fulfillment, hold release and shipment
remain different stages.

The addition path also retains existing return-prevention confirmation fences.
An order already enrolled in that separate workflow cannot use this service to
bypass its customer approval; the two workflows are not automatically composed.
After native commit, the original consent identity remains an audit fact while
merchant dispatch/recovery controls govern completion of that already committed
workflow. The service does not provide an arbitrary revoke or undo of goods.

## Visibility and reviewed catalog edits

`CatalogVisibility.evaluate` reads an immutable observation from the permitted
fixture source and retains prompt, catalog, provider/model/settings and original
observation digests. It counts observed answers, mentions, citations, correct and
incorrect claims, and unsupported questions separately. Citation records retain
their claimed source version and whether that version matches the captured
catalog. Prohibited scraping, unavailable interfaces and unobserved generated
answers remain unsupported and contribute no observed mentions or citations.

Evaluation IDs are immutable. Repeating evaluation after catalog or model change
creates a new ID while retaining the original baseline and comparable prompt
identity. Descriptive comparisons do not promise future AI placement, causal
lift, real-model coverage or an observed customer purchase.

`ReviewedCatalogChanges.propose` creates a diff for the supported description
field. The description must be one of the current source-approved factual texts.
Prices, inventory, currency, new certifications and other unsupported facts are
rejected. Model origin never authorizes publication. A different current
owner/reviewer approves the exact command digest, source revision and expiry.

`dispatch` rechecks current authorizing actor permissions, reviewer membership
and authority revision, scoped resource, expiry, revocation, execution controls,
recovery and exact source revision. Those checks run again inside the source
callback after unknown state has been persisted. Applied and unknown operations
are never resent. `reconcile` only reads the original native effect and retains
the original before/after revision and native identity.

`rollback` checks that the exact applied source revision is still current, then
creates a new proposal requiring a new independent approval. Any subsequent
native update produces a conflict instead of an overwrite. Rollback is not an
automatic consequence of an evaluation score or privacy erasure.

## Storage and privacy integration

Migration `036_growth_shopping.sql` adds exactly six canonical tables. Every table
has explicit `tenant_id`, `store_id`, `resource_id` and `customer_id` columns and
integrity-checked body/digest. Shared privacy integration belongs to the root
integration candidate; this author branch alone does not claim that integration.

| Table | Contents | Canonical erasure / recovery treatment |
| --- | --- | --- |
| commerce_shopping_carts | Source-bound cart preview and original operation receipt | Drop product/terms/customer copies; retain cart, operation, source and native IDs and original effect state; no replay authority. |
| commerce_upsell_offers | Original edit quote and approved terms binding | Drop terms and offer text; retain original offer/quote IDs and quote digest. |
| commerce_upsell_confirmations | Explicit customer proof and original edit binding | Revoke; remove session hash and personal/source snapshot fields; retain offer/quote/edit IDs and source identity for audit. |
| commerce_catalog_evaluations | Scoped prompt/model/catalog observations and result history | Drop prompts, model settings, claims and citations; retain observation/version digests and nonpersonal counters when required. |
| commerce_catalog_changes | Exact proposed command, before state and native receipt | Drop descriptions and personal source copies; retain original operation/source/native IDs, effect state and revision digests. |
| commerce_catalog_approvals | Independent current reviewer approval | Revoke on erasure and restoration; minimize actor and approval body; never restore as replay authority. |

The source database separately contains `growth_source_listings`,
`growth_source_carts`, `growth_source_cart_effects`,
`growth_source_catalog_effects`, `growth_source_visibility` and
`edit_source_upsell_consents`, alongside original native order/customer records.
Canonical erasure does not erase this separate source or caller-held values.
Operators must clean those named copies using the source's own retention and
audit rules; published merchant catalog descriptions require reviewed source
handling rather than blind rollback. Source evaluation prompts and references
are bounded but may still contain private data and therefore require cleanup.

Restoration keeps unknown effect IDs fenced and revokes customer/reviewer
approval. Canonical resource privacy guards block further writes on an erased
journey. Original native effects are never recreated as repair. The prior
post-erasure inventory reconciliation limitation remains unchanged.

## Focused verification handoff

The author committed behavioral specifications before implementation and ran no
product tests or demos. The root integrated candidate is responsible for one
15-case whole-file run within the retained four-file/60-case/60-second budget,
with native results and independent authority/security and regression review.

| Goal | Permanent selected cases | Deliberate changed-source fault |
| --- | --- | --- |
| G01 | CASE-M09-G01-01/02/03 plus M09-G01-CART-UNKNOWN-SCOPE-AND-CURRENT-PURCHASE | A copied ShoppingCart module trusts invented model IDs/prices; the fixed source-missing oracle rejects it. |
| G02 | M09-G02-PREP-01/02/03 plus M09-G02-CURRENT-CUSTOMER-AUTHORITY-AND-STOCK | A copied upsell module creates a second actual native fulfillment on repeat acceptance; the independent one-fulfillment assertion fails. |
| G10 | M09-G10-PREP-01/02/03 | A copied visibility module guarantees future placement for an unobserved answer; the fixed false-guarantee assertion fails. |
| G11 | M09-G11-PREP-01/02/03 plus M09-G11-CURRENT-AUTHORITY-UNKNOWN-STOP-AND-RESTORE | A copied catalog change module bypasses missing merchant approval and changes the native description; the unchanged-source oracle rejects it. |

`growth-shopping-helpers.mts` exports `shoppingFixture` and
`populateShoppingPrivacy` to populate all six canonical tables through their real
services. Its `installShoppingCart(existingFixture)` attaches an actual source
cart to an existing support fixture without creating another kernel. These
helpers are fixtures, not production administration or qualification evidence.

Default constructors have no source. No provider account, egress capability,
public HTTP route, target-stack claim, release tag or production action is added.
The existing installer, original action gateway and owned source connectors
remain the interfaces for separately authorized future adoption.
