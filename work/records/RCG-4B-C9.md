# RCG-4B-C9 - Native proof association and original finalization

State: codec/transport reviewed; native continuation implemented with exploratory
PostgreSQL checks passing. Full C9 compiled/session/restore qualification and
renewed independent review remain pending.
Base: `acab80a787b5e625e16527f22463a86deaa718e0` (merged C8 PR7).
Writer/integration owner: root, canonical primary `rifare` checkout.
Branch: `feat/medusa-proof-finalization`.
Contract: [ADR-0087](../../docs/decisions/0087-native-proof-and-finalization.md).

The previous turn merged C8 after fixed-candidate qualification and both reviews,
then retired its owned runtime and generated backend output. Source dependency
cache, branch refs and evidence remain preserved. This turn verified clean
development and one primary/zero linked Rifare worktrees. Assigned earlier local
feature branches are integrated; original implementation history remains preserved.
No open Rifare PR or stash was found. Root reuses this primary; no checkout or
separate compiler cache is created. Host free space observed 73,130,946,560 bytes.

Provider protected main now points to `e868aa97464aeaebb9c99137f1808b5b10caff74`.
Read-only local object comparisons found no change in selected public client,
wallet association or use-command paths since `7254680c`. The dirty provider
checkout was not changed. No actual endpoint, enrolled caller, credentials or
provider/Supabase deployment is consumed here.

Independent authority scoping confirmed the selected two-field form and compact
proof digest, closed five-field acknowledgement, historical duplicate recovery,
distinct durable FINALIZE identity and outer/inner receipt correlation. Preserve
historical recovery separately from first-dispatch currentness and retain DENY.
The provider worker must select managed-machine credential/presentation custody;
Rifare does not substitute human/device signing or invent an unreviewed signer.

Next: implement and exercise the pure association codec, then compose real mTLS
and durable native continuation under the same assigned contract. Foundation
evidence must not be represented as native, connected or full-slice qualification.
Both independent roles review the actual fixed candidate before integration.

## Pure association foundation

The source codec and its test script now pass 21 groups via the existing pinned
Node24.14.1/ts-node10.9.2 source toolchain. Exact command from the backend directory:
`node -r ts-node/register/transpile-only -e` invoking the exported test function
with NODE_ENV=test and RIFARE_COMMERCE_VERIFY=disposable. No Medusa bootstrap,
database, transport, credential or provider process was started. The test VP is
deliberately JWS-shaped synthetic syntax, with no signature-verification claim.

The prepared object privately captures bounded exact form bytes and compact-proof
digest, avoiding enumerable raw artifacts. Context is detached before awaited
module loading. Closed duplicate-safe acknowledgements bind original challenge,
proof digest and receive time to nanosecond bounds. Recovered transport observations
retain the same immutable semantic digest/time. The checks independently cover
form vs compact identity, prototype-like query names, all response mismatches,
time/calendar/offset boundaries, duplicates, size/syntax, mutation, bounded malformed-buffer diagnostics and retirement.

A deliberate source fault removed only the proof-digest equality check. Valid
form/recovery and wrong-challenge controls passed, then the unchanged wrong-digest
acknowledgement assertion failed with Missing expected exception. Source bytes
were restored in finally and the complete final suite passes. Logs are retained
under ignored `evidence/operation-journal/c9-proof-*`. This is behavioral codec
evidence, not native persistence, public-route or connected qualification.

Existing C1/C5/C6/C7/C8 implementations, tests, catalog claims and dependencies
are unchanged by this foundation. New files use the assigned first-party source
component. No full backend build/cache or additional checkout is allocated.
Next: independent foundation review, then the real continuation transport and
PostgreSQL owner/FINALIZE/receipt composition. The managed custody/endpoint gate
remains with its provider owner; absent exact recovery bytes must remain pending.

## Shared continuation transport checkpoint

Both independent roles cleared foundation `b583af7` within its codec-only scope.
Authority independently inspected the pinned provider contracts and recomputed the
seven direct input hashes; regression independently verified hashes and retained
source/catalog behavior. Neither clearance covers native or connected operation.

The shared explicit-mTLS engine now carries exact proof forms, original FINALIZE,
original result recovery and exact receipt recovery under post-TLS native admission.
It preserves private bound challenge ownership, existing trust/cancellation/no-retry
controls, and closed response/digest/time correlation. Receipt compact bytes are
nonenumerable and all returned evidence remains unverified/inert. The 262144-byte
proof passes through the real synthetic mTLS peer without raising generic JSON or
catalog limits. No credentials, native journal persistence or commerce effects are
introduced by this transport checkpoint.

