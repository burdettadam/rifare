# RCG-4B-C5 — Internal delegated-command transport

State: bounded implementation and focused independent review complete; formal acceptance not performed.
Protected public base: `9c61f309398842cf49d7fdcde6cef788acdac3b7`, tree
`9755b4ee47b53d4eac27f90e16398ca76ba670df`.
Integration branch: `feat/rcg4b-internal-use`; owner: root.
Assignment: [ADR-0079](../../docs/decisions/0079-internal-delegated-command-transport.md).
Implementation writer: `command_consumer_impl`, separate assigned worktree.
Independent roles: `c4_authority_review` (authority/security) and
`receipt_regression_review` (regression). Neither authored candidate product,
tests, fixtures or expected outcomes. At most three corrective rounds apply.

The owner requested continued development and authorized feature publication.
This slice connects the existing native checkout source and original journal
to the selected internal mTLS START_USE and explicit RECOVER_RESULT interface.
The [client guide](../../docs/DELEGATED-USE-INTERNAL-CLIENT.md) documents concrete
composition, limits, lifecycle and the deliberately conservative recovery policy.

## Assignment, implementation and fixed candidate

Native assignment `4bf87ab42f1966ffc77bf874a81e5be962976670`, tree
`fe10be8dcf32776bc9f5944a1a649e823cb6b7af`, was published before product work
as exact-tree `d2b6361cdb668909ae697b0409fdd062b96dab65`. Its original native
history remains under `native/rcg4bc5-assignment`.

Root authored six admission, fifteen sender and three catalog cases independently
of the implementation writer. The writer committed its helper and twenty wire
cases before product code. Writer checkpoint
`79b26ee7bc277731b42ff81591d2edc8071a2660`, tree
`16e474683b1fb20db2b662759f55a119e2b89370`, contains the assigned implementation
and the corrected local peer observer. Root integrated those commits, strengthened
actual peer-count, recovery withdrawal, final row-fence and injected-owner
lifetime assertions, and appended the assigned controls.

Final fixed implementation:

- Native candidate: `3ecb91e07ec45cfdb9282cbd899c1966ca6c996e`.
- Tree: `e9ffcfe55aeb692e35c17d3e6403e3262ba23f64`.
- Published candidate: `9ecb34e5635fbc7ec0a31ef186c1d6f41b6c2570`.
- Public parent: `d2b6361cdb668909ae697b0409fdd062b96dab65`.

The published candidate was fetched and its exact tree and parent verified.
The protected development head remained `933600561a989150e2a2d3c4273a57ee84cdad52`.

`InternalDelegatedUseClient` fixes canonical HTTPS origin, full machine
correlation, explicit CA trust, exact client leaf digest/SPIFFE URI and matching
key. Native TLS verifies server trust and hostname. A fresh bounded connection
sends only canonical C1 START or original recovery bytes on the fixed internal
route. It has no automatic retry, redirect, proxy fallback or FINALIZE operation.
Original bounded response bytes go directly to the unchanged strict C1 binder.

`DelegatedCheckoutCommandSender` captures concrete same-kernel owners and commits
a new original before connection. C2 adds atomic `claimNewCheckoutStart` and
retained-only `currentCheckoutStart`; existing methods retain their semantics.
The final check after authenticated TLS requires the exact current native
purchase and unretired, unobserved original immediately before HTTP bytes.
Recovery needs current native access and the complete retained original, without
fresh C3 preview provenance. Post-response C2 observation rechecks access and
retirement, preserving the first validated value and all false authority flags.
Sender closure does not close application-owned injected transport/source owners.

Each admitted original has only one local START opportunity. Even a crash or TLS
failure before HTTP leaves it recovery-only, as does a previous C4 preparation.
No provider 404 reopens admission or authorizes a replacement UUID. No durable
attempt/lease state, customer send route or runnable-fixture wiring is added.

## Corrections and earlier observations

