# M06 integration assessment

**Formal M06-G99 acceptance is blocked.** The owner assigned G11–G14 and the G99
assessment as the final five M06 packets. Local implementation, tests, independent
assistant reviews and a verified local merge are authorized. Original dependency,
connected-service and merchant evidence requirements remain unchanged.

[The qualification record](../work/qualification/M06.json) enumerates missing
obligations. M03-G99, M04-G99, M05-G99 and formal acceptance of all fourteen M06
components remain open. Synthetic terms, destination records and source ledgers
cannot supply a real account, warehouse contract, customer mandate or merchant
evaluation. The target PostgreSQL/React and direct served-browser qualification
also remain open. This batch does not start M07.

## Integrated local journeys

The new native `return-depth-integration.test.mts` suite runs these journeys on
the combined candidate with the same retained core and separate fixture sources:

- A mixed return refunds one original paid allocation, issues another allocation
  as store credit and delivers a funded replacement. A repeated-exchange child
  retains the carried paid value, including a settled additional payment, while
  preserving the distinct replacement retail price.
- An unavailable catalog item exposes refund/credit alternatives and cannot
  create a stock commitment or replacement operation.
- A non-return after mandate expiry requires fresh authorization. A capture with
  a lost response stays unknown until lookup of the original operation confirms
  the bounded native capture; it cannot manufacture another charge.
- A finalized fee discrepancy remains a visible unresolved obligation.
- Merchant cost reporting preserves incomplete costs, duplicate events, duplicate
  resource denominators, unknown operations and original ledger integrity.

The frozen independent arithmetic fixture uses USD minor units: original paid
8,740, prior refund 1,940, new cash refund 1,940, credit issued 960 and additional
payment 200. The delivered replacement has retail value 1,400 but carries 1,200.
Credit issuance remains distinct from cash refund settlement.

## Merchant cost measurement

`ReturnEconomics` reads an existing `SupportMetrics` frozen cohort and its declared
cost records; it does not create a parallel accounting ledger. All original
financial, fulfillment and instant-operation IDs and states remain distinct in
the report. It validates those journals through their original allocation,
obligation and command identities before displaying observations.

The example declares retained revenue 4,100 after the stated cash refunds and
credit liability, goods cost 700, shipping 500, platform fees 80 and operator time
120. Total declared costs are 1,400 and declared contribution is 2,700. The output
explicitly sets `declared_costs_verified`, `profitability_established` and
`external_settlement_qualified` to false. These are synthetic arithmetic results,
not evidence of merchant profitability or observed provider settlement.

Every declared cost category must be present. Missing or unknown amounts yield
unknown totals, not zero. Duplicate event IDs cannot multiply costs. Multiple
cases for one resource remain in the frozen denominator but block an aggregate
value that could double-count retained revenue. Erased or inaccessible members
remain unavailable in the denominator. Unknown operations retain their IDs and
state even when all declared costs are present.

## Current-candidate evidence

Final verification must run the unchanged external controller against the exact
combined candidate, preserving every previous registration, capability, protected
oracle and source/control obligation. Independent nonauthor authority/security
and regression reviews must identify the same candidate and tree. A deliberately
removed prior regression must be rejected even while the new journeys remain
green. Earlier branch results cannot substitute for the final combined run.

Actual commands, native reports, candidate/tree identities, review decisions,
fault evidence and the local integration decision are retained in the cumulative
handoff. This guide and the qualification JSON are requirements/state records;
they do not assert that an unperformed check passed. Recovery must preserve the
source history, prior handoffs and unknown financial/physical operations together.
