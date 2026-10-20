# ADR-0062: Assign the local drop-off eligibility foundation

## Prior assignment and authority

The owner renewed the instruction to proceed with the next goals toward the next
milestones, retaining minimum useful test execution. From reviewed M19 closure
90433e2ec1bf092ea25e3c2906f42c904c208233, the delegated maintainer assigns bounded
local M20-G01. M20 is qualified QR drop-off; M19 is not its dependency. M07, M08
and M10 formal acceptance and actual partner/physical qualification remain absent.
This assignment authorizes synthetic local preparation only. It does not accept
the canonical goal, change its dependencies, or qualify a provider or network.

Root is sole runtime writer and executor in Rifare-M20 on
goal/M20-dropoff-foundation. A separate independent author owns only the three
new test artifacts on test/M20-dropoff-eligibility. Authority/privacy and
regression reviewers are nonauthors and do not execute product/tests. Freeze
independent tests before runtime changes. Keep protected main, the acceptance
ledger, original goals, old test expectations, core schema, permissions and
worker grants unchanged. No external provider, production, paid effect, message,
deployment, release or publication is assigned.

Root may add packages/adapters/dropoff-fixture-source.mts,
packages/commerce/dropoff-choices.mts and contracts/dropoff-choices.v1.json under
packages/commerce/. Narrow existing runtime edits are limited to additive native
item projection in packages/adapters/return-destination-fixture-source.mts and
packages/commerce/qualified-return-destinations.mts, and one optional owner/route
in packages/commerce/support-service.mts. Existing native destination selection,
admission, label purchase, partner readiness, reverse hubs, custody, warehouse,
privacy and financial owners retain their behavior. Root owns this ADR,
docs/DROPOFF-ELIGIBILITY.md, PLANS.md, work/records/M20-dropoff-milestone.md and
necessary additive inventories/catalog declarations and exact runtime/oracle pins.
All 15 privacy surface IDs and the 262-table core schema remain unchanged.

## Native source and customer-free declarations

Export DropoffFixtureSource from the new adapter. Constructor:

    new DropoffFixtureSource({fulfillment, partner, warehouse})

Require actual FulfillmentFixtureSource, PartnerFixtureSource and
WarehouseFixtureSource instances in the same tenant/store. Their handles and
durable identities are stable and must be checked again before configuration
and observation. Reject every core-backed source and physical alias among source
databases before creating storage; attachment also rejects aliases of the core.
Use existing physical database separation checks, including device/inode aliases,
in both directions where their fixture-only check is one-sided. Do not loosen an
existing helper or change native source constructors for this increment.

The wrapper uses the separate partner database and only one customer-free table,
fixture_dropoff_configuration, holding the latest hashed configuration. Its
identity binds contract rifare-dropoff-fixture-v1, tenant/store and the exact
fulfillment, partner and warehouse native identities. Freeze the wrapper and
retain stable parent handles; readonly TypeScript declarations alone do not
establish runtime identity. Public fields are fulfillment, partner, warehouse,
db, tenant, store, identity and contract. Use the fulfillment source clock.

configure accepts exactly:

    {revision, observed_at, expires_at, partner_config_digest, combinations}

Revision is the next positive safe integer. The observed time is not future,
expires_at is future and after observed_at, and the lifetime and current age are
at most 300000 milliseconds. partner_config_digest must equal the current native
reverse_hub configuration digest at publication. The envelope includes its
native account_id, scope, parent identities, contract, schema_version=1 and
qualification=synthetic_only. No customer, request, contact, proof or credential
field is accepted. observe returns the strict hashed envelope, or null before
configuration. Missing data is distinct from malformed/corrupt/foreign data.

combinations contains one to 20 unique explicit site/destination/method triples.
Each combination has exactly:

    {site_id, destination_id, method_id, item_ids, category_ids,
     packaging, label_required, credential_kind, instructions_ref,
     accessible_alternative, availability}

The item/category allowlists each contain one to 20 unique native IDs. They
restrict that explicit combination; independent lists cannot create undeclared
site/method cross-products. packaging is box_required or provider_packaging;
label_required is boolean; credential_kind is qr or code. instructions_ref is
a bounded native ID, not executable text or a secret. accessible_alternative is
printed_code or staff_assisted_code. These are explicit synthetic terms, not a
claim of qualified customer accessibility or universal box/label-free handling.

