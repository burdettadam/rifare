# RCG-2-NATIVE-CHECKOUT — Native synthetic checkout preparation

State: ready_for_review
Writer: root development agent
Integration owner: root development agent
Reviewer identities: `/root/native_authority_final` and `/root/receipt_regressions`; earlier findings by `/root/receipt_review`
Assigned scope/decision: [ADR-0067](../../docs/decisions/0067-native-checkout-previews.md)
Branch/worktree: `feat/rcg2-native-checkout`, isolated `rifare-rcg2-native` worktree
Source base SHA: `933600561a989150e2a2d3c4273a57ee84cdad52`
Formal goal acceptance: not requested or inferred

## Allowed paths and dependencies

Allowed runtime paths: `packages/commerce/checkout-preview.mts`,
`packages/commerce/checkout-previews.mts`,
`packages/adapters/checkout-quote-fixture-source.mts`, and
`packages/commerce/contracts/checkout-preview.v1.json`.
Allowed verification paths: new `tests/development/checkout-preview*.mts`,
new `tests/development/delegated-checkout*.mts`, and new checkout fixtures.
Allowed integration records: this work record, ADR-0067,
`docs/CHECKOUT-PREVIEWS.md`, `docs/ARCHITECTURE.md`, `docs/PLANS.md`,
`planning/regression-registry.json`, `planning/component-inventory.json`, and
only source membership/count fields in the licensing count fixture as permitted
by ADR-0008. Existing cart, authority, privacy and financial owners are reused.
After independent privacy review, additive runtime pins/classification in
`packages/commerce/contracts/privacy-storage-surfaces.v1.json` and explanation
in `docs/PRIVACY-COVERAGE.md` are also allowed; prior surfaces, schema, handling
and the accepted regression baseline remain intact.
The linked conformance source declarations and reviewed stale source pins in
`tests/fixtures/conformance/adapter-catalog.v1.json` and
`tests/fixtures/conformance/expected-coverage.v1.json` are included under the
documented ADR-0067 extension. Their behavioral expectations and case counts
remain unchanged; `docs/ADAPTER-CONFORMANCE.md` may explain the source addition.

Risk: current scope/customer authority, exact monetary facts and asynchronous
expiry. No existing commerce effects or public capabilities are expanded.

## Outcome and test contract

Issue and revalidate a server-owned immutable preview from a currently confirmed
cart and explicitly scoped, current shipping/fee observations. Source changes,
expired or absent quotes, changed customer proof, revoked sessions, erasure,
cross-scope lookup, input/dependency mutation and invalid clocks deny safely.
Preview reads cannot create a purchase, payment, reservation or authorization.
Preserve the existing 15-case `growth-shopping.test.mts` suite unchanged.
New `RCG2-*` test IDs are additive proposed development evidence.

## Checkpoints and observations

- The source base is a clean checkout of the public Rifare development branch.
- The unchanged shopping suite passed all 15 cases during the preceding audit.
- The staged composer audit reproduced configuration aliasing, nonintegral/torn
  completion clocks, and an in-flight mutable expiry/digest extension. New native
  tests must exercise those failures rather than simply copying implementation.
- Assignment is committed before implementation; no accepted-goal ledger,
  canonical goal, retained test specification or original behavioral oracle is
  changed by this assignment.

## Candidate and review

Candidate/configuration identity: runtime/test candidate `f71eb2044c859dba6b47c4cd00b1eea4aeba9788`; subsequent commits contain reviewed registration and records
Native test commands/results: 57 focused checkout/shopping cases passed; separate nine-case privacy suite passed
Meaningful failure/targeted fault evidence: recorded audit reds, independent early helper reds, late-authority red and retrieval-guard mutant detected
Independent authority/regression reviews: corrected runtime review closed; final registration delta review recorded below when complete
Acceptance owner and decision reference: no formal acceptance decision

### Local implementation checkpoint

The native owner, scoped quote fixture and hardened composer are implemented.
The first unchanged staged-composer run passed three and failed seven of the ten
new behavioral cases (including lifetime mutation, function replacement, torn
and fractional clocks, in-flight expiry mutation, accessor input and quote
deadline capping). The corrected implementation passed all ten. Independent
early helper review reproduced final-hashing expiry and malformed sparse-array
normalization; both added cases failed before correction and passed afterward.

The current focused native selection passes **55 cases**: 24 native checkout,
16 composer and all 15 unchanged shopping cases. The observed run completed in
7.310 seconds under the default 60-second budget. Raw report:
`evidence/development/20261120T003242.821850Z-aed90a/report.json`.
Full regression and formal goal acceptance remain false. Fixed-candidate review
and reviewed privacy-source registration are still pending at this checkpoint.

The offline TypeScript checker traverses existing native dependencies. Both the
unchanged base and candidate produced the same **557 strict-type diagnostics**;
the exact diagnostic set has no additions or removals. New files add no diagnostic.
The initial new-test erasure-result field was corrected to the existing
`logically_erased` status. This comparison is not a clean whole-repository
typecheck. Plan, generated-view, repository-structure and distribution checks pass.

### First fixed-candidate reviews and correction

