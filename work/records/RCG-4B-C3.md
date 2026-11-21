# RCG-4B-C3 — Native checkout START_USE claims

State: bounded local development complete; formal milestone acceptance not performed.
Integration owner: root delegated maintainer.
Implementation writer: `command_consumer_impl`, separate assigned worktree.
Independent reviewers: `commerce_checkpoint_audit` (authority/security) and
`receipt_regression_review` (regression).
Protected source: `f4cd7f1d4df569a2bfd22c7540041e0336f72d64`.
Integration branch: `feat/rcg4b-native-start`.
Assignment: [ADR-0077](../../docs/decisions/0077-native-checkout-start-claims.md).

## Outcome and boundaries

The concrete `DelegatedCheckoutStarts` owner now constructs P03 START_USE from
an actual current checkout preview for the same kernel. Its closed input accepts
only the original command UUID and preview ID. The native owner supplies the
fixed purchase action, resource, store audience, request profile and complete
preview digest. C1 remains the canonical encoding and validation owner.

The source captures concrete native methods, validates private owner identity,
detaches and freezes the configured grant reference, and keeps only weak
provenance for each returned binding. The original opaque Scope and actual
preview object must match on each currentness assertion. Copied data, another
source or Scope, expired or changed previews, closure and process loss cannot
reconstitute current purchase proof.

The additive `DelegatedCommandClaims.claimCheckoutStart` method prepares and
retains that original inside the existing top-level transaction. It shares C2's
claim core, identity/digest conflicts, cancellation, immutable observation and
original recovery. Final native access is followed by concrete purchase
currentness, recovery egress and the inert SQL journal fence. Late source,
privacy or access changes roll back the claim; no callback-capable work follows
the journal fence. A result returns only after commit.

The result remains the existing historical, unverified `CommandClaimView`.
Configured grant and correlation are unverified expectations. There is no
provider authentication, live grant/actor authority, transport, dispatch,
ReceiptContextSource, inferred FINALIZE/proof relationship or business execution.
Existing receipt, intent, approval, budget, reservation and execution owners are
unchanged. No new SQL table, migration, record field, queue, lease or durable
native binding is introduced. See [the native guide](../../docs/DELEGATED-CHECKOUT-STARTS.md).

The existing privacy owners retain authority over personal projections. Following
native callbacks, an inert lookup for the actual preview customer's existing
`erasure_held` event prevents fresh native use after a held erasure request. A
plain retention hold remains allowed; release or expiry cannot withdraw an
earlier erasure request. This check is exact to the preview's tenant, store and
original customer. It is not aggregate gift-party authority or an active-journal
check: a cancelled exact repeat can still return its masked historical view.
Minimized/restored originals cannot be repopulated or restore a live preview.

## Fixed candidates and verification

Initial integrated candidate: `0e476418fd030f5c23e01f4e3d270bb171ac6406`, tree
`5d1e40a6c97fe2421f880ad9c016996569d916d4`.
Runtime-corrected lifecycle candidate: `66f4962cd9ed35c40702c375e7a48f4e19bed9c2`, tree
`1a014985124741976191c80244202336df1add4c`.
Final reviewed candidate: `ffe81add121c21b0e2f261cfc3f325fc4ec7acab`, tree
`7435869d56943dfc8b1aed965d17441e5dfd0563`.

| Final evidence | Cases | Actual execution and treatment |
| --- | ---: | --- |
| New native START unit file, unchanged C2 journal and C1 native binding | 45 | Fresh on ffe81ad; 8.676 seconds |
| New native START lifecycle, unchanged native checkout and C2 command privacy | 53 | Executed on 66f4962; 12.958 seconds; carried through verified unchanged execution inputs |
| Existing privacy coverage, C2 process durability and bounded catalog checks | 17 | Fresh on ffe81ad; 15.764 seconds |
| Distinct final cases | 115 | 28 new and 87 existing; 62 fresh plus 53 carried |

