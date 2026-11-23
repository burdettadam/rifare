# ADR-0090 - Qualify upstream native order claims

Status: assigned local migration qualification; no release acceptance.
Base: `c949b1763d55be05561331adca450a90fdd856b5` (PR10). Branch: `feat/medusa-native-claims`.
Root is sole writer, delegated integration/acceptance owner.

## Assignment COMMERCE-ENGINE-03

Continue ADR-0081's selected Medusa migration by exercising ordinary order claims
through pinned Medusa 2.23.0 public workflows and PostgreSQL. Reuse the existing
native commerce fixture and its unchanged assertions. Add no claim engine, route,
provider, dependency, schema or alternative operator UI. Supabase/ElevenID
architectures and deployments remain with their other workers.

A test-only helper may create separate synthetic paid/fulfilled original orders,
using existing catalog/region/channel/shipping setup. Qualify a draft refund claim,
confirmed one-unit replacement, draft and confirmed cancellation, and rejected
operations on canceled claims/orders. Assert exact original order/payment identity,
claim item/reason/quantity, native reservation and stock changes, and actual payment,
capture and refund history. Claim confirmation may update a native payment
collection; it is not a provider refund, settlement or physical return observation.
Record exact native effects instead of interpreting an error as proof of no effect.

Preserve the existing seventeen baseline commerce workflow groups and public holds.
Use a fixed compiled own-dependency consumer and disposable local PostgreSQL; no real
financial or physical effects, external caller enrollment or credentials. Source
cache is reused; check host C free space before builds/production install. Bind the
qualified inputs, locks, outputs and evidence to the exact source. A deliberately
suppressed native reservation creation or cancellation must fail the unchanged
quantity oracle after positive native controls, followed by exact restoration.
Required authority/security and regression roles independently review exact source
and evidence before normal authorized development integration with Actions skipped.

Allowed paths: this ADR, the COMMERCE-ENGINE-03 work record, the existing
verify-commerce.ts and one test-only native-claim helper, source inventory, and the
commerce engine/plan documentation. No acceptance-ledger or retained contract edits.

## Equivalence boundary

Native ordinary claims do not replace the retained resolution ledger's paid-unit
allocation, original discount/tax/duty/shipping accounting, fees, approvals, stock
concurrency, privacy or uncertain external outcome recovery. Warranty, carrier,
insurer and processor dispute services are distinct and remain open. Delete no
legacy source until its actual retained behavior is proven through a replacement.
Connected identity, final commerce fences, production, rights and transfer
acceptance remain open. Upstream refund ordering on active changes requires
independent observation before any no-effect refusal claim.

## Authority review planning correction

Before implementing the partial-refund witness, require actual original refund
provider-call counts, native refund status/amount, order transaction/credit-line
and summary outcomes after active-claim rejection, stable-key retry, changed-amount
refusal and recovery after clearing the active change. Preserve an unknown effect
instead of interpreting an error as no payment. Canceled-order cases and native
foreign/repeated/excess quantity inputs require effect comparisons; record actual
unsupported behavior without changing retained resolution requirements. Add a
successful replacement fulfillment and actual native return-receiving witness as
separate originals from cancellation, rather than claiming those from a draft.
Installed source evidence motivates these cases; it does not establish runtime
outcomes. No application execution permission is broadened.