The writer's first twenty-case wire run had nineteen passes and one positive
plaintext-count failure. Its prepended `secureConnection` listener ran before
Node HTTP installed its parser wrapper; the optimized parser bypassed that data
listener. The helper changed only observer ordering to the normal event listener
after the native HTTP owner. Assertions stayed unchanged; the corrected whole
file passed twenty cases in 1.366 seconds. Both exploratory raw sets remain in
the writer worktree under `evidence/rcg4bc5-writer-wire-first/` and
`evidence/rcg4bc5-writer-wire-counter/`. No missing-import/setup failure is
credited as a behavioral fault.

The first clean integrated candidate was
`b7b0cfc7b69f79e90f7cee2890979b89d9bca0d6`, tree
`00c2e07a66acf7ce926127cded29e1dca3ad9887`. It passed all 158 selected cases.
Its preserved manifest is `evidence/rcg4bc5-integration/candidate-b7b0cfc.json`,
SHA-256 `b7042f2bf72085da127d7790d22140a9f9143259705927d0ac180ab14198ae01`.
The assigned negative executions below ran on isolated children of that commit.

A subsequent wording audit clarified three existing behaviors: claimed revision-1
state applies to START, recovery can retain an observed original, and immutable
history is the first validated value rather than the raw HTTP serialization.
It also distinguished transient TLS/raw buffers from C2's existing durable
canonical request and validated response. Only the client guide and one C5-added
privacy erasure sentence changed at `3ecb91e`; product, tests, pins, catalog and
runtime stayed identical. All 158 green cases were recollected on that final
clean candidate. This was one narrative correction and no corrective product
round; the earlier executions are retained with their actual identities.

## Fresh final focused evidence

All **158 distinct cases** passed freshly on clean `3ecb91e`: **44 new and 114
existing cases**, across thirteen whole files. Each invocation kept the normal
sixty-case, four-file and sixty-second limits. No final case was skipped,
cancelled, unregistered or unrun. No positive case is carried from another
implementation candidate.

| Whole-file selection | Actual passes | Elapsed | Directory under `evidence/development/` |
| --- | ---: | ---: | --- |
| New wire, old C1 codec, old native composition | 45 | 2.881 s | `20261122T005033.956788Z-563ea3` |
| New sender, old C3 START, old C2 claims | 55 | 11.538 s | `20261122T005033.965725Z-94e46b` |
| New admission, C2 process, privacy coverage, old bounded catalog | 23 | 17.885 s | `20261122T005033.907397Z-5517e6` |
| New C5 catalog, C4 HTTP, C4 Python caller | 35 | 10.637 s | `20261122T005033.938757Z-da3b01` |

The corresponding `report.json` SHA-256 values, in table order, are:

1. `ef0c1595e2be39c8f46f55e02c6c496f2b58d05bd444953ed0d4895b7b815c3b`.
2. `c44473cc663597efdc15a71576d8c62b449f8cff8ff5632e57aeb1cb547eb3b6`.
3. `d263d42bb1895f6a8e700094da8c1496e6442698185c94c4f84ec1b20d3a015e`.
4. `823d02c7643454b76ff353f05e3dc14965193edb146ec8ff3c91c2e09302ad10`.

`evidence/rcg4bc5-integration/candidate.json` has SHA-256
`db4bb4363cc9e1750c2a4f17281c1426083dc0c6973d4fd3bd59831c9c319dff`.
It verifies all 1,839 local source hashes against Git, exact report source maps,
actual native case IDs, raw XML/log hashes, runtime and structural results.
Repository structure, retained-plan validation, generated views and
`git diff --check` passed. Planner overestimates are distinct from the actual
native counts above.

Tests use actual local TLS, controlled handshake waits, peer HTTP/byte counts,
native SQLite and existing source owners. They cover original commit before
connection, exact request bytes/certificate, currentness changes during TLS,
missing originals under a fixed clock, response loss, replacement sender/history
recovery, post-wait access denial and unchanged native business effects. Existing
C2 process cases separately exercise actual process loss and SQLite contention.

Runtime pins:

| Input | Observed version/content | SHA-256 |
| --- | --- | --- |
| Node | 24.22.3; bundled OpenSSL 3.5.9 | `acbe4b8d9153b841ed0697cbfc4f93e767386620edb745ab9358306c0a6f31aa` |
| Fixture OpenSSL | `/usr/bin/openssl`, 3.5.7 | `acc10176d038aeb7b2a77d9ec972ac2985857a7191f7aecb7c54ef0e2c7e9549` |
| JOSE | 6.2.18; 80 files, 110 tree entries | `8247cbabe4fe086e6330038cc15353b9f5cd001dd7650916657e68de4e6cf863` |
| Python | 3.12.14 | `fa67443527ed9647f760d807e2a38f26340757123e643c4639cf273ed15d5ea7` |

