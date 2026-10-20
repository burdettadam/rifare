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

## M19-G03 implementation and exact evidence

The final bounded local product is 0ef6b5d97ea53e0f0b2ceaa3d7094fc2801c9196,
tree 9b4affb117f3805c3165bacb9e8b9942622b0ddc. It passed 58/58 actual native
cases in 18.121 seconds under the unchanged 60-second deadline, with three whole
files: 20 new redemption, 21 existing action-gateway and 17 existing privacy
lifecycle cases. The native report records a clean candidate, full_regression=false
and goal_accepted=false. All 1867 report source hashes and all 58 native XML IDs
were checked against the exact candidate and preserved denominators.

G03 adds synthetic durable redemption through the existing action gateway,
operation/work/target/receipt owners, support service and exception queue. The
caller must be an actual human owner, operator or reviewer, with current proof,
ownership, permissions, separate consumed approval and original terms. Restricted
worker scopes cannot inherit that authority. Typed points never become money,
enrollment or messaging authority. A real native worker refund fixture still
completes its authorized 1940-minor-unit ($19.40 USD) refund beside uncertain
loyalty work; a malformed loyalty record cannot claim the separate-effect rule.

The durable account anchor and complete source journal explain every later
snapshot. A successful source transaction writes the original-ID booking and
its exact point debit together. Core uncertainty is committed before invocation;
a separate core lock spans final authorization and the synchronous fixture call.
An unknown outcome is never retried under a new identity or released by expiry.
The independent 600-point baseline retains a 400-point unknown hold, leaving
200 spendable points. Exact booked overlap avoids subtracting a lost-acknowledgment
debit twice while retaining the original unknown until lookup resolves it.

## G03 independent freeze and retained failures

Independent author freeze b8134dec58b2c6057d29bb5ab8523dff515fb6f0 was integrated
as 341cca324b91865d7a1646f1b1eafec381e38507 before runtime changes. The initial
product 258d9cf passed 18 of its 20 new cases and failed the historical-uninstall
ordering case and the child transport setup. A root-owned regular-file host
probe demonstrated that Node's automatic child stdin/stdout wrappers discarded
the piped data while explicit descriptor reads/writes preserved it. Independent
author correction 0af41813d6b4679e353c75f5ba96e0dc5f5ca071, integrated as
a912aa58fa220d228e102141e106ed8f19641f4f, changed only the race worker transport
and cleanup. The two actual processes, barrier, network-deny preload, deadline,
all 20 cases and assertions, test helper and literal oracle remain unchanged.
The original freeze and both file versions are retained; this is not described
as an unchanged four-file freeze.

Candidate-2 passed all 20 new cases; four existing gateway cases encountered the
sandbox's loopback-listener EPERM. The unchanged batch then passed under an
auto-reviewed execution allowance for its temporary 127.0.0.1 fixtures. Subsequent
candidate-3 and candidate-4 passing reports remain evidence for their own commits;
candidate-5 is the final product result above. No test expectation was removed,
skipped or weakened to obtain it. No external provider was contacted.

## G03 review corrections and supplemental evidence

Independent authority and regression review identified concrete lifecycle gaps.
The corrected implementation requires original source-absence evidence before
live privacy release; preserves historical holds across resource reassignment;
minimizes affected records before generic case erasure; retires exact linked
loyalty previews, approvals and receipt notes even for zero-resource subjects;
reconstructs fresh-import replay fences before strict copied-state validation;
and reapplies resource suppression even when merchant replay sees existing
tombstones. Strict existing-destination checks remain before transformations.
Held personal copies remain retained unless current suppression overrides them.
Immutable commands, receipts, quantities and source identities are preserved.

The reviewed ADR amendment also reserves audit-chain capacity. Optional notes
and corrections leave room for required native transitions and every outstanding
note's eventual erasure. A concrete boundary probe attaches 498 notes, observes
499 receipts, completes both transitions at 501, adds one permitted correction,
and erases all 498 notes at exactly 1000 receipts. A further optional append is
denied atomically; strict terminal reads and restored late completion still work.