Every invocation retained the normal 60-case/four-file/60-second limits. Each
selected final file executed completely, with no skipped, cancelled,
unregistered or unrun cases. No broader product, browser, hosted CI or provider
campaign is claimed.

```sh
python3 tools/dev_tests.py --files tests/development/delegated-checkout-starts.test.mts tests/development/delegated-command-claims.test.mts tests/development/delegated-command-native.test.mts
python3 tools/dev_tests.py --files tests/development/delegated-checkout-start-lifecycle.test.mts tests/development/delegated-checkout.test.mts tests/development/delegated-command-privacy.test.mts
python3 tools/dev_tests.py --files tests/development/privacy-coverage.test.mts tests/development/delegated-command-process.test.mts tests/development/delegated-command-catalog.test.mts
```

| Raw report under ignored `evidence/development/` | SHA-256 |
| --- | --- |
| `20261121T231023.889921Z-6fcf07/report.json` — 45 fresh cases | `fe0dcb3b2b40544cc69c0152c6b72d4b682c187f099585f2118f33e7b69b1fa0` |
| `20261121T230925.037660Z-d7eb81/report.json` — 53 carried cases | `10635b6699caf1c9a1c349b5a4067aec2c390959e1567794d0190d9d40b6e199` |
| `20261121T231044.749423Z-7ae495/report.json` — 17 fresh cases | `17ecdddda3f0510a4b43fc97b40c640e58d1375f3500f40dda9022e0a785b7d7` |

The source/runtime/report record is
`evidence/rcg4bc3-integration/candidate.json`, SHA-256
`7293012031d7ed8562518b2ed70848fb8ddae478b39215018ec130766b9e8541`.
It binds all 1,821 actual source bytes to the final Git tree, all native XML/log
pairs and the unique 115 IDs. The two fresh reports have exactly that source map.

Only `packages/commerce/contracts/privacy-storage-surfaces.v1.json` changed from
66f4962 to ffe81ad: the new process-memory prose was shortened to its existing
bound and the new runtime pin refreshed after the held-erasure fix. All runtime,
selected tests, helpers, fixtures, dependency locks and other source bytes are
identical. The three carried import graphs contain 193, 170 and 192 inputs and
do not reach that JSON or the privacy-coverage reader. Independent regression
review additionally inspected literal directory reads: including the unchanged
46 commerce migrations and nine skill-bundle members gives 248, 225 and 247
tracked execution inputs. Static discovery remains a bounded aid, not a claim
about all dynamic inputs or the whole host. The privacy coverage that does read
the changed contract ran freshly on ffe81ad.

Actual runtime: Node `v24.22.3`, executable SHA-256
`acbe4b8d9153b841ed0697cbfc4f93e767386620edb745ab9358306c0a6f31aa`.
The existing optional JOSE `6.2.18` package has 80 regular files, 110 tree entries
including directories, and tree SHA-256
`8247cbabe4fe086e6330038cc15353b9f5cd001dd7650916657e68de4e6cf863`.
Both independent reviews rechecked source and runtime identity.

### Actual corrective history

The writer's initial exploratory unit run executed 20 cases, with 19 passing and
one failing. Its new JOURNAL-FENCE stimulus altered a revision-1 record's update
time incoherently and therefore hit native integrity rejection before the
expected revision conflict. Replacing that stimulus with coherent typed
retirement preserved the strict assertion and native parser. The corrected
exploratory file passed 20/20. Those dirty writer observations are not final
clean-candidate evidence. Their report SHA-256 values are
`68fac61dfad3a2e7fa309b8e23b9cb8dc60d4dc593d936addffcb2fb2faeb10c` and
`caa9c34c491a70404a2d34d19b08479a01c7f97702aaff73b9e61bd2e39c93b2`.