The manifest also pins selected Python library files. First wire/sender diagnostics
record nonsecret ephemeral certificate digests and runtime inputs. No private
key or production identity is retained in Git/evidence. These finite runtime
observations do not cover every shared library or whole-host state.

## Preserved and additive controls

All 1,829 prior source paths remain; ten assigned members produce 1,839 total.
Inventory revision advances once from 59 to 60. All 3,778 prior registration
rows remain and 44 are appended, producing 3,822. All 234 prior capabilities
remain with one proposed addition, producing 235. The 399 protected rows, 46
commerce migrations and acceptance ledger remain unchanged. Old tests/helpers
remain exact except the assigned additive bounded catalog adjustment. Existing
C1/C3, C4 API/Python, receipt/execution owners, dependencies and runners remain
unchanged; C2 has only the assigned additive admission/currentness seams.

Privacy retains all fifteen surfaces, all 360 prior runtime-pin positions and
schema digest `1be56171e04e051e0402ac4ccb339b0f1c910a09f8f358001e0a3e62cb70ff3b`.
Only C2's old source pin refreshes; the two new runtime sources bring pins to 362.
The existing process-memory surface adds those sources and appends erasure prose
while preserving its prior text prefix. Existing retention/export rules and
stored personal schema remain unchanged.

Catalog adds `delegated_use_internal_client`, two internal operations and eight
direct wire-case references. Totals are 48 adapters, 227 operations, 336 native
cases and 47 fixtures. All 47 prior adapter entries retain SHA-256
`b40a2d53f95055cae9ed4e5d5610f86f17e24775c9de522c2ef6c77b40179bcb`;
the complete prior coverage is frozen at
`255cdb8ae87dd0a611cf08e0648728d270b5357a791caa5dda2d5ff99e7ff9e6`.
Canonical bytes are 260,505 within the unchanged 262,144-byte bound. Prior pins
refresh only C2 and expected coverage; four reached dependency/helper pins are
appended. The old bounded test retains its independent `823c2dc8...` digest.
Licensing changes only source count/reason. Legacy nested catalog 38/199/262
literals remain an unchanged, deferred broader-gate issue.

## Independent reviews and assigned faults

Both final reviewers independently checked source preservation, all final raw
reports and runtime; neither repeated the green campaigns. Both found no
remaining scoped blocker on `3ecb91e`:

- Authority/security: `evidence/rcg4bc5-reviews/authority/review-3ecb91e.json`,
  SHA-256 `f645959946796a36830150b114ba229b8001994de20b14318d33fff21871684a`.
- Regression: `evidence/rcg4bc5-reviews/regression/review-3ecb91e.json`,
  SHA-256 `cad0ff38fee520d998969518d0c0eef4ce5e5f9ec5a66a57068e0a180552038b`.

| Isolated fault, parent `b7b0cfc` | Actual commit | Unchanged whole sender file |
| --- | --- | --- |
| Remove final post-TLS native guard | `a823ce4e5df414bcdabeccb3eedbd18552f474b1` | 15 executed, 10 passed, 5 behavioral failures. Required TLS-PRICE sees one peer request instead of zero. |
| Remove occupied-original fresh-admission refusal | `83dba8f453dde788701167ea34cec2a369a0d8b7` | 15 executed, 12 passed, 3 behavioral failures. Required SENDER-LOSS sees two START requests instead of one. |

Authority raw report:
`rifare-internal-use-authority-mutant/evidence/development/20261122T004754.348608Z-478723/report.json`,
SHA-256 `53b4c7ac93aeaf16be53beb089c4fa1b1550d6bddd6c76e6c9db15bb1891d0f4`.
Its coupled failures are deleted original, withdrawn proof, already-observed
original and sender closure. Regression raw report:
`rifare-c5-admission-mutant/evidence/development/20261122T004646.922255Z-218e57/report.json`,
SHA-256 `c0ea6e4ec3bd3415cf7a3c1e47d6ef5a03e491b5050718a0b74dea70d98d2b40`.
Its coupled failures are preclaimed originals and binding after a failed result.
Every START response in the required loss case is dropped, so its second-request
witness is not merely an expected exception mismatch.

