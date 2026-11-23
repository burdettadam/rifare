# COMMERCE-ENGINE-03 - Native ordinary order claims

State: assigned; implementation and qualification pending.
Base: `c949b1763d55be05561331adca450a90fdd856b5`. Branch: `feat/medusa-native-claims`.
Writer/integration owner: root, existing primary checkout.
Contract: [ADR-0090](../../docs/decisions/0090-native-order-claims.md).

PR10 merged normally and its tree equals reviewed publication c2866df. Its owned
server/PostgreSQL fixture stopped, runtime/compiler/Admin inputs retired under
fresh Windows gates with 91,934 nondeleting share probes. Measured allocated file
bytes retired: 649,390,784; observed host free delta 681,029,632 is not exclusive
attribution. Source cache, existing native types, refs and all 53 evidence hashes
remain verified. PR10 holds final integration/lifecycle evidence. One active primary
(root), zero linked/verification checkouts; no competing native claims branch.

This branch resumes that primary. Prior feature refs remain reachable. The existing
source dependency cache is compatible and reused. Any separate runtime is owned
by root and retired after exact-candidate review/integration. No full build cache
or runtime is currently retained. Host C free observed 58,257,944,576 bytes before
assignment. No other worker's checkout, deployment or source will be modified.

Read-only installed upstream inspection confirms native claim workflows. Independent
regression planning identifies separate originals, exact quantities/payment history,
replacement reservation lifecycle, canceled-state refusal and no broad equivalence.
Root selects those controls under ADR-0090 before candidate implementation. The
upstream refund-before-creditline report is an investigation lead, not local proof.
Next: implement the bounded helper in the existing native fixture, execute against
disposable PostgreSQL, fix only evidenced harness/source issues, then freeze compiled
qualification and obtain both independent roles. Connected external gates stay open.

## Initial implementation checkpoint

The test-only helper now composes native draft/refund and replacement claim controls
in the existing commerce verification, after all existing assertions. It introduces
no application behavior. Native source typing rejected the nonexistent damaged
reason; corrected to the pinned production_failure enum before runtime execution.
No-emit then passed. Partial-refund, receiving/fulfillment and adversarial quantities
remain to implement/observe under the prior scope correction. Initial native
execution will establish actual cancellation behavior before any acceptance claim.

## Initial native execution and oracle correction

At 48e5d73 the unchanged existing commerce groups reached their prior assertions.
The added draft claim/control ran, then the helper incorrectly expected a visible
canceled_at claim after draft cancellation. Native PostgreSQL confirms the upstream
cancel-begin workflow soft-deleted both the draft claim and its pending change;
normal retrieval correctly refused. Correct the test to assert those native rows
are soft-deleted and hidden, retaining exact no-financial/stock-effect comparisons.
The initial execution failed and is not a passing qualification. A missing claim
is an allowed typed refusal for later canceled-draft actions, not resurrection.
Installed payment/refund/cancel source bytes matched the integrity-verified locked
registry tar in the existing npm cache; no modified vendor source is assumed.

## Native financial failure/recovery diagnostic

At c21e6b4 the corrected error-record assertions reached native replacement
confirmation, then the helper's version assertion failed because it had retained
the pre-capture order version. The original helper now rereads the actual paid,
fulfilled original before starting a claim. This is an observed-stage correction,
not a relaxed confirmation-version requirement. The run remains failed.

A separately preserved, local diagnostic on that exact synthetic database confirmed
native confirmed-claim cancellation released its reservation. It also measured a
new active refund claim: System provider refund called once for USD 1 and native
refund succeeded, while the workflow returned existing-active-change and left zero
refund transactions/credit lines/payment.refunded events and summary refunded_total zero. Same-key
retry retained the one original refund with no new provider call. Changed amount
refused. After canceling the draft, same-key recovery created one refund transaction,
one credit line and one payment.refunded event; replay retained that exact state with no provider
recall. These are synthetic/native effects, not settlement or a safe automatic
recovery API. Diagnostic TS package-scope and Windows inline-compiler setup failures
preceded the actual successful CJS probe and are retained, excluded from passing
native evidence. No vendor files or application behavior were changed.

The expanded helper encodes those independent expected stages and adds separate
replacement fulfillment/native return receiving. It preserves all 23 existing
baseline entries reached in the initial normal-lock profile. Expanded no-emit passes.
Next: complete adversarial/effect observations and fixed native execution, then exact
compiled own-dependency qualification, fault/restoration and both final reviews.

## Expanded lifecycle and adversarial evidence

The 1ca64c3 source run reached replacement confirmation/cancellation, five refund
failure/recovery checks, replacement fulfillment and return receiving. It then failed
in the final canceled-order fixture because that cart lacked shipping. Add its normal
native shipping method; no shipping validation is bypassed. This remains a failed run.

Read-only authority review of the actual diagnostic and source requested exact
provider arguments/raw money/currency, wider refusal snapshots, and actual return/
fulfillment identity checks. Those assertions are now present, together with a real
native inbound manual return fulfillment and canceled-while-live refusal. No fake
physical receiving or independent external provider is claimed.

Two targeted native adversarial diagnostics on the already-populated synthetic
expanded database refused foreign-order item, excessive original quantity and
repeated aggregate quantity at preview. The second widened comparison to the full
25-table refusal snapshot and found no changed rows/tables. Raw probes/logs are
retained separately; these exploratory observations are not fixed qualification.
The first-class helper now asserts these cases and competing active-claim refusal.
No native vendor changes, routes or application permission changes were introduced.