Nine explicitly executor-authored supplemental probes passed in 5.819691107
seconds. The independent test author statically checked their setups and literal
expectations before execution, without editing or executing them. They are
separate from the frozen registry suite and do not expand its denominator.
The final report pins both the exact candidate and the probe script hash.
Twenty-nine static preservation/report checks passed. The native adapter catalog
validator passed with 41 adapters, 205 operations, 271 referenced native cases
and 47 direct fixtures, retaining external_qualification=false.

Independent nonauthor reviewers /root/checkpoint_audit and /root/loyalty_regression
both approved exact product 0ef6b5d and tree 9b4affb for the bounded local assignment.
They inspected source, history and saved execution evidence without edits or
product/test execution. No material authority, privacy, recovery or regression
blocker remains in their assigned reviews. Their decisions are retained separately
and do not confer formal acceptance or broader provider/production qualification.

## G03 deliberate fault and preservation

Exact-parent fault 14b50f77824523c46fce34b654e4d0e5d43173c8 has final product
0ef6b5d as its immediate parent. It deliberately forgets an unknown encumbrance
after quote expiry. Only one runtime condition and its two required file-hash
pins differ; the complete independent suite is unchanged. Native TAP/XML records
20 executions, 18 passes and two behavioral failures in 10.497 seconds:
CASE-M19-G03-01 and CASE-M19-G03-03 both observe 600 effective points/zero held
instead of the correct 200 effective/400 held. The runner correctly credits zero
validated cases for that failing file. The earlier fault on 40e958e is retained
separately. Both faults remain outside product ancestry and are never integrated.

Against G02 closure c8e8240, all 3220 prior cases, 216 capabilities, 554 protected
paths, 1855 source members, 40 adapter objects and prior conformance case objects
remain intact. G03 adds 20 cases, one capability, ten protected paths, twelve
source members, one adapter, three operations and three conformance case references.
There are 325 valid runtime pins and 651 valid oracle pins. All 15 privacy surface
IDs, the 262-table core schema, protected main and formal acceptance ledger remain
unchanged. G01 and G02 native APIs, permission catalogs and WorkerApi grants are
not broadened.

## G03 continuation and qualification

The exact-candidate reports, review decisions, prior failures, independent freezes,
host probe, nine supplemental probes, deliberate-fault patch, preservation and
closure comparison are retained under evidence/M19-G03/. The self-contained
checkpoint includes complete native Git history, every retained branch ref and
an independently verified readable source snapshot; no previous archive is
required to restore it. Closing documentation leaves the tested runtime, tests,
contracts, metadata and pins identical to the reviewed product.

One conservative availability limit is explicit: privacy cleanup without the
configured native source binding revokes/minimizes an unsent reservation but
retains its quantity. That retained reserved state has no current administrative
resolution route; it is not silently converted to unknown, released or retried.
The fixture protocol also refuses unexplained post-anchor balance publications
for new spending. Provider-side retention, caller copies and older exports/backups
remain separate cleanup boundaries. These limits do not claim production or
merchant-owned provider qualification.

G01 balance/rule reads, G02 original-unit accrual/reversal proposals and G03
durable synthetic redemption are now locally implemented. The next separate
increments are G04 incentives using native offer/consent/send owners, G05 loyalty
lifecycle reporting and G99 assessment of the supported local envelope. Formal
M19 and connected/provider/target-host/full-regression acceptance remain open.

## G04/G05 focused continuation assignment

The owner's renewed instruction prioritizes progress and minimum useful test
execution. ADR-0061 assigns the next bounded local increment from G03 closure
e9421d990489fdcdce5fbe080a3a1733669b797e: native incentive comparison with mandatory
existing-send validation, and transient lifecycle/economic reporting that keeps
missing award/reversal evidence explicit. Root remains sole runtime writer and
executor; the independent author owns three new test artifacts in a separate
worktree. Both independent reviewers assessed this scope before implementation.
Fourteen independent new cases plus the 24-case existing marketing file are the
planned single coherent batch. No G04/G05 runtime or completion is claimed at
this assignment checkpoint; tests must freeze before runtime changes.

## G04/G05 local implementation and exact candidate

The focused assignment is implemented at product
10b1f763c3289dfc13f3244dadcdd98a51a5f49d, tree
36674997c3c35239a3707bb46eda7108ed6d441e. Root was sole runtime writer and
executor. The independent author used test/M19-loyalty-incentives-lifecycle;
the two nonauthor reviewers inspected source and saved evidence without product
or test execution. All execution evidence is under evidence/M19-G04-G05/.

