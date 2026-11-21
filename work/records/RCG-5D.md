# RCG-5D — Receipt evidence in customer checkout review

State: implemented; bounded local verification and both independent reviews complete
Integration owner: root delegated maintainer
Implementation writer: `receipt_review_impl`, separate assigned worktree
Recovery reviewers: `commerce_checkpoint_audit` (authority/security), `receipt_regression_review` (regression)
Assigned scope: [ADR-0074](../../docs/decisions/0074-checkout-receipt-review.md)
Integration branch: `feat/rcg5-receipt-review`; recovered checkout: `rifare`
Protected source base: `4ac855602b80652d76c54b6da25fcb905c57cdbe`
Verified implementation candidate: `40fc9738743fd6555ded780b4e5457e2e72f965f`
Candidate tree: `58338d9a2311caaeb20c20fc483f842e275c174d`

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

## Implementation history

Implementation author: `05156f0a8935845ed34a8fc59b95530ac2fc1f8f`, integrated as `715c56f`
Meaningful behavioral red: observed on clean `f4cb5e79abff89e471142b274b66d52963ee3639`
Author controller/native HTTP results: 12 new and 21 existing passed
Current integrated results: 33 controller/native HTTP and 14 actual served-browser cases passed
Independent authority/regression review: both found no scoped blocker on `40fc973`
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

This is the existing local plain-browser/SQLite profile. Checking receipt evidence
does not authorize execution, place an order, move money or establish a provider
outcome. Full regression, formal acceptance, remote sender-bound access, target
React/PostgreSQL, comprehensive accessibility and production qualification remain
separate. The provider boundary and next work are recorded below.

## Recovered checkpoint and current verification — 2026-11-21

The recovered conversation and RCG-5C bundles were older than live GitHub. A fresh
fetch found the complete RCG-5D implementation at public `40fc973`, whose tree is
identical to native `ea3021631950ef549ea15bdc9817bd5376f5495d`. The continuation
therefore verified that existing implementation rather than replaying it. Root
remained the sole integration writer and reassigned the two independent review
roles to the recovery agents named above, each in a separate clean worktree.
Neither reviewer authored the implementation. No product correction was needed.

The following are new executions on clean `40fc973`, not carried RCG-5C results:

| Complete focused selection | Passed | Invocation elapsed | Execution |
| --- | ---: | ---: | --- |
| New receipt controller/native HTTP plus existing checkout controller/native HTTP | 12 + 21 | 16.422 s | Local supported Node runtime and real native loopback API |
| New receipt served-browser file | 5 | 23.219 s | Existing authorized AWS Linux development host |
| Existing checkout served-browser file | 9 | 37.446 s | Same isolated checkout and host |

All 47 registered cases passed, with zero failures, skips, cancellations,
timeouts or unrun selected cases. Each invocation retained the normal 60-second
budget. These are focused files, not the full product suite. Reports explicitly
retain `full_regression: false` and `goal_accepted: false`.

Commands were the normal `python3 tools/dev_tests.py --files ...` entrypoint:
the local invocation selected both controller files; each browser file ran in
its own invocation. Exact source paths and reproduction commands are in the
[receipt-review guide](../../docs/DELEGATED-CHECKOUT-RECEIPT-REVIEW.md).

| Original report under ignored `evidence/development/` | SHA-256 |
| --- | --- |
| `20261121T162808.027874Z-572275/report.json` — 33 controller/native cases | `cab46c7c39b21e2f3bdad2d4c22edd43fe67996003a0a895c4f17bc9ec9494a0` |
| `20261121T163526.481002Z-1d4e77/report.json` — five receipt browser cases | `b22d3e84e94265245377a215c5f73e68ea9904ae7531c5d36b9175c075481ef9` |
| `20261121T163549.752032Z-e0e92a/report.json` — nine existing browser cases | `e225dbc89bed8da2e233c48688d20ca84c5433b5eee224539c4a49a25b871fcb` |

The original AWS archive `rcg5d-browser-evidence.tar.xz` is 95,512 bytes with
SHA-256 `ea61d9144e55c298e511f5daa91e91f5f2a834f3636efdf0e72762d1028dbfa4`.
It contains both reports, original JUnit/TAP, the capture script and before/after
source/runtime records. All 13 indexed member hashes were verified after transfer
and independently by both reviewers. The local recovered originals are under
ignored `evidence/rcg5d-aws/evidence/`. Raw evidence is retained outside Git.

Before/after observations at 16:35:26 and 16:36:28 UTC identify the same clean
candidate/tree, all 1,792 source hashes and all 578 captured runtime-file hashes.
The browser configuration was Node 24.22.3, Python 3.12.3, Playwright 1.62.0 and
Chrome for Testing 151.0.7922.34. Runtime equality applies to that finite captured
set, not every host library, environment value, OS component or installed JOSE
file. Separately, the optional locked JOSE 6.2.18 installation verified 80 files
and tree SHA-256 `8247cbabe4fe086e6330038cc15353b9f5cd001dd7650916657e68de4e6cf863`.