Both whole-file fault executions have no skipped/cancelled cases and no credited
setup/import/syntax failure. Failed-wrapper `actual_tests: 0` and planner counts
are not native denominators. Loop variants interrupted by an assertion are not
counted as extra executions. No mutant enters the product branch.

The negative executions retain their actual `b7b0cfc` parent. Both reviewers
separately established carry to `3ecb91e`: only guide/privacy narration differs;
the other 1,837 files, all implementation/test inputs and runtime match. The
sender's 196-input map is
`0e4bc2959d2643089bba153b011c9f15b0dc81ebce784329163f4983ce4ad98a`,
with no intersection with either changed narrative path. Their review records
bind the underlying comparisons. No fault was rerun or relabeled as a final
candidate execution.

## Closing publication and next integration

Closing changes only eight Markdown files: this record, ADR-0079, ARCHITECTURE,
PLANS, ROADMAP and the internal-client, claims and consumer guides. The separate
`evidence/rcg4bc5-integration/closing-equivalence.json` verifies identical product,
tests, controls, inventory, dependencies and runtime. The 158 passing executions
keep their actual `3ecb91e` identity; closing adds no product execution. Exact
equivalence and both independent closing-attestation digests are pinned in the
public closing commit metadata, avoiding a self-hash cycle. Native history is
preserved before aligning the local branch with the exact public closing tree.
Publication uses `[skip ci]` and checked feature-branch leases. Raw reports stay
ignored local artifacts; committed records pin their identities without claiming
remote retention of those raw files.

The assigned internal provider contract remains
`37b7fdc3d3f1c223613ad98fe601d7d86e6a3600`. Fresh closing inspection found
provider draft [PR1994](https://github.com/ElevenID/marty-ui/pull/1994) at
`3c05227fe0a2da1216c8d4306a9e2ca0f9ea432a`; Protocol draft
[PR38](https://github.com/ElevenID/marty-protocol/pull/38) remains
`6126da7619e057be2ff58dd38a5d50f49891d1b3`. Both remain open and unmerged.
`USE_HTTP.md` now has blob `7bc69c11cbed9223ea673518ae9d6396021e7b2b`;
`USE_MTLS.md` is unchanged at `5f6f64170ff446caa8aa46d969d55ae7d0588df9`.
The host README is `fd1712e425c63afb3a904c5e3a013754f995c5b1`; the new Rust
client README is `7acd02af78aaf5830066b3c2d8aa6736d82dc022`.
Read-only inspection metadata is
`evidence/rcg4bc5-integration/provider-inspection.json`, SHA-256
`dd97ad675f2acb0d4ba293df1a44eaa0d079523db81baa5eb58db23b6ac54644`.

The added public managed-machine profile is default-off on the same mandatory
mTLS listener. It provides public command, challenge request/proof and original
receipt-recovery routes; the internal route and command bytes/digests remain.
A same-origin challenge Link and the Rust client's `CallerVerifiedRequest` do
not supply independent request verification or native receipt-context authority.
The [consumer guide](../../docs/DELEGATED-COMMAND-CONSUMER.md#provider-and-next-integration)
records exact source links and route constraints. This is source inspection only:
no provider test, deployed account, storage or public endpoint was accessed.

Next, pin that selected public profile for bounded public commands and
original-bound challenge/request handoff through the existing native lifecycle.
Independent signed request verification must then precede proof, FINALIZE and
independently trusted current receipt context. Provisioned endpoint, machine
mapping/trust and certificate lifecycle remain external qualification inputs.
General wallet/Gateway selection, full isolated RCG-5, connected RCG-6, target
PostgreSQL/React, broad/browser/nested regression, hosted CI, production and formal
acceptance remain separate. Native permission, approval, budgets, reservation,
business idempotency, execution and outcomes remain Rifare-owned.