G04 adds a customer-free applicability declaration in the physically separate
native marketing source, with stable shopping/redemption identities and explicit
benefit/offer/variant pairs. Quotation requires a current human support owner,
customer proof, committed native cart, scheduled approved offer, consent and
current G03 capacity. It creates only the original native quote, retaining its
creation time, proof and maximum ten-second lifetime. Point cost and discount
terms remain separate quantities. Selection does not enroll, reserve, redeem,
assign an experiment or send a message.

Binding attaches the public comparison to one native recovery before any message
operation. Its identity is immutable; validation neither replaces the quote nor
renews proof. Final-send validation is mandatory in the existing CartRecovery
and SupportDelivery path. The selected recovery row and current case must match
the body's ID, cart, campaign, resource and customer before the canonical native
owner validates it. Marked recoveries require a human caller; ordinary unmarked
campaign behavior and its digest remain unchanged.

G05 composes the same native G01/G02/G03 and optional measurement owners into a
transient lifecycle report. Account totals, original-order/unit targets, exact
original-ID redemptions, financial evidence, native campaign metrics and queue
truncation flags retain their separate meanings. A lost-acknowledgment source
booking is counted once without claiming that the unknown core state is resolved.
Reports never retry or reconcile an operation. Missing attributed award/reversal
evidence keeps status needs_reconciliation, reconciled=false and unproved
valuation fields null, including after a successful financial refund.

Current reports require human ownership, proof, analytics and original-resource
access. Retained reports require already-minimized native operations plus current
analytics/privacy/resource permissions, and do not consult customer or provider
state. The existing native 1000-record and 131072-byte canonical-output bounds
reject oversized reports. No new personal core table or report cache was added.
SupportService exposes five optional native routes without implicit permissions.

## G04/G05 independent freezes and concrete corrections

The prior assignment is 34d73c2b9d2a05e8bd9247394aa4b6258f976549, with
pre-freeze clarification fe70c14f688abee5ce37ce8d6e40d6eb1b83a407. Independent
author freeze 101a35b368f6103d56bc6d5ab1c95ed2c7014a6e was integrated unchanged
as 8e0740c0f4f6258b8013249630ac4037e8ae8548 before runtime changes. It owns
14 executable cases, one helper and one literal oracle. Independent strengthening
a85cd4ac5b7c07c869cc716e887c4f773993b794, integrated as c7b7368, added exactly
seven lines proving that a valid explicit pair still rejects an unchanged native
cart outside its variant list. It removed no expectations.

Initial product a2dad1d30b0a3ce5f24821b3eef7bddba643e90d ran 38 selected cases
in 17.192 seconds. All 14 new cases passed; the old marketing file passed 23 of
24 and failed CASE-M09-G08-03 with FAULT_MARKER_NOT_UNIQUE. The unchanged old
mutation helper relies on an exact eligible/return adjacency. Product structure
was corrected to retain that marker while placing mandatory validation in the
returned digest computation. The runner correctly credited only the wholly
passing new file's 14 validated cases; the failed attempt is retained.

Independent review identified two material defects before the corrected run:
body-ID redirection could validate a different otherwise-valid recovery, and
the one-sided fixture check could create applicability storage in a core-backed
marketing database. The runtime correction binds all selected-row scalars and
uses canonical row.id; bidirectional separation/fixture preflight checks every
source before storage creation.

Independent author correction fb76d0e97462860254a80135584d68a9499d93d1 was
integrated unchanged as 812c46d359f782124f88a32a8381b08be2176257. It strengthens
G04-05 with two real valid recoveries and a positive control, then redirects the
selected body ID and removes its binding; it requires rejection and unchanged
effects. G05-08 uses a real core-backed MarketingFixtureSource and requires
constructor rejection before the new table exists. All 14 IDs and previous
expectations remain. Final test SHA-256 is
54fead376c5750f86070695f2a55521b0015489298950639258199ed4796fd85.
The helper and literal oracle remain byte-identical to the original freeze.
Both original and strengthened versions remain in Git; this is not represented
as an unchanged original three-file freeze.

## G04/G05 actual native execution and single fault campaign

