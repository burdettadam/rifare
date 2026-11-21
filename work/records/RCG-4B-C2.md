# RCG-4B-C2 — Durable original delegated-command claims

State: bounded local development complete; formal milestone acceptance not performed.
Integration owner: root delegated maintainer.
Implementation writer: `command_consumer_impl`, separate assigned worktree.
Independent reviewers: `commerce_checkpoint_audit` (authority/security),
`receipt_regression_review` (regression).
Protected source: `031bd324ec270c4b75268928587f1bfbcba5a454`.
Integration branch: `feat/rcg4b-command-claims`.
Assignment: [ADR-0076](../../docs/decisions/0076-durable-delegated-command-claims.md).

## Outcome and boundaries

Implemented a strict local journal for complete original P03 START_USE and
FINALIZE_USE requests and their first bound response. Original UUID/digest and
FINALIZE challenge refusal identities survive cancellation, erasure, uninstall
and restore. Exact repeats converge, changed valid payloads conflict, and a
recovered duplicate cannot replace the first observed result. Recovery is derived
from the retained complete original, never a newly chosen identity.

The journal reuses the C1 codec, native customer proof, existing support-document
storage and typed privacy/restore owners. It adds no SQL migration, checkout
lifecycle, business operation, queue, lease or transport. Its constructor defines
a fixed local correlation partition; authenticated provider identity and native
purchase binding remain separate. Every public view is explicitly historical
and unverified, with false execution, provider-authentication and receipt-signature
flags. See [the guide](../../docs/DELEGATED-COMMAND-CLAIMS.md).

Public mutations reject an existing SQLite transaction and return after the
kernel's top-level commit. Initial and final native checks bind the original
customer/resource. Claim, observation and recovery preparation also enforce the
existing recovery/migration egress fence after the final callback-capable access
check. An inert SQL identity/digest/uniqueness fence follows those checks.
Historical reads and cancellation retain current-proof access.

Typed lifecycle handling covers original subjects without live resources,
reassignment, held data, erasure, uninstall, safe recovery and first/repeated
merchant import. Current suppression defeats replayed personal content and
obsolete holds. Restored claims are permanently retired/minimized; unsuppressed
held personal history prevents restoration atomically. No minimized original can
be repopulated from caller input or a copied package.

## Fixed candidates and verification

Initial clean candidate: `92f6753840c385de2bba2ebf54e3f6f8cd658cda`, tree
`f5304e68defdddb20549f44a20a01a7ffadef5fe`.
Corrected clean candidate: `0330376a0eb9f037441ddaf9b04699894dd9029c`, tree
`f7e169ea7cd9d0293cb88817d94a6188a8d409f7`.

The initial candidate passed 112 distinct registered cases in three ordinary
invocations. Regression review required only two missing transitive catalog pins
and corresponding assertions in the new catalog test. Those are the exact two
changed files in the corrected candidate. All other 1,811 source paths, including
every runtime module, existing test, oracle and dependency, retain their bytes.

| Final evidence | Cases | Executed source and treatment |
| --- | ---: | --- |
| New journal, unchanged codec and native recovery | 57 | Executed on 92f6753; retained by verified unchanged inputs |
| New command privacy and unchanged intent privacy | 38 | Executed on 92f6753; retained by verified unchanged inputs |
| Process durability and corrected catalog | 8 | Fresh execution on 0330376, 3.408 seconds |
| Entire privacy coverage file | 9 | Fresh execution on 0330376, 14.294 seconds |
| Distinct final cases | 112 | 47 new and 65 unchanged; 95 retained plus 17 fresh |

Every invocation kept the normal 60-case/four-file/60-second limits. Journal
planning estimates 59 while the actual file IDs establish 57: two existing regex
`.test` calls in the codec file inflate the static estimate. No selected case was
skipped, cancelled, unregistered or unrun. The initial journal invocation took
6.964 seconds; the initial 47-case privacy invocation took 22.919 seconds.
Only its two 19-case lifecycle files carry forward. Its nine coverage cases were
rerun because that file directly reads the catalog; they are not double-counted.