The writer implementation `32c3e27` was integrated as `f5d10c7`. Initial 0e47641
passed the 45-case unit/journal/native selection, superseded by the fresh final
run. Its lifecycle selection then executed only the first eight cases: seven
passed and LIFE-HOLD found a real missing held-erasure refusal. The later native
checkout 26 and C2 privacy 19 cases were not run. Root strengthened that new
case to introduce erasure during a quote callback; writer correction
`5c12fcf` added the exact-subject negative check and root integrated it as
`9e79f5c`. The resulting runtime passes all eight lifecycle cases plus the 45
unchanged lifecycle regressions on 66f4962.

The initial control selection executed only privacy coverage: six passed and
three failed with `PRIVACY_SURFACE_CONTRACT_INVALID`. Two newly appended memory
descriptions exceeded the unchanged 3,000-character bound (3,097 and 3,256).
The process and bounded-catalog files were not run after that failure. Final
ffe81ad shortens only the new prose, preserves all previous text as exact
prefixes and refreshes the starts-source pin. No parser, bound or existing test
was weakened. The entire 17-case control selection then passed freshly.

Initial lifecycle report SHA-256:
`cd246150cdaf0209f9f740185082d4c9d1420d6f385ba1e4664e9becba2f99a9`.
Initial privacy-control report SHA-256:
`bf7918257a7cd5a69beab80c5e91fa919c6d76a12fe5b29f32350e25ed299286`.
Both remain as superseded diagnostics. The wrapper records zero aggregated
cases after a nonzero subprocess; raw XML/TAP establishes the actual 8 and 9
executed denominators. Unexecuted later files are not counted as failures or
passes. An ignored evidence collector also initially counted the smoke migration
with the 46 commerce migrations and directories as JOSE files; its final record
uses the exact categories above. Those collector fixes changed no product input.

## Independent reviews and targeted faults

Both reviewers independently inspected the corrected fixed candidate, raw
reports, source/runtime identity and carry justification without authoring
product code, tests or oracle. No scoped blocker remains after the held-erasure
and metadata corrections, within the assigned corrective-round limit.

| Role | Reviewer | Verdict | Immutable review SHA-256 |
| --- | --- | --- | --- |
| Authority/security | `commerce_checkpoint_audit` | No remaining scoped blocker | `28e6bac0287244d15ecd3c1c5ec3164fa42fef265aa2d9a67271721e487aebe4` |
| Regression | `receipt_regression_review` | No remaining scoped blocker | `19fe9646b89452e6e5bda14b1a11df2fcb462400e75816b3a6c89dc7de18ee58` |

Byte-identical reviews and supplemental observations are retained under ignored
`evidence/rcg4bc3-reviews/`. Each reviewer introduced one isolated source fault
directly from ffe81ad, retaining the entire unchanged 20-case native unit file:

| Deliberate fault | Mutant commit | Actual native outcome |
| --- | --- | --- |
| Remove only final concrete native currentness | `1e93d723f67934760926b627500c844f2905a9bb` | 16 passed, four behavioral failures; START-FINAL-CURRENTNESS misses the expected rejection after a real terms change during final native access |
| Replace full-preview request digest with a different shape-valid SHA-256 | `fec25c0c8346a7884c5e63c62fddd78470672016` | 16 passed, four behavioral failures; START-MAPPING's independent complete request comparison identifies the incorrect request_digest |

Currentness-mutant report SHA-256:
`6cade4a009225c105015f973d20e6c3a6363fa374bdd45fcd966d815a78eb40c`.
Digest-mutant report SHA-256:
`b40420dfc0e761f48aa42b7daf319b3c0ee44409f3ce298375b3f6519e4aeb3d`.
All 20 cases actually ran in each mutant, without skips, cancellation or setup
failures. The currentness mutant's three other failures reflect third-quote
callbacks no longer running; they are not evidence that those callbacks executed
their intended changes. The digest mutant also fails CLAIM, CONFLICT and
RAW-CONVERGENCE. The failed-wrapper zero count does not replace the native
denominator. Neither fault enters the product branch.

