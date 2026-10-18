# ADR-0039: All M10 goals in bounded local development

## Assignment and retained authority

The owner requested "Proceed with all goals for next milestone" after the reviewed
M09 growth checkpoint. The delegated maintainer assigns **M10-G01 through G14**
and the **M10-G99 assessment** from clean local main
`221556c379f2ca878e94c50d49eb6fc587680b04`, tree
`138b5b76f2254830060a9662af5a569bd8932e8d`. The retained cumulative artifact is
`Rifare-M09-growth-milestone.zip`, SHA256
`f26f42f75215c597eb868cce8c1fe8d1da3340fbb92260bb36c92999d1039b75`.

This is the whole next milestone's local development assignment. It does not
accept M07-G99 or manufacture the real contractual, processor, network, medical,
tax, coverage, customs, settlement or physical-service evidence required by the
original goals. G03/G04/G06/G13/G14 are connected preparation; G07 through G12
are external-qualification preparation. Their local cases use distinct PREP IDs.
G01/G02/G05 implement local controls, while formal prerequisites remain open.
G99 preserves the original integrated demonstration and remains blocked at its
formal scope. The acceptance ledger and original planning packets are unchanged.

Native local worktrees, source commits, bounded checks, independent review,
nonrelease integration and a cumulative recovery checkpoint are authorized.
Contacts, contracts, real customer/medical data, paid transactions, live provider
accounts, production, hosted publication, tags and release are outside this
assignment. No further milestone is assigned by this record.

## Ownership and concrete paths

Root owns the integration branch/worktree, shared privacy/storage/metadata and
the separate local integration decision. Each author owns a separate branch from
this committed assignment. A file has only one writer; after integration root
owns consequential shared corrections. Authors run no product suites or demos.

| Author | Assigned scope and paths |
| --- | --- |
| Partner author | G01 and G07-G12. New `packages/commerce/{partner-readiness,partner-service-core,protection-coverage,duty-assessments,reverse-hubs,international-handoffs,hsa-fsa,network-alerts,partner-privacy}.mts`, `packages/adapters/partner-fixture-source.mts`, seven matching contracts, `migrations/commerce/039_partner_services.sql`, `tests/development/{partner-services.test,partner-services-helpers}.mts`, `tests/fixtures/partner-services/`, `docs/PARTNER-SERVICES.md`, and the seven goal records. |
| Claims author | G02-G06. New `packages/commerce/{claims-core,warranty-registration,warranty-claims,shipping-claims,dispute-evidence,dispute-submissions,claims-privacy}.mts`, `packages/adapters/{claims-fixture-source,claims-source-guards}.mts`, five matching contracts, `migrations/commerce/040_warranty_disputes.sql`, `tests/development/{claims-milestone.test,claims-helpers}.mts`, `tests/fixtures/claims/`, `docs/WARRANTY-DISPUTES.md`, and five goal records. Narrow final warranty guard hooks in existing `packages/adapters/{resolution-fixture-source,fulfillment-fixture-source}.mts` are permitted; old unbound operation behavior stays intact. |
| Trial author | G13-G14. New `packages/commerce/{delivery-trials,delivery-trial-core,delivery-trial-privacy}.mts` as needed, `packages/adapters/delivery-trial-source-guards.mts`, two matching contracts, `migrations/commerce/041_delivery_trials.sql`, `tests/development/{trial-payments.test,trial-payments-helpers}.mts`, `tests/fixtures/delivery-trials/`, `docs/DELIVERY-TRIALS.md`, and two goal records. Narrow typed delivery-trial extensions in existing `packages/commerce/instant-exchanges.mts`, `packages/adapters/instant-exchange-fixture-source.mts`, `packages/commerce/action-gateway.mts` and `packages/commerce/execution-stops.mts` are permitted. No fabricated exchange, return or paid-unit identities. |
| Root | Canonical privacy/export/restore wiring, new shared `extended-services-privacy.mts`, a new additive storage extension and independently frozen 209-table fixture, the retained privacy test, one reserved local integration case in the claims file after handoff, allowed current inventory/hash updates, README/PLANS, M10 assessment/integration records, final evidence/reviews and packaging. |

New contracts and fixtures must describe actual implemented behavior. Authors
report exact table names, scope columns, source stores and export/erasure/restore
interfaces before handoff. The trial author is the sole writer of execution-stop
and ActionGateway changes. Stop action membership is additive, including
`diagnostic.partner.service`, `diagnostic.warranty.claim`,
`diagnostic.shipping.claim` and `diagnostic.dispute.submit`; all old entries and
effects remain. Any other old source change needs a concrete prior maintainer
scope decision, not an author-created exception.

## Shared contracts and required behavior

`PartnerReadiness` accepts a scoped context containing service, account ID,
source identity, source configuration digest, region and capability. A readiness
pin binds exact configuration revision/digest, current independent approval,
expiry and execution-control stamp. Every dependent effect must validate the
current pin again at its final source boundary. Configuration is disabled by
default. API-key presence, an author-filled agreement reference or a fixture
success cannot authenticate external contractual authority. Every local pin is
explicitly synthetic and never returns `external_qualified: true`.

Claims use service names `warranty`, `shipping_claims`, `dispute_submission`;
trials use `trial_payments`. The shared fixture installer uses callers' existing
kernel and independently authenticated owner/reviewer scopes, not another
business-state owner. Reconciliation proves a persisted original context and
operation and can look up an existing obligation after readiness revocation;
it grants no new submission, capture, benefit or physical movement.