```sh
python3 tools/dev_tests.py --files tests/development/delegated-command-claims.test.mts tests/development/delegated-command-codec.test.mts tests/development/delegated-checkout-recovery.test.mts
python3 tools/dev_tests.py --files tests/development/delegated-command-privacy.test.mts tests/development/delegated-intent-privacy.test.mts tests/development/privacy-coverage.test.mts
python3 tools/dev_tests.py --files tests/development/delegated-command-process.test.mts tests/development/delegated-command-catalog.test.mts
python3 tools/dev_tests.py --files tests/development/privacy-coverage.test.mts
```

Actual raw reports and SHA-256:

| Report under ignored `evidence/development/` | SHA-256 |
| --- | --- |
| `20261121T205456.810354Z-a15e77/report.json` — 57 initial cases | `a19e68f999b86cec6b162d30e8756eabefe81d8ba26098f1f39f6ecbb7100609` |
| `20261121T205403.064226Z-b00312/report.json` — 47 initial privacy cases | `839691c230ce46365fcb6708c9282d70ea3ff3357de33e5d942cdd3114fd16a2` |
| `20261121T210112.770913Z-8993e9/report.json` — eight corrected process/catalog cases | `85b67ee19c7bbadb6de61a1d437bebd27f91e1cd9f052af033c816f3ff882538` |
| `20261121T210203.512200Z-ca512c/report.json` — nine corrected coverage cases | `dfe685328d256099d44a50f3222f56c70b102914a407d15476d92543dedd4ca8` |

The initial finite source/runtime record is
`evidence/rcg4bc2-verification/candidate.json`, SHA-256
`a2f3ad41ed2c5a0299173cbbb08d066ecb2dc384bbb714169b531de91383b130`.
The correction record is `correction-equivalence.json` in that directory,
SHA-256 `e2a3dba5b3a0673169326da4509b8089791895324e90c15ee63c6d111b479332`.
Both reviewers independently checked all 1,813 actual/report/Git source hashes,
the two-file delta and five retained test input graphs. The graphs exclude the
changed catalog/test; static discovery remains a bounded aid, not universal
dynamic-input or whole-host qualification.

Actual runtime: Node `v24.22.3`, executable SHA-256
`acbe4b8d9153b841ed0697cbfc4f93e767386620edb745ab9358306c0a6f31aa`.
The existing optional JOSE `6.2.18` install has 80 files and tree SHA-256
`8247cbabe4fe086e6330038cc15353b9f5cd001dd7650916657e68de4e6cf863`.
Source manifests, dependency locks and both installed runtime observations remain
unchanged. No browser execution graph changed or new browser pass is claimed.

### Actual process loss and contention

The four process cases use separate Node children and file-backed native SQLite.
A disposable IPC barrier confirms a completed commit without delivering the
application result. The parent issues SIGKILL, observes process exit and starts a
different process to read the same original or repeat its first observation.
Two other children announce entry while a parent BEGIN IMMEDIATE transaction
holds the real database write lock; neither can return until release, after which
both converge on one row. A changed valid payload from a replacement process is
refused. Native/source effects remain unchanged. No provider attempt occurs.

### Exploratory implementation history

The writer's five assigned files landed in native `247dc15`, followed by the
recovery-fence correction `5cafb07`; root integrated them as `a401ddf` and
`6912ff8`. The first twenty-case exploratory run passed before root identified the
restored-store read-permission exemption. The correction added initial and final
egress fences and late-quarantine rollback assertions within the same twenty
cases; its exploratory run also passed. These dirty writer observations are not
the final fixed-candidate evidence above. Their report SHA-256 values are
`ac4746f1cd8d9479b40a7e7370f2f6c49e2fa9afac4b34598378536326207620` and
`c7863fc61428a861d3a0658f84e765c9f7347fb260949f0046e650b4cdbd26b2`.
Root retained copies under `evidence/rcg4bc2-review-evidence/`.

An initial integrated 57-case pass on `4e5bb26` preceded restoring the original
privacy source-pin ordering. It is superseded by the clean 92f6753 run; no extra
cases are added to the denominator for repeated observations.

## Independent review and targeted faults

