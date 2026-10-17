# Review: replacement stock and carrier lifecycle

Prior authority: ADR-0023 / DELEGATED-LOCAL-14, committed before implementation.
One assistant performed the maintainer review under the owner's delegation.
This is not multiple independent reviewer sessions or formal milestone acceptance.

## Findings and corrections

1. A void accepted remotely but missing its local acknowledgment could not reconcile
   a later confirmed reimbursement. Correlate the original void operation before
   accepting the skipped intermediate observation; no uncorrelated jump is allowed.
2. Tracking consulted current store defaults rather than the purchased label's
   configuration. Pin the trigger/settings into the operation and suppress eligibility
   when current settings or case policy no longer match.
3. An unused label was marked unusable after its void request was rejected. Rejected
   voids now preserve label usability until expiry, while reimbursement remains
   unconfirmed and replacement remains blocked.
4. The new parcel/quote tables were in the schema inventory but absent from actual
   customer erasure. Add scoped erasure/export and remove address references from
   retained operation commands; keep only minimized reconciliation identifiers.

`fulfillment-review.test.mts` preserves the four reproductions. Separate artifacts
record failing and corrected runs. Additional tests cover actual expiration,
policy revocation, HTTP boundaries and source export. A new fixture test initially
revoked an older policy version instead of the case's pinned version; correcting
its setup does not constitute a product-code defect or weakened requirement.

## Regression evidence

The original CASE IDs from M03-G11–G15 are bound to native Node cases. Tests include
actual separate-process last-unit competition, duplicate replacement execution,
commit-then-exit recovery, quote-without-charge, rate/address drift, unknown outcomes,
label replacement/reimbursement lineage and delivery independent of inspection.
New tests must enter the retained registry. Prior test files/registrations and
contracts remain unchanged. The independent baseline must be checked before a
review-based additive refresh; a candidate cannot approve changes to its own oracle.

The evidence package contains selected deliberately faulty worktrees, meaningful
failure reports, the normal candidate's full run, reviewed source identity,
preservation comparisons, merged-head/restoration evidence and the demonstration.
Only actual executions count; no connected store/carrier or browser run is implied.

## Decision

Approve the bounded SQLite and separate-ledger diagnostic implementation for local
integration when the documented checks pass. Keep all connected-provider and
upstream milestone qualifications open. Require explicit provider contracts and
account qualification before enabling nonfixture effects. No public remote,
release, model service, real shipment or charge is part of this work.