Warranty registration uses current purchase/product/serial and customer proof,
explicit registration consent, immutable applicable terms, and bounded claimant
disclosure. Claims share one durable entitlement reservation/consumption ledger
and independent exact approval. Repair/replacement/refund outcomes use the
existing resolution and fulfillment owners and original receipts. A different
claim, actor or request ID cannot spend the same entitlement again. A source
guard binding survives new adapter instances; an absent callback for a bound
operation must fail before a new effect.

Shipping claims retain coverage/eligibility, evidence, destination and deadline
references, with submitted, approved and paid states separate. Dispute packets
use typed source-linked facts and exact versions, authorized evidence and explicit
missing-data labels. Retrieved text cannot invent acknowledgment or consent.
Approval binds the exact packet and processor/interface/deadline; changed or
deleted source facts require renewed review. Lost submission responses keep the
original native operation, packet and unknown state. HTTP success is not recovery.

Protection records identify loss responsibility, exclusions, fees and settlement
references. Changed terms require new shopper confirmation. Duties preserve
estimate, collection, assessment and remittance separately; disagreement remains
a reviewed variance. Reverse hubs use existing warehouse return/receipt owners;
custody and international costs are additive source observations, never fabricated
stock or completed legs. HSA/FSA eligibility comes from an explicitly scoped
provider observation and an existing canonical payment reference, never generated
health descriptions. Network alerts retain actual account, deadline and fee
identity; permitted responses cannot count an alert as recovered funds.

Delivery trials extend the existing InstantExchanges authorization/capture owner
with a real typed trial context and original order/case/value-allocation identity.
They do not introduce a second payment or stock ledger. Delivery timing, customer
consent, authorization expiry, maximum obligation and return receipt certainty
remain distinct. Corrections cannot silently redraw a trial clock. Extensions
require fresh approved terms/consent and valid authorization. Final capture uses
only source-confirmed retained quantities and stops for uncertain receipts,
expired authority or conflicting obligations. Races, lost responses and new IDs
cannot cause full-order or duplicate capture. Native precommit callbacks recheck
current authority; already committed effects retain original reconciliation.

All new tables have explicit merchant and resource/subject scope where applicable.
Export omits other subjects and replay credentials. Erasure rebuilds explicit
allowlists even for repeated hash-only or already-pseudonymized records, retaining
minimal original effect identities without approval authority. Import, restore
and uninstall revoke new readiness, approvals, confirmations and execution rights.
Separate source stores, historical exports and caller copies retain honest cleanup
responsibilities. The prior M08 post-erasure/unimported-movement stock limitation
remains documented; this assignment adds no automatic stock repair.

## Protected baseline and permitted metadata maintenance

The protected base has 1,399 tracked paths, 2,848 test registration objects, 161
capability objects, 209 tables, 38 migrations, eight storage contracts, fifteen
privacy surfaces, 233 runtime source pins, 31 adapters, 158 operations, 165
declared native cases and 47 direct fixtures. Preserve every prior member and
behavior, all prior planning/acceptance controls and oracle facts. Only declared
source changes may refresh exact hashes and dependent version descriptors.

Before implementation, this decision authorizes additive current table/migration/
catalog counts and schema/hash membership maintenance in the same five retained
tests: privacy coverage, return portability, installation upgrade, adapter catalog
and compatibility matrix. Their existing case names, old behavior assertions and
all historical projections remain. Retain the legacy 167 view, frozen 170/178/186
obligations, all eight existing storage contracts and all 38 migrations byte-exact;
add a frozen 209-table projection derived only from protected Git records.

New source paths receive explicit component ownership and honest proposed
capability/adapter declarations. Retain prior adapter operations, direct fixture
inputs/outcomes, qualifications and source/case pins. Keep the generic JSON bound
and the existing separately bounded catalog reader unchanged. Independent
regression review must compare this metadata with the protected base.

## Focused evidence and review

The owner's limits remain **60 actual cases, four whole files and one total
60-second deadline per invocation**. The planned coherent selection is **54**:
22 partner cases (21 goal cases and PORT-028), 17 claims cases (15 goal cases,
PORT-029 and the distinct local M10-PREP-INTEGRATION-01), six trial preparation
cases, and the retained nine privacy cases. PORT-028 exercises the newly added
unavailable partner paths; PORT-029 retains the original fabrication scenario.
The local integration case creates a warranty case and dispute draft and observes
safe behavior during a partner outage; it does not execute formal G99 cases.

Authors commit behavioral tests before implementation and execute zero product
modules, suites or demos. Root runs the coherent integrated candidate once, then
only affected or not-yet-run whole files for a concrete failure/consequential
correction. Each named unsafe behavior is exercised by an actual isolated changed
module and a fixed independent assertion. Setup/import failures and copied result
changes cannot stand in for the required behavioral fault evidence.

Retain every actual command, source/configuration binding, native XML/TAP ID,
failure and executed count. An environment-restricted file wrapper is zero usable
product evidence. Final fresh nonauthor authority/security and regression reviews
inspect exact source and native evidence without duplicate suites, within at most
three corrective rounds. Any carried unchanged result requires the full exact
source delta and both final reviews. No broad controller, browser, nested catalog,
restoration, connected, full-regression or release campaign follows automatically
from the blocked G99 assessment. Root's local integration decision remains
separate from review and formal acceptance.