Both roles independently reviewed the corrected candidate and the actual reports
without authoring product code, tests or oracle. One medium regression finding
was corrected within the allowed review rounds; no scoped blocker remains.

| Role | Reviewer | Corrected verdict | Immutable review SHA-256 |
| --- | --- | --- | --- |
| Authority/security | `commerce_checkpoint_audit` | No remaining scoped blocker | `ebfd19385487996b5f84317955a527891c66b80dd645fefb24778edebad844c7` |
| Regression | `receipt_regression_review` | No remaining scoped blocker | `64c18548dbaffaa530a4e9c7c6f557a152ea029230a1c03a991026fcb99e8b7f` |

Byte-identical reviews are retained under `evidence/rcg4bc2-reviews/`. The original
regression round-one review remains unchanged, SHA-256
`93be497b5f9d1264f8c62dc0a28617f0ab0aa2787d67afa4f861f005bfe308e4`.
Its provisional 104-case carry proposal is superseded by the reviewed 95/17 split.

Each reviewer also ran one isolated deliberate source fault on the finished
journal, preserving its twenty-case file and all other inputs:

| Isolated fault | Mutant commit | Actual native result |
| --- | --- | --- |
| Remove only same-ID command-digest equality | `8f886f1ab8d2c09f2395bed52b425a208f0b44c3` | 17 passed, three behavioral failures: IDENTITY, CANCEL and INTEGRITY report missing expected rejection |
| Remove FINALIZE challenge non-reuse | `543d531f3b92276fd23440a89a08674e96f48977` | 19 passed, one behavioral failure: FINAL-CHALLENGE reports missing expected rejection |

Digest-mutant report SHA-256:
`e34c276d2b8ac3af0b3a8850cf3caafe4d5f27b48244b1885b90858e3eead587`.
Challenge-mutant report SHA-256:
`a91371a9736ec4b07a3f15ca09d8075f050f77c7a79a63d283502aa6bd56a7b9`.
All twenty actual cases ran in each file with no skips or setup failures. The
unchanged wrapper reports zero aggregated cases after a failing subprocess; raw
XML/TAP establishes the actual 17/3 and 19/1 outcomes. Neither fault enters the
product branch. Their target modules, test, helper, oracle, runner and runtime
retain identical bytes in the corrected candidate; no second mutant execution
is claimed after the catalog-only correction.

## Catalog repair and preserved controls

Protected 031bd32 failed the actual catalog validator with
`ADAPTER_CATALOG_UNDECLARED_ADAPTER_SOURCE`: the C1 command codec was the sole
undeclared adapter and all existing pins matched. The direct protected-source
observation is retained at `evidence/rcg4bc2-scout/catalog-fault.json`, SHA-256
`f5a1d18113dc7dd80a9094677166fad8ff6040c918174aea547a6a0df48cad78`.
The assigned additive repair declares four existing codec operations and all
twenty existing codec cases, preserving every earlier expected row.

Regression finding `RCG4BC2-REGRESSION-01` demonstrated that the initial catalog
still admitted the deliberately changed records module because its two new
transitive privacy dependencies lacked pins. Its direct observation SHA-256 is
`60cd387045f601805049ff1c32be72dbf024989b21eb218536911aef5e1d0918`.
Corrected 0330376 appends precisely those two pins and strengthens the new
CATALOG-PINS assertions. No runtime change or old test weakening was required.

Final catalog totals: 47 adapters, 225 operations, 328 referenced native cases
and 47 direct fixtures. Its 256,149 canonical bytes remain below the unchanged
262,144-byte limit. Removing only the codec additions reproduces the entire
protected expected-coverage canonical SHA-256
`823c2dc824bcf515a909cb82594dc7dd5099c3ef055a5bdeaa17e6635f7cbfb0`.
The existing nested catalog test still contains its earlier 38/199/262 counts
despite protected 031bd32 already having 46/221/308. That separate pre-existing
broader gate is deferred and unclaimed; its assertions/runner remain unchanged.

All 1,800 prior source members, 3,659 test registrations, 231 capabilities,
399 protected entries and 46 migration files remain. Final totals are 1,813
sources, 3,706 cases and 232 capabilities. The new capability remains proposed,
not formally accepted. Licensing changes only actual source count/reason.
The independent C1 synthetic oracle retains SHA-256
`a01e0ce41eec664f0e4275411c1d14abbbc7433bcda7934017c66f57587f5b19`.