Local focused runs passed 51 wire/catalog cases and 47 retained C1/C5 cases in the
maintained four-file/default-deadline runner. The original 23 C6 wire cases, original
20 C1 cases and 20 C5 client cases are unchanged. Protected prior catalog/coverage
canonical hashes and old scope assertions remain exact after strictly validating
and subtracting the one/four/24 new contribution. The sole inherited LF pin repair
is separately recorded in ADR-0087 and `aba218e`.

A deliberate transport fault removed only acknowledgement proof-digest equality.
Valid wire/history controls passed; the unchanged mismatched-digest assertion then
failed with Missing expected rejection. Exact source was restored (SHA-256
623d71c98dd0b4f05d37e30d2c2647db7147cd2e733747c436a57b74c079690f).
Raw logs and restoration receipt: ignored `evidence/operation-journal/c9-continuation-*`.
The Python console could not print a Unicode test glyph after saving those files;
the fault run and exact restoration completed before that output-only failure.

Backend noEmit typecheck and repository/generated/plan/distribution/license checks
pass. No full compiler output, runtime, database, dependency change or checkout was
allocated. One primary/zero linked Rifare checkouts remain, root active here.
Next: fix this transport candidate for both independent roles, then implement native
first-proof association, original FINALIZE, privacy/recovery and compiled PostgreSQL
qualification. Endpoint/enrolled caller and managed-machine VP custody remain
provider-owned unavailable; the user's lack of a location does not authorize a
substitute credential or signer. Full C9 and the broad work goal remain active.

## Native continuation progress checkpoint

Both independent reviewers cleared shared transport `0da5ea45c7ee3ecaed737c8ccc7a2eb08c00b82c`
against protected `acab80a`: `/root/c7_authority_review` and
`/root/rifare_regression_review`. Authority independently reran 51 wire/catalog
cases with Git OpenSSL and both reconstructed protected metadata/LF repair.
Regression independently checked original C1/C5/C6 test files against protected Git.
Their disposition is transport-only. The authorized feature remote was verified at
that exact checkpoint; no full C9 acceptance or merge follows from these reviews.

The journal now derives proof routing/query solely from retained C7 observations,
captures compact proof bytes privately and stores only context/digest/dispatch owner
and first semantic submission. First dispatch rechecks the concrete C7 verifier,
native ownership/privacy/cart and DB time after TLS; original explicit recovery
needs independently supplied identical bytes without renewing C7 validity. A separate
server-generated FINALIZE UUID/bytes/digest precedes I/O, with one-use claim and
original result recovery. First FINAL_USE remains immutable, including DENY. Receipt
admission additionally checks signed receipt identity/digest/decision and original
time bounds against that final result before C8 persistence. Provider source shows
receipt issue time precedes result recorded time; equality is not required.

Generated `Migration20261123121939` adds sixteen nullable columns and constraints.
Fifteen personal continuation fields join export/hold/minimization. FINALIZE UUID
remains a unique refusal identity after erasure; closed current five-field refusal
records preserve it, while legacy records cannot discard it. No VP/MachineCredential
is persisted. An internal continuation session composes these native owners with the
real client; it has no public route, credential custody, signer or business effect.

Exploratory native PostgreSQL runs pass 15 continuation groups, 38 signed receipt
cases, unchanged 13 C8 retention groups, unchanged 11 C7 retention groups and schema/
privacy checks. First ownership test failed because upstream metadata update merged
rather than removed its customer field. The corrected fixture sets and asserts an
actual withdrawn DB identity before the unchanged refusal checks. Initial failure
is preserved in `c9-native-continuation-retention-first.log`. The successful run is
source execution; it does not qualify the standalone compiled session. Later origin
composition/snapshot changes need the fixed-candidate rerun.

A deliberate native fault removed only the acknowledgement proof-digest guard:
four controls passed before the unchanged mismatch rejection failed. Finally restored
the captured original bytes. The first evidence summarizer misread PowerShell's
UTF-16 log as UTF-8 after restoration; the raw failure, decoded inspection and
restored-source hash are retained under `c9-native-digest-fault*`.

Before native proof intent, composition now requires the concrete transport's
configured origin to match C7's authenticated submission origin. This adds only
configuration correspondence, no authenticated-provider flag. The extended existing
wire case and the full retained/new focused scope pass 51 cases; catalog pins were
renewed exactly. This consequential source addition requires renewed final review.
Backend noEmit passes. Migration, model and privacy checks remain local evidence.