The existing host was used because the local environment lacked the Linux
own-children interface required by the unchanged browser guardian. An isolated
checkout preserved the prior checkout and runtime. Every browser wrapper passed
its actual served-page, native state/effect and owned-process cleanup assertions.
This is not a fresh forced-kill lifecycle campaign or whole-host isolation claim.
The existing six-hour auto-stop timer was still active at 16:43:52 UTC. Other
development commands used this shared host during the run, so it was left under
that timer; the continuation's CloudShell terminal was closed.

## Independent review and source preservation

Both reviewers inspected the root-executed original green reports, JUnit/TAP,
case identities and source/runtime captures. They did not independently rerun
the AWS browser suites. Their separate executions and fixed reviews are:

| Reviewer | Independent execution and conclusion | Fixed review SHA-256 |
| --- | --- | --- |
| `commerce_checkpoint_audit` | Nine supplemental adversarial controller/native probes passed; no scoped authority/security blocker. These are not added to the 47 registered cases. | `3a80ef3e47328a92c224c702b08c9b6b086122925651ab0a0203b08561dbdd4f` |
| `receipt_regression_review` | Reproduced the protected-base behavioral red after actual native preparation: one test failed at missing `receipt-panel`, zero skips; no scoped regression blocker on the candidate. | `7875a1afa9e3690c7ac0d2ab45cda8ffa2f47c8d745916b08b57e8fa5f624f8e` |

The fixed records are `RCG-5D-authority-review.md` and
`RCG5D-regression-final.json`. The supplemental probe result has SHA-256
`6325117043005df06d2a2fe8ace4e5b54fc0c367281c7cbc154ab77ff3f68e26`;
the independently reproduced red stdout has SHA-256
`3b5730f19a1ad01d1614127639f4accab31c7837897c2b447895e4a2b2355635`.

Review preserved all 1,787 prior source members, 3,617 prior case registrations,
229 prior capabilities and all 48 original browser assertion ASTs in lexical
order. The original 21-case controller file and nine-case browser entry file are
unchanged. All 399 protected registrations remain; 398 contents are identical,
with only the assigned licensing source-count observation changed. The existing
355 privacy paths and fifteen surfaces remain, updating only the assigned two
HTML/client pins. Native owners, API/recovery, server/CSP, migrations, dependencies,
acceptance ledger and workflow controls are unchanged.

The closing checkpoint changes only seven existing documentation files: this
record, ADR-0074, `PLANS.md`, `ROADMAP.md`, `ARCHITECTURE.md` and the two checkout
review guides. All other tracked blobs and modes remain byte-identical to tested
`40fc973`, with no added or removed source member. Independent documentation
equivalence attestations are retained alongside the fixed reviews. This carries
the named executions by explicit source equivalence; it does not claim another
test run on the documentation commit. Repository, canonical-plan, generated-view
and whitespace checks also pass; the 55 active packets, 949 specifications and
27 integration follow-ups remain unchanged.

## Provider checkpoint and next development boundary

The 2026-11-21 refresh inspected open draft provider
[PR #1994](https://github.com/ElevenID/marty-ui/pull/1994) at
`f226585513c7ca57148cab1dd1af7a68cab7591b`. Its
[runtime candidate](https://github.com/ElevenID/marty-ui/blob/f226585513c7ca57148cab1dd1af7a68cab7591b/docs/delegated-use-runtime-candidate.md)
now includes internal retained start/finalize use, authenticated internal
transport, concrete nested JWT-VC verification, durable machine audit, actual
Flow/receipt transaction ownership and managed receipt signing with a disposable
TLS OpenBao/Redis gate. These replace the earlier observation that those internal
pieces were absent. They remain provider-reported scoped evidence, not executions
performed during this Rifare continuation.

The [internal transport contract](https://github.com/ElevenID/marty-ui/blob/f226585513c7ca57148cab1dd1af7a68cab7591b/rust/services/delegated-authority/USE_HTTP.md)
still has no executable/public Gateway composition. Qualified full-machine/MAP,
issuer/status, required attestation and current policy sources; authenticated
wallet/proof ingress; reviewed serving roles; deployed HTTPS receipt custody;
independent public consumers; and unresolved-claim reconciliation remain open.
Public support/discovery is unchanged. `FINAL_USE` remains `EVIDENCE_ONLY`.

The next dependency is the provider's qualified public current-state, start/final
use and original-result contracts. Once those exist, assign the bounded RCG-4B
Rifare adapter against them, then qualify the full isolated cross-service RCG-5
journey and connected RCG-6 profile. Do not rebuild completed local receipt UI,
invent public routes, read private provider storage or copy provider internals.
Rifare retains orchestration, domain permissions, budgets, reservations, business
idempotency, provider execution and business outcomes. An uncertain original
operation must remain unresolved until its specified recovery contract supplies
evidence; a receipt alone cannot authorize a replacement or repeat execution.
