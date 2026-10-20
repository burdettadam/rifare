# Original-unit loyalty proposals

This local M19-G02 increment is assigned by [ADR-0059](decisions/0059-loyalty-accrual-projections.md).
Implementation and exact-candidate results are tracked in the
[milestone work record](../work/records/M19-loyalty-milestone.md). This document
describes the assigned contract; it is not an external provider qualification.

## Economic rule

An original paid unit is the earning identity. Its net paid allocation includes
gross less discount, tax, shipping and duties, using the existing resolution
ledger's unit allocation. A replacement carries that identity forward. Its retail
price and carried funding do not constitute another purchase.

Only an exact settled additional-payment capture increases the funded basis.
Only a matching settled refund reduces it. Provider acceptance, partial payment,
an unknown result, an edited order total and aggregate prior-refunded amounts are
insufficient evidence. A store-credit outflow remains explicitly unsupported.
Retained fees remain part of eligible paid value under this versioned rule.

For each original unit, the historical rule fixes a positive minor-per-point
divisor. Earned points are the floor of total qualified funding divided by that
divisor. Reversal points are earned points less the floor of the remaining funded
amount divided by the same divisor. Computing a cumulative target avoids drift
when identical financial events arrive repeatedly or in a different order.

For the independent two-line scenario, alpha contains two units paid at 1,000
minor each and gamma one unit paid at 1,000. At one point per 10 minor, the
original target is 300 points. A truly settled additional 200 in gamma's first
exchange adds 20. Its next exchange refunds 300 and one alpha unit refunds 1,000,
giving cumulative targets of **320 earned, 130 reversed and 190 net**. Alpha's
remaining target is 100 and gamma's is 90. Those values are an independent test
oracle, not a current provider balance or a claim of issued points.

## Read boundary

The native owner accepts current staff authority and the actual customer's
verified proof for the original case/link/ownership generation. Existing support,
resource, operation, erasure, uninstall and recovery checks apply. Customers
cannot use this staff history projection to inspect ancestor payments. A case on
a descendant does not implicitly authorize an ancestor traversal.

The original historical earning rule is pinned in a separate synthetic fixture
source. Its original paid-record digest, customer, financial source, currency and
rule version must agree. Publishing a later rule does not rewrite earlier
earning or reversal targets. The current G01 snapshot remains a separate balance
observation and supplies provider capabilities and freshness.

The service reads both core observations and source-side journals, captures and
lineage nodes. Every qualified event retains its original operation identity.
Missing or conflicting evidence remains pending or discrepant. Single-unit
financial events and single-unit-to-single-unit exchange ancestry are supported;
ambiguous splits or merges are unsupported. Bounds prevent an unbounded graph or
operation scan from appearing as a complete result.

## Result meaning

`units` shows economic candidate targets by original line and unit. `events`
shows original financial identities, qualification states and evidence digests.
`proposals` contains stable, cumulative accrual and reversal targets; these are
not executable delta commands. `totals` includes only qualified proposal targets.
If the original paid basis cannot be verified, totals is null and no unit or
proposal is fabricated.

A provider without reversal support can therefore show a candidate reversal and
an ineligible reversal proposal while excluding it from qualified totals. This
gap does not stop, modify or settle a financial refund. The refund stays under
its existing financial owner and approval boundary.

The projection has no enrollment, redemption, send or money-conversion authority.
It does not mutate financial records, rewrite provider balance snapshots or
persist customer-linked core caches. Synthetic rule and original-purchase pins
are retained only in the isolated fixture database and require separate fixture
cleanup. Provider-side export, erasure and retention are not attested.

## Next boundaries

Durable points redemption, reservation, exact approval, original-ID recovery and
privacy lifecycle belong to a separately assigned G03. Incentive comparison and
current consent/send revalidation belong to G04. Lifecycle reconciliation,
economic reporting and the milestone assessment remain later scoped work. Formal
M19 qualification also requires the accepted entry dependencies and actual
merchant-owned provider observations described in the goal packets.