One primary/zero linked checkouts remain; root owns the active primary. Reused source
dependency cache and generated `apps/commerce-backend/.medusa/server` are root-owned;
retire generated output after C9 exact qualification/reviews. Host C free space before
the build was 65,814,429,696 bytes. Both task PostgreSQL qualification containers and
the deliberate-fault container were stopped by their owning scripts. Other workers'
services were untouched. Next: complete actual session mTLS journey, restart/rollback/
upgrade/whole-DB restore assertions and standalone own-dependency qualification;
fix exact candidate, renew both roles, then use the authorized normal integration.
Provider endpoint/enrollment/presentation custody and commerce-effect gates remain
open. No merge, deployment, external qualification or full-goal completion is claimed.

## Session and lifecycle qualification candidate

The actual internal session passed eight source-executed PostgreSQL/mTLS groups:
private captured proof dispatch, consumed-handle refusal, byte-identical proof
recovery, distinct durable FINALIZE, fresh-session original result/receipt recovery,
origin mismatch before intent/I/O, historical proof recovery with retired C7 trust,
and session retirement. The peer uses real synthetic mutual TLS and real synthetic
C7/C8 signatures, but never verifies a presentation or represents a live provider.
Raw evidence: `c9-session-continuation-session.log` (eight requests, all TLS).

Extended retention passes nineteen source groups. Additional cases use actual fresh
processes exiting after proof intent, submission observation and FINALIZE intent;
a fourth fresh process recovers the same UUID/digest. Deferred COMMIT failures roll
back proof/final tuples. Cancellation during a witnessed blocked proof UPDATE rolls
back. A delayed COMMIT retains historical proof intent while refusing a current
first-dispatch ticket, allowing explicit identical-proof recovery only. Logs:
`c9-extended-continuation-retention.log`. No separately installed runtime was used
for these source runs. Backend noEmit passes after the test additions.

The existing synthetic receipt fixture now accepts an optional request origin and
privacy-key preservation selector, and exposes its synthetic descriptor/request
public trust for the new tests. Its original defaults are retained. This test-only
change needs the retained C8 run in the exact compiled candidate. New whole-DB
restore and populated pre-C9 upgrade assertion scripts are implemented but have not
yet been run. Next: fix this source checkpoint and build one owned standalone runtime
with its own unchanged-lock production dependencies for compiled native/session,
old regression, actual dump/restore and populated upgrade/replay qualification.
No suitable prior Rifare runtime exists: the inspected Temp inventory contained no
`rifare-*-runtime-*` directory. Reuse source dependencies and generated build output;
any new runtime has root ownership and retirement after qualification/review.

## First native review and corrective candidate

Authority review of `ffc7900` required changes: a prepared-but-unclaimed proof could
enter direct_post recovery without a first C7 dispatch admission, and final/receipt
paths did not enforce the original submission origin. Regression found no separate
source regression, but withheld final evidence clearance. Neither disposition is
native acceptance. Both findings are adopted in ADR-0087.

Historical recovery/first acknowledgement now require a committed proof claim;
prepared-only lost-ticket originals remain pending. Existing fixtures explicitly
claim before modelling a remote acknowledgement. Generated migration
`20261123124010` enforces the prerequisite in the database too. All continuation
operations and their post-TLS admissions now compare the retained origin.

Corrected source runs pass nineteen native groups and ten actual mTLS session
groups. New refusal cases prove zero proof POST/plaintext after an unclaimed
preparation with retired C7 and zero result/receipt requests for a different valid
TLS origin reaching the same actual peer. The latter uses the certificate's
localhost/127.0.0.1 SANs so DNS/TLS failure cannot substitute for the assertion.

Two deliberate source faults reproduce the review findings. Removing only the two
historical recovery claim prerequisites reaches the peer and fails the unchanged
zero-request assertion (3 vs 2). Removing only checkFinal's origin correspondence
lets original result recovery succeed and fails its unchanged expected rejection.
Both sources restore byte-exact, with before/after hashes retained in
`c9-review-correction-faults.json`; raw failures are preserved. These do not substitute
for the corrected standalone compiled rerun and renewed independent review.

The first isolated runtime at `ffc7900` installed 937 production packages offline
with scripts disabled and passed 19 native/8 session, old receipt/request/schema/
privacy, whole-DB erase/uninstall restore and compiled digest-fault diagnostics.
Its source blockers prevent acceptance despite green diagnostic results. Preserve
its 85 compiled-file hashes and installed-lock receipt before refreshing this same
owned runtime. No second dependency installation/cache is needed: installed lock
SHA256 remains 607396fd2f643cf25348b126859d6de0a83028073ed6d9625e58fd3fccc14a39.
Host C free space before corrected reuse was 64,354,422,784 bytes. Prior task DBs
stopped normally, primary remains root-owned active, one primary/zero linked.
Next: fix corrected source, reuse that installed runtime for full exact qualification,
run populated C8-component upgrade/replay and renew both roles before integration.