availability is null, or exactly {state, observed_at, expires_at}. State is
available or unavailable. Its timestamps are safe nonnegative integers, observation
is no later than publication, expiry is later than observation and no later than
configuration expiry, and its lifetime is at most 300000 milliseconds. Publishing
already-expired availability is allowed so a missing current observation can be
represented honestly. Reads never renew observation or expiry timestamps.

Changing native partner configuration does not silently update an old declaration.
The quote marks its methods unverified until a new declaration pins the current
configuration. Native readiness must also be reviewed for that current digest.
Every current site, category, destination policy and capability is independently
rechecked; the wrapper is not an alternate qualification ledger.

## Additive native per-item projection

Add ReturnDestinationFixtureSource.evaluateItems(requestId). It reads the actual
original request and invokes the existing native decision predicate for each
original line, preserving its exact quantity. It also retains the existing
whole-request evaluation and aggregate-capacity result. Per-line decisions may
contain only destination_id, eligible and reasons, while complete destination
terms/capacity remain in the whole-request result. Never create or rewrite a
source request to compute a subset. Preserve evaluate/select/assertSelection/
assertCommand/admit and their original outputs.

Add QualifiedReturnDestinations.evaluateItems(scope,{request_id}). Reuse its
current case/request/native-return/source-order binding, source configuration,
policy and action.propose checks. Return the existing evaluation fields plus
source_request_digest, qualification_digest, a bounded expires_at, source_items
(line_id, fulfillment_line_id, item_id, category, quantity, required_handling),
region, disposition and per-item evaluations. Do not expose customer/session
data in the new projection. Source items are the already-bound original items,
not caller-supplied category, region or product claims. G01 supports at most
20 selected lines and 64 current destinations; reject larger views rather than
silently truncating them. The canonical 131072-byte output bound still applies.

## Scoped transient choices

Export DropoffChoices(k,{destinations,hubs,source}). Require actual same-kernel
QualifiedReturnDestinations and ReverseHubs instances, the exact matching
fulfillment/partner/warehouse source handles, and the actual DropoffFixtureSource.
Recheck parent identity and database separation on each observation. No constructor
performs routing, destination selection, readiness configuration or source effects.

quote(scope,{request_id}) is a read-only local operator projection. Resolve the
request's canonical case/resource internally. Require an actual human owner,
operator or reviewer (workerIdentity must be null), current support ownership,
support.read, action.propose and native return/resource permissions. Reuse
CaseConfigurations.resume/verified and fulfillmentContext active lifecycle
checks. Require the existing order observation to be nonfuture and within the
case's max data age. Recovery egress quarantine, resource erasure/suppression,
inactive installation, revoked proof and ownership changes deny a fresh quote.
Do not refresh the customer session or verification record.

Use the native per-item view, current reverse_hub configuration and
PartnerReadiness.inspect with capability route and the native request region.
No caller category, region, customer or alternate resource is accepted. Require
each explicit site to exist in current partner terms and match the attached
warehouse identity. Item eligibility requires current native partner category,
native destination eligibility and the explicit combination item/category lists.
The whole selected item set separately requires the native aggregate decision;
per-item eligibility cannot overcome aggregate capacity or another excluded item.

Availability is eligible only with a current available observation. Missing,
expired or future availability/configuration is unverified. Known exclusions,
disabled sites, current unavailable observations, revoked readiness or outage
remove eligibility and report reasons. Known exclusion takes precedence over
missing evidence. Integrity/schema/scope failures throw; they are never caught
as an ordinary unavailable site. A missing current partner configuration is
unverified. Missing readiness remains noneligible with its native reasons.