Exact clean product 10b1f763 passed all 38 selected native cases in 16.494 seconds:
14 new cases in 10.451 seconds and 24 unchanged marketing cases in 5.935 seconds.
Raw XML has exactly 38 unique IDs, with no errors, skips or timeouts. The report
binds all 1878 source hashes to that product. The ordinary development budget
remains 60 cases, four files and 60 seconds; the actual selection used two files.
There was no broad suite, supplemental product probe or additional product
restore campaign for this increment. Worker-negative cases demonstrate the
existing grant boundary, whose workers lack the required support read/send
grants; they do not separately prove an otherwise-authorized worker human fence.

Fault b7766d1e7cf3b58e200077f700df4d67246ffd7e, tree
8c5410315b89831306ae279c1dcf2c3bd5dc7df9, has exact product 10b1f763 as its
immediate parent. The separate fault/M19-incentives-lifecycle worktree changes
only two new-runtime predicates and their required pins. The new test, helper
and oracle are unchanged, and all 1878 fault source hashes match its report.
Its 14-case run took 9.936 seconds: eight passes and six ERR_ASSERTION behavioral
failures, with no setup errors, skips or timeouts. The runner correctly credits
zero validated cases for the failing file.

G04-03 detects the deliberately omitted final validation after a native 400-point
redemption changes the balance. This first failed assertion stops the case;
later purchase/consent fault subscenarios receive no separate credit. G05-01,
G05-02, G05-03, G05-05 and G05-07 detect a qualified financial refund being
falsely reported as reconciled while attributable loyalty evidence is absent.
The selected G04 fault does not substitute for the formal goal's separately
named enrollment/redemption-on-selection fault. The fault patch and raw results
are retained, and its ref remains outside product ancestry.

## G04/G05 preservation and continuation

Independent authority/privacy reviewer /root/checkpoint_audit and independent
regression reviewer /root/loyalty_regression both approved exact product
10b1f763c3289dfc13f3244dadcdd98a51a5f49d and tree
36674997c3c35239a3707bb46eda7108ed6d441e for ADR-0061's bounded local scope.
No material blocker remains in their assigned reviews. They independently
inspected source/history and saved native/fault/preservation evidence without
edits or product/test execution. The decisions are retained in
evidence/M19-G04-G05/authority-review.md and regression-review.md, with the
exact decision in decision.json. These decisions do not accept canonical G04,
G05, M19 or G99 and require no additional product execution for this local scope.

All 29 static preservation/report checks passed against G03 closure e9421d9.
The 3240 prior test records, 217 capabilities, 564 protected paths, 1867 source
members, 41 adapter objects and old native-catalog cases are retained. Final
counts are 3254 registered cases, 219 capabilities, 572 protected paths, 1878
source members, 328 runtime pins, 659 oracle pins, 42 adapters, 207 operations,
67 source declarations and 278 native-catalog references. The native catalog
validator passed with 47 direct fixtures and external/production qualification
false. All 15 privacy surface IDs, the 262-table core schema, migrations,
permissions, worker grants, protected main and acceptance ledger are unchanged.

The closing changes are limited to PLANS.md, the incentive/lifecycle guide,
the local assessment and this work record. Runtime, tests, contracts, metadata
and pins remain those of the exact reviewed/tested product. The self-contained
checkpoint preserves complete native Git history, all refs, cumulative evidence,
earlier failures, independent freezes and a readable source snapshot. Ordinary
bundle restoration and file-hash checks establish recoverability without another
product test run. Previous checkpoints remain available.

G01-G05 have bounded local synthetic implementations; G99 has a documentation
assessment only. Formal M19 remains blocked by accepted prerequisite and full
qualification gaps. No G99 behavioral case, G99 targeted fault, full current
regression, merchant-owned provider/messaging qualification or production release
is inferred. Missing later M15/M16/M23 source history remains unreconstructed.

The next substantive loyalty work is an attributable award/reversal source
protocol tied to original orders and units, with supported unknown/duplicate
handling and remaining-balance reconciliation. Until then, lifecycle missing-
evidence exceptions and null valuation stay explicit. Other limits remain:
human-only bound sends with immutable short-lived quotes; G03 unexplained
post-anchor balances blocking new spending; no administrative resolution for
revoked unsent holds minimized without a source binding; native bounded retrieval
and output limits; and separate provider, caller and old archive retention.