Both independent reviewers examined
`874235f8f476038f239e33a1c99eccf909c08b94` against the source base.
`/root/receipt_review` reproduced authority loss during the final quote read:
session expiry/revocation, proof change or store disablement could return a still
fresh preview. The correction repeats native customer/proof and recovery guards
after final source callbacks and hashing, then checks completion time against
the original preview and session deadlines.

`/root/receipt_regressions` verified every prior registry row, source member,
shopping test/fixture and retained criterion was preserved. It reproduced a
surviving mutant that removed only revalidation's final guard. A new case now
exercises asynchronous authority loss through both `read` and `revalidate`.

`RCG2-NATIVE-AUTHORITY-AFTER-FINAL-SOURCE-CALL` first failed with the behavioral
assertion “Missing expected rejection” against the fixed reviewed candidate.
After correction, all **57 cases pass**: 26 native checkout, 16 composer and
15 unchanged shopping cases, in 9.611 seconds. The authority case exercises
preparation/read/revalidation with actual session expiry, revocation, changed
proof, logical erasure and uninstall. Raw report:
`evidence/development/20261120T004009.436375Z-40eb59/report.json`.
Corrected fixed-candidate review remains pending.

Independent native/Python conformance at the first candidate passed against
oracle commit `08fa2414a850fda7a063877a554020d18356781c`. The native composer and
actual Rifare digest owner retained the fixed USD 68 vector; recomputed-digest
price, product, terms and membership forgeries all failed the oracle's exact
independent source comparisons. The composer blob is unchanged by the native
authority correction.

### Privacy registration and inherited source drift

Before writing new source pins, the unchanged-pin assertion detected ten stale
hashes already present at the clean source base. The initial proposed refresh
aborted without modifying the contract. All ten are the paths in historical
formatting commit `85c547ac396e6ec897d65b9093fc8353550b306d`: their declared pins
match its parent, and pinned Prettier 3.9.10 reproduces all ten current files byte
for byte from those parent bytes. The existing formatting lockfile/configuration
and every prior runtime source remain unchanged. Raw reproduction:
`evidence/rcg2-inherited-format-pin-review.json`.

The clean source base's privacy audit also reports
`PRIVACY_RUNTIME_REVIEW_REQUIRED`. ADR-0067 records the bounded inherited-pin
correction before the contract change. Independent review and the exact privacy
case rerun will accompany the source metadata refresh; this does not rebaseline
accepted product behavior.

The refreshed direct privacy audit reports 343 current sources and all fifteen
surfaces, with qualification/physical-erasure claims still false. The focused
privacy suite then passed eight cases and exposed the linked adapter catalog's
stale source pins in its ninth case. Those include nine of the reviewed formatting
files and the old command-manifest fixture hash. The latter differs from the
current already-landed fixture only by its root `package.json` digest. ADR-0067
records their review and the required new quote-fixture source declaration before
changing either conformance inventory. All 45 adapters, 220 operations, 297 native
case bindings and 47 direct fixtures remain the retained catalog contract.
The older full catalog test still asserts 38/199/262; those already-stale assertions
are outside this source metadata correction and remain unchanged. No complete
adapter-catalog regression pass is claimed.

### Corrected runtime review and completed local checks

The fresh independent authority reviewer `/root/native_authority_final` reviewed
`f71eb2044c859dba6b47c4cd00b1eea4aeba9788`. All eight earlier independent
late-authority reproductions now deny. Its full 26-case native checkout run
passed in 6.392 seconds. It found no remaining blocking authority or storage
defect in the bounded scope and independently reproduced the ten historical
formatting hashes. `/root/receipt_regressions` separately closed the retrieval
guard coverage finding: removing only revalidation's final guard now causes
`RCG2-NATIVE-READ-REVALIDATE-FINAL-ASYNC-GUARD` to fail behaviorally.

Reviewed runtime blobs remain:

- Composer: `62add1deb6181c62e714f08fc2c1d534f85ca61a`.
- Native owner: `af4ab038eb373d79fc8fda1d67ed059aec67a866`.
- Quote fixture: `bf82047c702eea44c48adfe2d009c5a9ccb41b9b`.

The source registration retains all fifteen privacy surfaces, prior handling
clauses and SQL/table assignments. It adds three runtime pins and implementation
paths, refreshes only ten reproduced historical formatting pins, and registers
the new quote fixture under the existing shopping source. The adapter catalog
refreshes only the nine duplicate formatting pins, one historical command-manifest
pin and the dependent source-coverage hash. All existing catalog operations,
scopes, versions, native cases and direct fixtures remain identical.

The separate unchanged nine-case privacy suite now passes in 13.818 seconds:
`evidence/development/20261120T005824.702527Z-b6fb97/report.json`.
The direct privacy audit reports `local_inventory_current:true`, 343 runtime
sources and unchanged schema, while all deployment, physical-erasure and privacy
qualification claims remain false. Direct adapter-catalog validation passes with
45 adapters, 220 operations, 297 native cases and 47 direct fixtures.

These are bounded development and source-registration checks. They do not erase
the 557 inherited strict-type diagnostics, repair older full-catalog count
assertions, execute the complete regression gate, or accept any formal product
milestone. No original test, behavioral oracle or accepted baseline was weakened.

## Next action

Retain the reviewed branch in Git and verify remote publication if available. Durable checkout
execution, the sender-bound remote profile and provider authorization remain
separate milestones.