## Preserved controls and limits

All 1,813 prior source members, 3,706 prior case rows, 232 prior capabilities,
399 protected rows and 46 commerce migration files are preserved. Final totals
are 1,821 sources, 3,734 cases and 233 capabilities; the new capability remains
proposed. Existing test and fixture bytes remain unchanged except the explicitly
assigned licensing fixture's actual source count and reason. C1's codec/oracle,
C2's record/privacy owners and all preview/receipt/intent owners remain unchanged.
The acceptance ledger is unchanged.

Privacy preserves the schema digest
`1be56171e04e051e0402ac4ccb339b0f1c910a09f8f358001e0a3e62cb70ff3b`, all 15
surfaces and the order of all 359 prior runtime pins. Only the existing claims
hash refreshes; one new native START source makes 360 pins. Only the existing
process-memory surface gains its source membership and bounded explanatory
suffixes. No privacy hook, stored-record parser or retention limit changed.

Catalog source/oracle/expected rows are entirely unchanged from C2: 47 adapters,
225 operations, 328 referenced cases, 47 direct fixtures and 256,149 canonical
bytes under the existing 262,144-byte bound. Its four bounded C2 catalog cases
pass. The separate legacy nested catalog test still hardcodes 38/199/262; that
pre-existing broader gate remains deferred, unmodified and unclaimed. The full
nested campaign was not run. Structural, retained-plan, generated-view and diff
checks pass without implying product readiness or formal acceptance.

## Publication, closing equivalence and next work

The published assignment
[01055f9](https://github.com/burdettadam/rifare/commit/01055f9d63dfde49f203aea36a44cd38ed1824b9)
has the exact native `0a714b4` assignment tree and precedes implementation
publication. Published implementation
[dfd60b5](https://github.com/burdettadam/rifare/commit/dfd60b52e92cf027ab98bfda4b3c3ca6704d27cc)
has the exact reviewed ffe81ad tree. Fresh native fetch verifies public/native
tree identity. Tests ran on the named native commits; the GitHub-authored commit
identity is not substituted for those executions.

Closing changes are limited to this record and the current ARCHITECTURE, PLANS,
ROADMAP and DELEGATED-CHECKOUT-STARTS descriptions. Explicit source/runtime/input
equivalence and both independent closing attestations bind that documentation
tree before its publication. Publication commit metadata records the exact
closing attestation hashes, avoiding a self-referential source hash. Raw evidence
remains ignored local material; this record preserves its decisions and hashes
without claiming remote raw-report storage. Native history remains separately
preserved.

The provider snapshot inspected for this assignment is open draft
[`0a1ef66a4b832e0fd8d67a57940425af379e2254`](https://github.com/ElevenID/marty-ui/blob/0a1ef66a4b832e0fd8d67a57940425af379e2254/docs/delegated-use-runtime-candidate.md),
with Protocol still `6126da7619e057be2ff58dd38a5d50f49891d1b3`. Its explicit
default-off internal host includes protected original-receipt recovery and an
independent offline receipt consumer, with fourteen restricted database
connections and mandatory mutual TLS. Selected public Gateway/wallet/client
contracts and deployed qualification remain open. Runtime-candidate and milestone
document blobs are respectively `8f498090363152b50d04dde65951e5c8cc27a466` and
`6b11bb4d595987fec410c81e21dfe499f0da3927`. These are pinned source observations;
no provider test ran here and the separate provider conversation owns Marty code.

Continue with authenticated provider namespace/current-grant binding and the
selected public transport contract, then independently established
FINALIZE/proof/context composition. Preserve original recovery and Rifare's
business permission, budget, reservation, approval and execution ownership.
No private-provider-storage bridge is assigned. Full isolated RCG-5, connected
RCG-6, target React/PostgreSQL, formal acceptance and production qualification
remain open. Feature publication uses `[skip ci]`; no Actions dispatch,
default-branch merge, release, deployment or paid expansion was performed.
