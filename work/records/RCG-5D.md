# RCG-5D — Receipt evidence in customer checkout review

State: implemented; integrated verification and independent review pending
Integration owner: root delegated maintainer
Implementation writer: `receipt_review_impl`, separate assigned worktree
Independent reviewers: `next_scope_audit` (authority), `http_regression_review` (regression)
Assigned scope: [ADR-0074](../../docs/decisions/0074-checkout-receipt-review.md)
Integration branch/worktree: `feat/rcg5-receipt-review` / `rifare-rcg5-receipts`
Protected source base: `4ac855602b80652d76c54b6da25fcb905c57cdbe`

## Outcome and preserved contract

Add explicit receipt evidence submission to the current review page using the
unchanged native receipt API. Preserve the original intent, current proof and
binding checks, one on-page attempt, explicit status after uncertainty, transient
secret handling and false execution authority. Allowed paths and concrete
behavioral obligations are fixed in ADR-0074. Provider final use remains absent.

## Publication and continuity

The owner approved the prepared Rifare-only GitHub connector addition. It was
saved and verified through the connector before publication. The prior three
repository selections were preserved. Native Git still had no configured login,
so the authorized Git-data connector published an exact-tree checkpoint on
`feat/rcg5-checkout-review` at `4ac855602b80652d76c54b6da25fcb905c57cdbe`.

A fresh native fetch verified its parent `933600561a989150e2a2d3c4273a57ee84cdad52`
and tree `0b9f76653995827b52ae2f908a17bc33ababcfbd`, identical in all 1787 tracked
files and modes to native `413f8493f1535c8de9696829a381322409d1d787`. This is a new
publication commit, not a recreation of the native 47-commit history. That history
is preserved in `rifare-native-rcg5c.bundle`, SHA-256
`731de7e152bb701823b07a36d6dfcf6433a5146bd77e82b6e7e4f8c0bda96f88`.
No development/main branch, PR, workflow dispatch, release or tag was changed.
The feature branch does not match either checked-in automatic workflow trigger.

RCG-5C's final authority review (`67c1cd9e6e3cbc31e6e1eb2eb834761528a0ff09e27c4d5b439a894a34aefb68`)
and regression review (`69d96bc5eb198a92b9bcb3ee81ba63b5806626c21c0bc0582c2fac2f20e95729`)
found no scoped blocker. The prior nine browser passes and their exact execution
identities remain historical evidence. They are not new executions on this
publication commit and will not stand in for tests of the changed receipt UI.

## Candidate and review

Implementation author: `05156f0a8935845ed34a8fc59b95530ac2fc1f8f`, integrated as `715c56f`
Meaningful behavioral red: observed on clean `f4cb5e79abff89e471142b274b66d52963ee3639`
Focused controller/native HTTP results: author clean-candidate 12 new and 21 existing passed; integrated verification pending
Actual served-browser results: not_run
Independent authority/regression review: pending
Formal milestone acceptance: not performed

The canonical new controller/native HTTP selection executed locally before any
application asset change. All 12 cases failed at the intended missing receipt
control after the actual native preparation had created one original intent at
revision 1. The first case took 0.345 seconds; the native file took 6.736 seconds.
The source map was clean, and all three page assets matched protected `4ac8556`.
This is a behavioral red, not a missing runtime or browser claim. The exact
report and native XML remain under ignored `evidence/rcg5d-local-red/`.
The tests-only late-expiry extension was integrated afterward at `4197cd2`;
that addition is not represented as executed by the earlier red.

The first implementation run passed 11 cases and failed one because the expiry
test froze its clock before native preparation. Commit `be3bbd0` (integrated as
`b02604f`) makes time live until the deliberate expiry faults; every expiry
assertion remains intact. The clean author candidate then passed all 12 new
controller/native HTTP cases in 3.275 seconds and all 21 unchanged review cases
in 13.316 seconds, through separate normal-budget invocations. These are author
execution results, not served-browser or independent-review results.

The integrated source inventory preserves all 1787 old paths and appends five,
for 1792 sources at revision 53. Seventeen real case IDs (12 controller/native
HTTP, five served-browser) extend the registry from 3617 to 3634; registration
does not establish passage. One proposed capability extends the list to 230.
Only the licensing source-count observation/explanation changes. The existing
355 privacy runtime paths, fifteen surfaces and schema remain intact; only the
two assigned HTML/client hashes are refreshed. All 48 prior Python browser
assertion ASTs remain in lexical order and apply to their original nine scenarios.

## Remaining boundary

This is the existing local plain-browser/SQLite profile. New upstream draft
organization-approval work does not supply public delegated start/final-use or
receipt-signing endpoints. RCG-4B and the complete cross-service RCG-5 journey
remain blocked on those contracts and their actual qualified composition.
