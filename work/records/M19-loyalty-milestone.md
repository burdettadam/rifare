# M19 local loyalty continuation

## Authority and baseline

The owner requested the next goals toward the milestone on 2026-10-20. Continue
from G01 closure fa7ae08824b4e4acf4031a4262bf8c6da79490a5 on the sole-writer branch
goal/M19-loyalty-milestone. Protected main remains a33c4ad. Recovery details and
the exact G01 evidence are in M19-recovery-checkpoint.md and evidence/M19-G01/.
There is no remote. Saved source does not reconstruct the missing later
M15/M16/M23 history or the unpreserved older chat's M19 implementation.

## M19-G02 assignment

Prior assignment: ADR-0059, committed before independent tests and runtime.
Independent test author owns the three new loyalty-accrual test/fixture paths on
test/M19-loyalty-accrual in a separate worktree. Root owns runtime and is sole
executor. Independent authority and regression reviewers are nonauthors.

State: bounded local implementation complete and independently reviewed.
Freeze cc1d1dcc825a852118fca4f84ae0ccff87efdecf was integrated unchanged as
797b842b352053564e3bb26ff2096341707d45d9 before runtime. Exact candidate
2cc9211eb3e1a2776cff5539e02d2186e0dba378, tree
c5a682fcca6f8dc9ae4d360a3122b100ab3626d1, passed all 58 assigned native cases in
39.434 seconds: 20 G02, 20 G01, 17 exchange-lineage and one post-edit allocation
case. The four whole files stayed within the unchanged 60-second deadline, with
no failures, errors, skips or timeouts. All 1855 report source hashes match the
candidate. The report retains full_regression=false and goal_accepted=false.

The current local contract produces original-unit accrual/reversal proposals,
with no points or financial effects. Historical earning rules are pinned;
source-side and core evidence must both match. The independent two-line oracle
is 320 earned, 130 reversed and 190 net after two gamma exchanges and one alpha
unit refund. A merely accepted alpha refund leaves 320/30/290 with pending
evidence. The unchanged independent tests observed these expected values on the
exact candidate. They establish synthetic proposals, not provider-issued points.

The candidate adds a native historical fixture owner, bounded read-only evidence
projection and one optional SupportService action. Current G01 scope and proof,
physical source isolation, original-unit arithmetic, both native journals and
actual current staff permissions are revalidated. Metadata preserves all prior
3200 tests, 215 capabilities, 547 protected paths, 1844 source members, 39 adapters,
201 operations and 265 conformance cases, adding 20 tests, one capability, seven
protected paths, eleven source members, one adapter, one operation and three
conformance cases. All 15 privacy surface IDs and the core schema remain unchanged.

## G02 evidence and independent review

Both nonauthor reviewers approved the exact candidate for this bounded local
scope. The authority reviewer verified complete native command reconstruction and
durable financial/fulfillment identity checks. The regression reviewer verified
mandatory native IDs, legitimate native-return closure and discrepancy precedence.
These five findings were corrected before the product run; five separately
identified executor-authored probes passed in 1.733 seconds without altering the
independent suite. The retained probe launch failure occurred before any case,
due to a disallowed child-process Git query; the corrected ignored probe script
uses the already established candidate identity. Runtime and tests did not change.

An isolated exact-parent fault, b00c03bef3179c7a4ecb4bb74fb903020c318db5,
incorrectly counted replacement carried funding as new payment. Twenty frozen
cases executed: 13 passed and seven failed behaviorally, including all three
permanent G02 cases. Gamma's additional funding became 2300 rather than 200 minor,
inflating its earned target by 210 points. The complete journey became 530/130/400
rather than 320/130/190. The fault and its two required hash-pin changes remain
outside product ancestry. No frozen test, helper or oracle was changed.

Actual reports, source/hash preservation, the fault patch, supplemental probes,
both review decisions and the closure comparison are retained in
evidence/M19-G02/. The closing documentation changes leave executed runtime,
tests, contracts, metadata and pins identical. Complete native Git history and
the evidence accompany the self-contained checkpoint; an earlier archive is not
required to restore it. Main and the acceptance ledger remain unchanged.

One nonblocking robustness limit remains: native observation reads materialize
rows before the projection's observation-count check. Connected or larger-volume
qualification must bound retrieval as well as interpretation. Multi-unit
attribution and the specified store-credit behaviors remain unsupported.

## Remaining local and formal work

G03 durable reservation/redemption must include privacy, restore, current
approval and unknown-outcome encumbrance in its first increment. G04 must reuse
existing offers, consent and actual send boundaries. G05 must expose lifecycle
discrepancies and distinguish point targets from provider-issued/redeemed events
and measured economic outcomes. G99 will assess the supported local envelope.
These goals are not implemented by the G02 assignment.

Formal M19 remains blocked by missing accepted entry dependencies, merchant-owned
provider and messaging qualification, connected and target-host evidence, a
current applicable full gate and trusted formal acceptance. A bounded local
development batch does not satisfy those requirements.

## M19-G03 prior bounded assignment

ADR-0060 assigns durable synthetic redemption from G02 closure c8e8240, under the
same owner instruction. It fixes exact human approval, account-level reservation,
native receipt identity, complete source booking, unknown-outcome accounting,
independent financial execution, typed exception reconciliation and first-class
privacy/restore/import behavior. Root is sole runtime writer/executor; the
independent author owns only the new redemption tests/fixtures in a separate
worktree. No G03 runtime is implemented or executed at this assignment checkpoint.
The intended focused batch is 20 new + 21 action-gateway + 17 privacy cases.
