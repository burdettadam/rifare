# Customer-confirmed return prevention

The local fixture service identifies configured multi-size purchases and fit
pairs. It presents a reviewed size-guide reference and leaves paid goods as they
are. A customer may keep the order or explicitly confirm a fresh qualified edit.
The existing separate staff approval and order-edit execution follow that
confirmation. Suggestions never send themselves to customers or remove items.

## Configuration and exposure

An owner drafts size metadata, supported fit pairs and an exact published
knowledge reference. The reference must be visible to the store, have matching
content and revision digests and remain current through configuration expiry.
A different actor with the existing review permission approves it. Revoking or
changing the reference, its approving authority or the active configuration
blocks new suggestions.

Experiments freeze original purchase membership before their declared window.
They name baseline, control and treatment arms. The baseline is a predeclared
synthetic arm, not an observed historical merchant workflow. An original resource
can join only one cohort. Each purchase creates at most one recorded exposure;
duplicate event IDs, new delivery IDs, other cases for the same order and process
restarts cannot multiply it. Baseline and control purchases receive no offer.

The separate order-edit fixture is the source for purchased items, quantities,
paid totals, customer and version. The configured size reference is descriptive
guidance. It grants no financial, order or customer authority.

## Customer confirmation and existing edit approval

1. An operator prepares a qualified item, address or cancellation preview through
   the existing `OrderEdits.quote` logic. The customer view contains the original
   lines, requested change, affected lines, old and new totals, currency,
   financial obligation, source version and expiry.
2. A real authenticated customer for the same order confirms the exact quote
   digest. The service checks the current case, policy, settings, source snapshot,
   control revision and expiry. A staff actor, agent suggestion, customer ID in a
   request body or invented scope object cannot supply that confirmation.
3. The native fixture records a separate confirmation bound to the same edit ID,
   original order/customer/digest, intent, affected lines, currency and monetary
   values. A crash between the core record and native registration leaves native
   writes blocked. Retrying the same customer confirmation fills the missing
   record; the read view distinguishes those stages.
4. The existing action gateway requires separate current staff approval before
   authorizing an edit. Its normal rechecks, fulfillment holds, payment/refund
   stages and release requirements still apply.

Enrollment persists for the resource so that an agent cannot evade confirmation
by minting an unlabelled quote or waiting for the offer to expire. Independent
edits remain possible: the customer may explicitly confirm any fresh preview
supported by the existing edit service, including an independent cancellation.
Declining, disabling or expiring guidance never retroactively approves an old
prediction-based edit. Address-only edits retain their ordinary existing boundary.

The native source checks enrollment and exact consent inside its existing write
transaction. The original command fields and original operation ID identify the
authorized effect; no optional prevention flag is trusted. Consumption occurs
with the native commit. Unknown accepted results are reconciled by their original
operation IDs after restart. Revocation blocks unsent goods changes. A consent
revoked after commit cannot recall the goods change; existing financial and
fulfillment obligations remain visible and reconcilable.

## Honest experiment reports

`freeze` requires all three predeclared arms, unique purchases and future or
current enrollment time. The frozen record retains per-arm case counts, ordered
unit totals, currency and original paid values. Missing, immature, inaccessible
or erased outcomes remain in the denominator and suppress complete comparisons.
No API accepts a hand-picked replacement set when reporting.

The fixture outcome ledger contains explicit source references, coverage through
the observation window, returned units, retained revenue and the following cost
categories: goods, shipping, return shipping, platform fees, operator time, model,
messaging, hosting and software. Unknown amounts stay unknown. Later cost
observations append a version and change the current report without erasing the
earlier source observation. Retained revenue minus every declared cost is the
reported contribution; retained revenue by itself is not profit.

All supported figures use USD minor units with exponent two. Per-case contribution
comparisons and return-rate differences use exact rational arithmetic, retaining
unequal arm denominators. The supported ceiling is 500 purchases and 50 million
units per purchase. The reports label nonrandom synthetic data as descriptive
and noncausal. The fixture records are not externally verified costs, processor
settlement, physical receipt evidence, merchant ROI or a live pilot.

## Service methods

`ReturnPrevention` receives the existing `OrderEdits` instance. It provides
`configure`, `approve`, `configuration`, `freeze`, `analyze`, `read`, `preview`,
`confirm`, `revoke`, `refreshOutcome` and `report`. All methods use strict objects
and existing authentication and permissions. Native enrollment, consent bridge
and outcome-fixture administration are server-local helpers; do not expose them
as raw HTTP administration or accept caller-supplied source receipts.

Customer views omit cohort economics, other customers and session hashes. New
case/resource tables participate in the integrated privacy inventory. Frozen
aggregate denominator totals survive erasure; reports omit the unavailable
individual record. Separate fixture source retention and the normal restore
quarantine remain explicit operational boundaries.

## Verification and recovery

Permanent behavior tests are in `tests/development/return-prevention.test.mts`
and `tests/development/prevention-experiments.test.mts`; the known-answer dataset
is `tests/fixtures/assistance/prevention-golden.v1.json`. Cases exercise explicit
customer identity, direct native bypass attempts, one-operation consumption,
unknown-result reconciliation after restart, revoked claims, exact cost and
return denominators, duplication, stale source, no-AI and privacy boundaries.

This implementation changes no existing paid-goods test expectation and adds no
model provider, scheduler or dependency. It remains a bounded local fixture
implementation pending independent review, full integrated regression, formal
acceptance and connected qualification. Preserve both core and native ledgers
when restoring. Do not roll back to code that ignores enrollment while allowing
native editing, and do not manufacture a new operation key for an unknown commit.
