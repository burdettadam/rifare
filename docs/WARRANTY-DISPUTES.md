# Warranty and dispute development preparation

This M10 slice implements local controls for warranty registration, warranty
decisions, shipping claims, truthful dispute packets and reviewed submissions.
`ClaimsFixtureSource` is a separately persisted synthetic source. It performs no
network request, real repair, insurance adjudication, processor settlement or
stock movement. Formal G03/G04/G06 connected qualification remains blocked.
M07-G99 and the original formal milestone obligations remain unchanged.

## Workflow and existing operation owners

`WarrantyRegistration.publish` copies an exact source terms version into scoped
merchant configuration. `register` requires current `CustomerAccess` ownership,
explicit registration consent, exact canonical order version, original paid
product/line/unit/payment identity, the independent source serial and the permitted
terms interval. Serial uniqueness is scoped by merchant/source, and a canonical
purchased-unit key prevents a different serial from registering the same unit. Read projections
omit customer session credentials and purchaser email. Existing registrations
retain their original terms version when later terms are published.

`WarrantyClaims.draft` gathers clean existing `ReturnEvidence` references and
reserves one purchased unit in `commerce_warranty_entitlements`. This development
contract supports one benefit per registration; a second claim cannot reset its
balance. The exact registration, outcome, evidence and original operation require
independent current reviewer approval. The claimant's current proof, reviewer
permission, control stamp and exact `PartnerReadiness` pin are rechecked before
any new native effect. The original gateway receipt, reviewer authority, current
quote, source configuration and gateway stop are also rechecked inside that guard.

Refunds use the original `ResolutionExecution`, original allocation, ActionGateway
receipt, native refund source and settlement observations. Replacements use the
original `FulfillmentExecution`, reservation, approved quote, original allocation
and replacement source. No warranty-specific money or stock executor is added.
The new native guard hooks apply only to persistently bound warranty operations;
all unbound existing operations retain their established behavior. A fresh source
adapter without the bound operation's current callback cannot execute it. The
callback is valid for one active dispatch attempt; after uncertainty or timeout,
a direct adapter call cannot repeat an unconfirmed effect. A committed original
effect remains readable for reconciliation. These hooks qualify only the existing
synthetic resolution and fulfillment sources, not a different payment adapter.

Repair outcomes submit a reviewed synthetic service request with the same durable
entitlement identity. Request submission, acceptance and an explicitly recorded
completion are separate. This local record does not establish physical repair or
allow an accompanying unapproved refund or replacement.

## Shipping claims and evidence packets

`ShippingClaims` links canonical purchase and shipment versions, the carrier,
source coverage and eligibility, policy reference, damage/loss type, clean evidence,
destination account and deadline. An uninsured, uncertain, unsupported or unqualified
claim displays a merchant review path without a compensation guarantee. Approved
submission is distinct from source approval and a later recorded payout. Repeated
notifications do not duplicate accounting or change the original submission ID.

`DisputeEvidence` constructs factual assertions from typed canonical order facts,
exact source dispute records and their versions. The packet labels missing customer
acknowledgment, purchase consent and communication explicitly. Retrieved notes are
never copied into the factual assertion collection and cannot manufacture proof.
Existing attachment quarantine, scanner status, content hash, case ownership and
expiry still govern admission. Packets retain redacted source references rather
than purchaser email or attachment bytes. Every assertion has a source reference,
source version and digest. Changing any source or attachment requires regeneration
and fresh review.

`DisputeSubmissions` requires an independently approved exact packet digest,
evidence hash, source interface, account, deadline, current readiness and execution
controls. Its single shared claim-submission lifecycle records the original
operation before calling the separate source. Submitted, accepted, decided and
recovered remain distinct; an accepted response is neither a win nor recovered
money. A later source observation is required for a decision and each recovery.

## Timeout, outage and restore behavior

Source submission and lookup have a bounded one-second wait. A lost response
leaves an unknown original operation. A new key, new packet ID or
new claim does not authorize repeating that effect. Reconciliation first proves the
persisted original command/account/source, then uses source lookup only. Readiness
expiry or outage does not turn lookup into new submission authority. The source
contract is fixture-only and fixed to `claims-fixture-v1`.

The canonical extension has nine tables: versioned warranty terms plus eight
subject tables. Every subject table has tenant, store, resource, customer and
subject-hash columns. The exported `exportClaimsSubject`, `eraseClaimsSubject`
and `revokeClaimsForRestore` helpers are integrated by the milestone owner into
the existing privacy and recovery lifecycle. Export includes only the subject's
records and referenced terms. Erasure rebuilds explicit allowlists, including on
repeated empty-resource hash-only calls, preserving minimal original operation and
source digests without approval or customer-proof authority. Entitlements stay
reserved or consumed. Restore revokes approvals and registration readiness,
removes claimant proof hashes and preserves uncertain operation identities.
Neither cleanup nor restore sends a native request.

Separate source databases, historic exports and caller-owned copies require their
own explicitly authorized cleanup. This work neither promises physical erasure
nor rewrites source financial history. The earlier M08 case where a committed
transfer remains unimported before customer erasure still needs operator
reconciliation under the original identity and privacy constraints; there is no
automatic post-erasure stock repair in this milestone.

## Test and qualification boundaries

`tests/development/claims-milestone.test.mts` contains sixteen author cases:
three each for G02–G06 and the retained PORT-029 fabrication scenario. G03/G04/G06
use distinct `M10-Gxx-PREP-01/02/03` IDs and claim local synthetic preparation only.
The integration owner reserves one additional cross-service case in that file.
Behavioral tests and the fixed known-answer fixture were committed before the
implementation. Authors execute zero product suites or demos; actual native
execution and independent reviews belong to the integrated candidate evidence.

The named faults alter actual isolated source modules: retroactive terms;
per-claim entitlement keys that permit two native repair requests for one unit;
reporting reimbursement at claim submission; generated acknowledgment in a packet;
and reporting a dispute won at submission. Their independent assertions include
the original source ledgers, immutable expected values, preserved missing items
and exact receipt identities. The source checks do not replace formal partner,
processor, physical-service or merchant evidence.

The owner-approved development profile remains at most 60 actual cases, four whole
files and one total 60-second deadline. Only the integration owner runs the coherent
selection, then affected or previously unexecuted files for concrete corrections.
No broad regression, connected campaign, demonstration, publication or release is
claimed by this guide.
