# RCG-4B-C4 — Local checkout command access

State: bounded local implementation and focused review complete; formal acceptance not performed.
Protected base: `e8a0152825711bea81df29b8d9b035fea01ea035`.
Integration branch: `feat/rcg4b-command-http`; owner: root.
Implementation writer: `command_consumer_impl`, separate assigned worktree.
Independent reviews: `commerce_checkpoint_audit` (assignment authority/security),
fresh `c4_authority_review` (final authority/security), and
`receipt_regression_review` (assignment/final regression).

The owner requested continued development after the published C3 checkpoint.
[ADR-0078](../../docs/decisions/0078-local-checkout-command-access.md) assigns
separate local customer command routes through the existing API/server/Python
client, using C3 native START and C2 original history/recovery/cancel. The same
assignment corrects four explicitly identified native composition boundaries
that currently dispatch through overridable instance methods.

Provider `37b7fdc3d3f1c223613ad98fe601d7d86e6a3600` now documents an actual
internal managed network lifecycle; Protocol remains `6126da7`. Public
consumer/wallet selection remains open. This is source inspection; no provider
test or external call is authorized by the local command route.

Preserve all existing checkout/recovery routes, stored records, native business
and privacy owners, tests, fixtures and migrations except assigned source-count
and actual pin refreshes. Raw/observe/FINALIZE/send routes, new context authority
and default-branch/release/deployment actions are outside this scope.

## Assignment and independent assertions

Native assignment `61f0dfac6b769d7829f95ea0b669b012f4ca2cf4`, tree
`5230fb013b5f6bd140b572f240aac90ba678dfad`, was published before product changes
as exact-tree `8f38faff84824d3ca01e8c2b3c5349af131659a2` on the new feature branch.
Both independent reviewers read the full ADR and found no assignment blocker.

Root wrote twelve owner-binding cases before integration, committed at
`cc0cbcd081a427325e8a7572d143c076b3d147f4`. Against the unchanged protected
product, all twelve reached their intended behavioral assertions and failed:
forged owners accepted, instance shadows called, API authorization bypassed,
closed receipt availability bypassed and accessor containers accepted. There
were no import, setup, syntax or skipped-case failures. The actual negative
execution took 1.942 seconds; native XML records 12 executed, 0 passed, 12 failed.
The failed-wrapper `actual_tests: 0` is bookkeeping and is not its denominator.

Raw report: `evidence/development/20261121T234210.227298Z-5098b9/report.json`.
SHA-256: `912e25366fb1f19a1be4802fab115e201c30f99f843f571ee299d6bc9cee863f`.
The assertions remain unchanged for final candidate qualification. Root separately
committed twelve independent copied-client cases at
`1deda2086808702a959b486e08d45faff7485f68`. The implementation writer owns the
separate twenty-case HTTP file and writes it before implementation.

## Implementation and fixed candidate

Writer commit `a4ededbc602a905b090ccb75e3f17dcec94fc201`, tree
`2803b431fd9cfd82e803683f67a91c5801547bb6`, changed exactly its eight assigned
paths. Root integrated it as `20cd8c4`, retained the independently authored tests,
and appended the assigned controls. Final clean tested candidate:

- Native commit: `ecc34e584c75fdc91ab2831be57cd23af03f750a`.
- Tree: `390a5a18c7817fcb4f45cf722cf78ab15adfae91`.
- Published implementation: `6000723db5ff05d64f094f1fcef1b6553296996f`.
- Public parent: `8f38faff84824d3ca01e8c2b3c5349af131659a2`.

The public implementation has the exact tested native tree. No corrective product
round was needed. The writer's single exploratory HTTP run passed 20/20 in
3.789 seconds at the dirty assignment head, before registration. Its report is
`rifare-command-http-impl/evidence/development/20261121T235301.978727Z-a7478b/report.json`,
SHA-256 `360860123c521a1a3d7572d8a8619fe2a742305edd1e656b09c2b700f45c99ed`.
The eight implementation hashes matched the writer commit. This exploratory
observation is separate from the final clean-candidate evidence below.

The implemented family exposes contract, actual native START retention, original
status, unsent recovery and revision-bound cancellation. Fixed server correlation
constructs one private existing journal owner. History works without live START
configuration. The four assigned composition boundaries use concrete native
private-brand checks and captured methods; receipt closure and API authorization
cannot be replaced by instance shadows. The Python caller independently binds
response identity, canonical bytes/digests, historical state and false authority
flags. No provider request or business execution is introduced.