Privacy preserves its schema and 15 surfaces, retains all 356 prior runtime-pin
positions, refreshes exactly three changed lifecycle hashes and appends three
runtime modules for 359 pins. Catalog changes preserve all old adapter/contract/
operation/case rows; only the assigned three lifecycle hashes and additive
expected-coverage hash refresh. Five new oracle pins cover the C1 contract,
synthetic oracle/test and the two new transitive privacy modules. Structural,
plan-contract, generated-view and diff checks pass without claiming full product
regression or acceptance.

## Publication, closing equivalence and next work

The published assignment [4996c0b](https://github.com/burdettadam/rifare/commit/4996c0b39f45cbcbd00da0cfc6cc019b700da5eb)
matches native `282c5d5`; the pre-catalog pin clarification
[81bf65b](https://github.com/burdettadam/rifare/commit/81bf65b64f4c138fa23de5e24c1a87e5800f0f3d)
matches native `8d4f709`. Both precede implementation publication.
Published initial candidate [2eec174](https://github.com/burdettadam/rifare/commit/2eec1741b1ec5e9045c8622e1ae445dfaa553c8e)
has the exact 92f6753 tree. Published corrected candidate
[9a5133c](https://github.com/burdettadam/rifare/commit/9a5133cf9ec3225af25984051396cfd8d2c95577)
has the exact 0330376 tree. A fresh native fetch confirmed both tree identities.
Tests ran on the named native commits; GitHub-authored public commit identities
are not substituted for those executions.

Closing changes are limited to this record and current descriptions in
ARCHITECTURE, PLANS, ROADMAP, DELEGATED-COMMAND-CLAIMS and
DELEGATED-COMMAND-CONSUMER. Source/runtime/test/inventory equivalence and both
closing review attestations bind the final documentation tree before publication;
publication commit metadata records those attestations. Raw reports remain
ignored local evidence; this record preserves decisions and hashes without
claiming remote raw-report storage. Native history is retained separately.

The final upstream snapshot inspected for this checkpoint is open draft
[`3d1f699171ecb6facd4be522bd1fde6661c2f6a1`](https://github.com/ElevenID/marty-ui/blob/3d1f699171ecb6facd4be522bd1fde6661c2f6a1/docs/delegated-use-runtime-candidate.md),
with Protocol still `6126da7619e057be2ff58dd38a5d50f49891d1b3`.
The authority closing review caught this concurrent advance after the earlier
1063f32 read. The default-off `marty-delegated-use` executable now assembles
concrete internal owners, fourteen restricted database connections and mandatory
mutual TLS for the selected managed-organization/full-machine/KEY/EXACT_OPERATION
profile. Public Gateway/wallet/client contracts, deployed credentials, CA/pin and
role/network/custody qualification, selected attestation and independent public
consumer verification remain open. Native purchase binding and business
permission remain Rifare-owned.

The pinned runtime-candidate document has blob
`d9e87d7d9120d2f3ff529d17180481efeda07f46`; its
[milestone record](https://github.com/ElevenID/marty-ui/blob/3d1f699171ecb6facd4be522bd1fde6661c2f6a1/docs/agent-trust-runtime-milestones.md)
has blob `76ab0aac87e7d78e827eda371e2b2a4fe6f8b86e`. These are source/document
observations, not new provider test executions. Closing descriptions were
corrected before final documentation attestations and publication; the earlier
1063f32 source checkpoint remains historical evidence.

Continue RCG-4B with the selected public authentication/current-state and
original-result contracts, authenticated tenant/typed-actor namespace and
independent native purchase binding, then compose real transport around this
journal. Preserve existing execution, approval, reservation, budget and business
idempotency owners. No private-provider-storage bridge is authorized. Full
isolated RCG-5, connected RCG-6, target React/PostgreSQL, formal acceptance and
production qualification remain open. Feature publication uses `[skip ci]`;
no Actions dispatch, default-branch merge, release, deployment or paid expansion
was performed.