Return schema_version=1, request_id, case_id, items, methods, choices,
state, source_digest, directory_revision/digest, observed_at, expires_at and
fallback=merchant_review_without_dropoff_promise. items identifies original
line/item/category/quantity. methods contains every declared explicit combination,
with choice_id=contentDigest([site_id,destination_id,method_id]), native references,
packaging/label/credential/instruction/alternative terms, per-item results,
whole-set state/reasons and eligible boolean. State values for a method or item
are eligible, unavailable and unverified. choices contains only whole-set eligible
methods. Top state is eligible_choices when choices exist, otherwise unverified
when any method is unverified (or the directory is missing), otherwise needs_review.

Each method's fees keeps partner_fee {amount_minor,currency,basis:per_handoff}
and destination_handling_estimate {amount_minor,currency,basis:per_handoff}
separate. The latter remains an estimate. total_minor is null and charged=false;
the amounts may overlap and are not summed, multiplied by item rows, converted
or treated as collected fees. Native source terms determine amounts/currencies.

The response always carries qualification=synthetic_only, external_qualified=false,
physical_handoff_qualified=false, credential_issued=false, execution_authorized=false,
capacity_reserved=false and financial_effect=false. It contains no customer ID,
proof/session hash, raw contact, usable credential or copied source envelope.
The source digest pins the observed native bindings, terms and readiness. Expiry
cannot outlive the contributing proof/configuration/availability/readiness terms.
Re-read participating native views and authority before return and reject changed
digests or ownership; do not mix versions into a seemingly current quote.

No quote, route, selection, approval, credential, custody, stock, allocation,
capacity reservation, experiment, send or financial record is written. A later
G02 assignment must persist its own approved original terms and revalidate them
at actual issuance; this read does not implement or imply that boundary.

SupportService may accept optional dropoffChoices, requiring the actual native
same-kernel owner, and expose only post(scope,'dropoff-choices',input). Missing
configuration throws DROPOFF_NOT_CONFIGURED. No source administration, credential
or new HTTP server route is assigned. Existing routes/options remain unchanged.

## Independent tests and minimum useful execution

The independent author owns only tests/development/dropoff-eligibility.test.mts,
tests/development/dropoff-eligibility-helpers.mts and
tests/fixtures/dropoff-eligibility/independent-values.json. Preserve all old
helpers and oracles. Build an exact two-item request through native intake and
native return services before binding; do not trim a committed three-item fixture.
Use the same kernel for partner, destination and warehouse owners, physically
separate sources and actual independent PartnerReadiness approval. The original
helper's US_TEST/apparel defaults must not substitute for the native item's
actual region/category. The independent literal oracle must declare exact
expected methods, packaging, fees and per-item/whole-set distinctions.

Use CASE-M20-G01-01 through -12, including all three permanent cases. Cover:
positive mixed-item discovery and no effects; partner/site/category revocation;
the named cached-category fault and missing availability; expiry/future evidence;
exact item/account/request bindings; ownership/proof/tenant/resource/worker
boundaries; region/item/handling/capacity exclusions; configuration/schema/bounds;
source identity/digest/physical aliases with pre-DDL rejection; a changed source
or readiness during observation; independent native owner/optional dispatcher;
and privacy/quarantine/no personal persistence. Keep positive controls otherwise
valid so each denial proves its intended boundary.

One final native batch selects the 12 new cases and the unchanged 21-case
qualified-destinations.test.mts: 33 cases, two whole files, 60-second deadline,
NODE_OPTIONS=--test-isolation=none. No existing partner runtime changes are
assigned, so its unchanged 22-case suite is not rerun by default. Additional
execution requires a concrete failure or material changed candidate.

After the final product passes, one isolated exact-parent fault caches the
destination view after a valid quotation and continues offering a method after
current accepted-category revocation. Run only the unchanged new file, retain
actual behavioral failures and the patch, and never merge that fault. No broad
suite, supplementary product probes or product restore campaign is assigned.
Static inventory/pin comparison, independent review and recovery-archive checks
do not add product testing or acceptance credit.

## Continuation and qualification

G02 requires its own credential-secret, final approval, unknown outcome,
replacement, privacy and restore protocol before independent tests or runtime.
G03/G04 reuse native custody/receiving owners. G05/G99 retain actual partner,
physical handoff, device/accessibility, target-host, financial-trigger and full
milestone obligations. M19's unresolved provider award/reversal and other
qualification limits remain recorded separately and are not closed by this work.