## Fresh focused evidence

All **200 distinct cases** passed freshly on clean `ecc34e5`: **44 new cases and
156 unchanged existing cases**, across thirteen whole files. Every invocation
retained the normal 60-case, four-file and 60-second limits. There were no skipped,
unregistered, cancelled or unrun final cases. Nothing was carried from a different
implementation candidate.

| Whole-file selection | Actual passes | Elapsed | Report directory under `evidence/development/` |
| --- | ---: | ---: | --- |
| New command HTTP, old checkout HTTP, old recovery HTTP | 55 | 10.897 s | `20261121T235414.947392Z-60bb98` |
| New copied command client, old checkout client, C2 claims | 51 | 16.223 s | `20261121T235414.990153Z-b122b3` |
| New owner binding, old native receipt, old intents | 57 | 10.742 s | `20261121T235414.994408Z-21d409` |
| C3 START, C2 process, privacy coverage, bounded catalog | 37 | 20.114 s | `20261121T235414.962005Z-3bacde` |

The four corresponding `report.json` SHA-256 values are, in table order:

1. `19c1c7dc9dd00bbff46e0a6ab67386491a2c3195b97ccc84fda334257cb36704`.
2. `f90b415e02ad298e2b0e7d9cc04cb9fee937e9ecb39c72b128dff0d1e956ab60`.
3. `e8c9af97819088c6ed4375705bf2f07ad2c1ba71c0eb862452e60989bb5973c3`.
4. `bf0dabc443b5ad7a6579573c9ade36511e441067c8a127501bac1239eecd3b33`.

The source/runtime/raw manifest is `evidence/rcg4bc4-integration/candidate.json`,
SHA-256 `df81eb2c728c4b7d76a2907894d98632015c3cc60f43a4f8042e0f9a8d05d675`.
It verifies all 1,829 local source hashes against native Git, every report's exact
source map, raw XML/log hashes and actual case IDs. Repository structure,
retained-plan validation, generated views and `git diff --check` passed.

Runtime observations are Node `v24.22.3`, optional JOSE `6.2.18` and isolated
Python `3.12.14`. Node SHA-256 is
`acbe4b8d9153b841ed0697cbfc4f93e767386620edb745ab9358306c0a6f31aa`;
JOSE's 110-entry/80-file tree is
`8247cbabe4fe086e6330038cc15353b9f5cd001dd7650916657e68de4e6cf863`;
the Python executable is
`fa67443527ed9647f760d807e2a38f26340757123e643c4639cf273ed15d5ea7`.
The manifest also records selected Python standard-library hashes. These are
bounded runtime observations, not whole-host or universal dynamic-input proof.

New loss tests deliberately drop an HTTP response after an actual native commit
and replace the server while retaining the same original journal. Existing C2
cases separately exercise actual process loss and SQLite contention. The new
held-erasure route case seeds the exact existing native marker; the prior C3
lifecycle record supplies execution through the actual typed privacy owner.

## Preserved controls

All 1,821 prior source members remain, with exactly eight assigned additions.
All 3,734 prior case registrations retain their original rows; 44 are appended
for 3,778 total. All 233 prior capabilities remain, with one proposed capability
appended for 234. The 399 protected rows, 46 commerce migrations, acceptance
ledger, old tests/helpers, browser assets, runners and dependency versions are
unchanged. The original checkout/recovery contracts and C1/C2/C3 runtime, stored
records and privacy owners are unchanged.

Privacy keeps all 360 runtime-pin positions, all fifteen surfaces and the exact
schema digest `1be56171e04e051e0402ac4ccb339b0f1c910a09f8f358001e0a3e62cb70ff3b`.
Only API/server/receipt/intent source hashes refresh; no surface prose or schema
changes. Catalog oracle pins refresh those same four hashes and append the
actually reached C2 claim owner, C3 START owner and new route contract. Its
adapter, operation, case and expected-coverage rows remain unchanged. Canonical
catalog bytes are 256,569 within the unchanged 262,144-byte bound. The licensing
fixture changes only source count and its explanation. The legacy nested catalog
38/199/262 literals remain an unchanged, deferred broader-gate issue.

## Independent reviews and targeted faults

Both final independent reviewers found no remaining scoped blocker. Neither
authored product code, tests, fixtures or oracle. Their review JSON records are:

- Authority/security: `evidence/rcg4bc4-reviews/authority/review-ecc34e5.json`,
  SHA-256 `a377338c6d9eb788d67f93649d1ac7e2275b596f2332ceb445c651f586370f5a`.
- Regression: `evidence/rcg4bc4-reviews/regression/review-ecc34e5.json`,
  SHA-256 `45ed3f0a1959344a5d7fca9f9f04877577acc0c8485b2985688cb8f14d20424f`.

The original authority review model session failed authentication after preparing
mutant `011bb603020ebe98936f3250630fb87e77449749`; that worktree has no completed
test report and remains preserved. Fresh independent `c4_authority_review`
performed the final authority review and the single completed fault execution.
This interruption is not a product failure or a passing review.

| Fault | Isolated commit | Actual unchanged-file result |
| --- | --- | --- |
| Restore instance pre-body authorization | `2ea829ef2e574110b6e748eb2c4955d8cbf01dfe` | 20 executed, 19 passed, one intended 413-versus-404 failure. |
| Remove caller-to-result original UUID comparison | `bd45664fc027b082a30805470cdc721b6a325f3d` | 12 executed, 11 passed, one intended wrong-original acceptance failure. |

The first raw report is under
`rifare-c4-concrete-auth-mutant/evidence/development/20261121T235714.895011Z-808785/report.json`,
SHA-256 `c63c3a62ba0fbf856337d379d1b4273485ab714fb87dad8f958cafcb10cf818f`.
The authentic noncustomer request sent only headers and remained unfinished.
Its 413 shows it reached announced-length body handling; collection of oversized
body bytes is not claimed.

The second report is under
`rifare-command-http-uuid-mutant/evidence/development/20261121T235601.544562Z-6f09d6/report.json`,
SHA-256 `13c149d02c130fdd8267c81a3dd74516fb385b0f78474040acb2982bcbd58f8c`.
The mutated Python caller accepted a complete, internally valid second native
original with exit 0, failing the expected refusal. No coupled failures occurred.
Both mutants were clean commits directly on the tested candidate. Their whole
test files stayed unchanged, imports/setup succeeded, and no cases were skipped.
Failed-wrapper `actual_tests: 0` is not either native denominator. Neither mutant
enters the product branch.

## Closing publication and continuation

The final closing change updates only six Markdown files: this record, ADR-0078,
ARCHITECTURE, PLANS, ROADMAP and the command guide. Its separately captured
`evidence/rcg4bc4-integration/closing-equivalence.json` verifies identical product,
tests, fixtures, controls, dependencies and runtime; all 200 original passing
executions retain their actual `ecc34e5` identity. Closing adds no product test
execution. Both independent closing attestations and this exact equivalence
digest are pinned in the public closing commit metadata, avoiding a self-hash
cycle. Native history is preserved separately before aligning the owned local
branch with the exact public tree. Publication uses `[skip ci]` and a checked
feature-branch lease; no Actions dispatch, default-branch merge or deployment is
performed. Raw reports remain ignored local artifacts; Git pins their identities
without claiming remote retention of those raw files.

The provider snapshot remains the inspected draft PR1994 at
[`37b7fdc3d3f1c223613ad98fe601d7d86e6a3600`](https://github.com/ElevenID/marty-ui/blob/37b7fdc3d3f1c223613ad98fe601d7d86e6a3600/docs/delegated-use-runtime-candidate.md),
with Protocol draft PR38 at
[`6126da7619e057be2ff58dd38a5d50f49891d1b3`](https://github.com/ElevenID/marty-protocol/blob/6126da7619e057be2ff58dd38a5d50f49891d1b3/protocol/delegated-authority/COMMANDS.md).
Its internal managed network lifecycle and receipt consumer are inspected source
facts, not provider tests executed here. Public Gateway/wallet/client selection,
authenticated namespace/current grant/actor authority, and independent
FINALIZE/proof/context composition remain next integration dependencies.

C4's evidence is finite local diagnostic qualification. It is not a full or
browser regression campaign, the legacy nested catalog campaign, hosted CI,
provider serving qualification, full RCG-5/6, target PostgreSQL/React or formal
acceptance. Configuration-object integrity is not whole-process isolation, and
masked/minimized history cannot recompute erased canonical content. Rifare keeps
business permissions, budgets, reservation, idempotency, execution and outcomes.
