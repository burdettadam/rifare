# RCG-4B-C7 — Native signed authorization request

State: native composition implemented, locally qualified and independently
reviewed for development integration. Connected and formal product acceptance
remain open.
Base: `c5bf5d422a584133efbdb8eaac710119e4ecb823`.
Owner/writer: root, active `rifare-operation-journal` linked checkout.
Branch: `feat/medusa-signed-request`.
Contract: [ADR-0085](../../docs/decisions/0085-native-signed-authorization-request.md).

The preceding turn merged standalone qualification as PR5. Rifare currently has
one primary and one active linked checkout. Original implementation refs and
ignored evidence remain preserved. No additional checkout or build cache is
assigned. Root owns the next C7 implementation and local qualification.

Independent authority and regression roles inspected the actual pinned provider
objects and confirmed the selected nonce bootstrap and request profile. The
provider's source nonce becomes authenticated through its signed, challenge-bound
request and is then frozen locally. No preknown nonce was invented. Trusted key /
purpose and query configuration provenance and connected qualification remain
with the provider/integration owners. No ElevenID or Supabase deployment is assigned.

Next actions are behavioral signature tests, maintained JOSE verification and
native immutable retention/recovery/privacy composition. Keep every prior test,
intake rule and protected-effect hold. Source progress is not completed native or
connected qualification. Both independent roles must review actual results.

## Verified foundation checkpoint

Product candidate `5c5bb9576899677fc17a1e74a528268616fd1d73` passed the normal
backend build and all 34 synthetic signature/context checks under the actual
Medusa CLI. The checks include independently generated ES256 signatures over
both valid and invalid claims, wrong signing key, pinned headers and identity,
every selected context field, complete query/metadata, duplicate JSON, compact
syntax/size, exact UTC nanosecond bounds, lifetime, private result ownership,
input detachment, close and clock regression. Results explicitly mark native
retention and connected qualification false.

The targeted fault replaced compactVerify's authenticated payload with raw
decoded payload bytes. The unchanged valid control passed, then the genuine
other-key rejection assertion failed with Missing expected rejection at test
line 58. This is a behavioral signature fault. The source was restored byte for
byte and the disposable database retired. No mutation was committed.

The initial build exposed TypeScript return narrowing errors. A later run
exposed an incorrect new expectation that UTC offsets were accepted by C1.
C1 actually supports UTC Z only, with up to nine fractional digits. Both reviewers
corrected that earlier broad assumption. The verifier now reuses C1's exact
receiptTimestampNs export and the new test accepts nanosecond Z and rejects
offsets. No accepted test, timestamp parser, oracle or denominator changed.

At metadata checkpoint `02baac6`, the compiled JavaScript verifier also passed
all 34 cases through the actual CLI. The retained relocated compiled transport
test passed real C1/public mTLS after the shared JSON/time namespace exports were
added. Every existing shared source module remains unchanged.

Four intake attack cases, full source inventory, applied-license texts,
repository structure, generated views and retained-plan validation pass. A
structure scan run during upstream output regeneration observed disappearing
generated package files; its clean post-build rerun passed. Keep these actual
setup observations distinct from successful exact-candidate qualification.

Both independent reviewers cleared only the pure verifier foundation at5c5bb95.
There is no full C7 or merge acceptance. Root's next action is deriving context
from the retained native original, atomic first-artifact retention, conflicting
concurrent writers, lost acknowledgement/COMMIT/restart recovery and privacy /
restored-database qualification. Proof submission and protected effects remain held.

Rifare still has one primary and one active linked checkout. Root owns this
active branch and its ignored evidence. The reused generated server cache is
root-owned for upcoming C7 compiled/native composition checks, with retirement
after final qualification/integration. No additional full cache is allocated.
All disposable databases and the retained transport test's temporary copy were
retired after their runs. Provider/Supabase deployment remains with other workers.

## Prior exact JOSE intake and source classification decision

Before editing intake pins, root confirms the ADR-0085 authorized direct JOSE
declaration changes only package/root-lock dependency metadata. All 1015 non-root
lock entries are identical, with 1016 total entries. No package version, integrity,
registry, command, installation-hook, license or capability control changes.
Both independent reviewers inspected this exact bounded foundation delta.

apps/commerce-backend/package.json
Old SHA256 7298fd3a0a6b2b5ce7a8629d055739541616164f83f335c9bcbb535dc04d1a73
New SHA256 ec4ea4c86c55ae71b155eaf506a81df785f61ec93bc42d9db6dfee9b9efa8c74
apps/commerce-backend/package-lock.json
Old SHA256 8c8b3f4194cb50c91f03e44aa75ea922c3ad86133f6199512fdae62f9355e134
New SHA256 a466b77a6a141584b0aa1656fc56b70e6ed9120853fe2bf1dbbdd8726b840fbc

Authorize only those two intake fingerprint replacements. Add the four new
C7 project-created paths (ADR-0085, this record, request-verifier.ts and its native
signature verifier script) to the existing source component with all component
metadata and obligations preserved. This is not C7 acceptance or release authority.

## Prior native source classification decision

Before changing the source inventory at43b2e99, root authorizes adding exactly
five newly written project paths to rifare-project-material: authority-assets.ts,
request-session.ts, Migration20261123094926.ts, verify-request-retention.ts and
verify-request-upgrade.ts under the existing commerce backend. The generated
migration is from the pinned Medusa toolchain. Existing entries, component
identity, provenance/obligations, license status, notices, dependency inputs and
capability claims remain unchanged. This is source classification, not release
or legal authorization. The strict checker and all retained oracles remain intact.

## Native implementation and qualification

Root implemented the six-field verified-request tuple in the existing journal,
using the generated `Migration20261123094926`. It stores exact JWS bytes/digest,
verification-context digest, provider nonce, first observation and expiry.
The service derives the binding from retained C1 START and first CHALLENGE,
checks current ownership/facts and database time, verifies through the concrete
verifier and atomically retains one result. Retries preserve the complete tuple;
different valid artifacts or changed trust cannot replace it.

The separate C7 session composes actual C6 retrieval. Its session-owned opaque
results cannot be cloned or transferred to another session. Cancellation and
verifier retirement during a blocked native write roll back retention. Post-COMMIT
ownership/time checks refuse a stale result while retaining committed history.
Recovery respects the persisted clock floor even with a fresh verifier instance.
No proof submission, FINALIZE, presentation verification or commerce effect exists.

The first seven native groups passed at `2d59513`. The composed suite passed ten
groups at `33f8bab` and in the relocated compiled consumer at `44bf90d`. Final candidate
`43b2e9960f2c44c57444c3895078f2cb7f489449` adds only the persisted-clock-floor test
to `44bf90d` and passes all 11 compiled native groups. These exercise concurrent valid
artifacts, exact retry/configuration refusal, actual deferred COMMIT rollback,
worker exit 79 after retention and fresh-process recovery, blocked-write retirement,
expiry/ownership withdrawal at COMMIT, actual public mTLS response loss/recovery/
request retrieval, session cancellation and result isolation, hold/export/erasure,
uninstall and stale-row reconciliation. Native peer counts prove one START and
three selected request GETs in the composed cancellation/replacement scenario.

A source-only native fault removed the existing-request replacement/context
check at `33f8bab`. The unchanged assertion at retention-test line 138 detected the
otherwise valid alternate signed request with Missing expected rejection. The
source was restored byte for byte and the disposable fixture retired. The earlier
signature fault remains separately applicable. No mutation was committed.

The standalone consumer uses its own 937-package production dependency install,
offline with hooks disabled, outside the repository. It executes compiled native
services/classes and packaged adapters. External synthetic TLS test fixtures are
explicit test inputs; product loading has no repository fallback. At44bf90d it
passed all 34 signature cases, native schema/privacy and the retained source C6
cart/journal file in a separate fresh database. The optional missing-ts-node
warning is caught by the upstream CLI within the same successful compiled
invocation; it is not a separate failed backend startup.

At3413268 the compiled candidate ran the unchanged predecessor migrations with
only the new migration held outside its search directory in the temporary runtime.
The pre-C7 schema passed 25 commerce groups and seeded a native original. The actual
upgrade and replay preserved exact counts/digests across 14 commerce/identity/
journal tables. The checker confirmed zero new request columns before, six nullable
columns afterward and no nonnull new values in existing rows. No source checkout
or predecessor migration was changed for this paused schema rehearsal.

At44bf90d actual pg_dump/pg_restore restored the complete disposable PostgreSQL
database twice. The restored old verified artifact was present before applying
the independently retained current erasure or uninstall facts. Both reconciliation
paths cleared all request fields, preserved refusal identity and refused recovery.
The backup digest and actual commands/logs remain under ignored evidence. This
supplements the logical stale-row cases rather than relabeling them as a dump.

The runtime receipt binds 75 product input hashes, 68 compiled file hashes and the
installed lock to source `43b2e99`, Node 24.14.1, TypeScript 5.9.3 and the pinned
PostgreSQL 16 image. Both independent reviewers recomputed all receipt hashes.
Receipt SHA256 is 9087673f9c3f3bb9f86f1235264c70a63df064b20158a1b59a26f58084b15ddd.
Source tree is f90baefc01698082d1cd1d5bc504e3bab3750102. Raw receipts are root-owned;
reviewers verified them read-only and did not claim independent execution.

Actual failed observations remain distinct. An initial migration-generator
attempt used an unavailable placeholder database; its uniquely identified owned
process was stopped before rerunning on disposable PostgreSQL. TLS setup initially
failed under the default Windows OpenSSL selection; a task-local Git OpenSSL PATH
was used for the passing run.
The new peer fixture initially retained its internal default HTTP status, corrected
to the selected public 200 response and actual response destruction for loss. Fixture
timestamps now come from the database owner clock. A relocated `3413268` run refused
the post-verification time check; its exact cause was not recorded, so no confirmed
clock-regression diagnosis is claimed. Strict checks were retained. The later
clock-floor strengthening and diagnostic hook passed on the final candidate.

The original authority-review worker returned classification errors twice instead
of native reviews. No clearance was inferred. Fresh reviewer c7_authority_review
independently read the native code/evidence and cleared `43b2e99`, separately from
the earlier foundation review. Independent rifare_regression_review also cleared
that exact candidate. Both found no scoped blocker. Root accepts bounded local
development integration only; provider enrollment, nonce generation, connected
qualification, signed presentations, final authority and production remain open.

## Qualification artifact retirement

After both reviewers independently verified the runtime receipt, root removed the
owned temporary runtime/dependency directory and the 68-file generated server
cache. All qualification PostgreSQL containers and observed owned listeners are
stopped/removed. The final Windows free-space measurement increased 585154560 bytes
for runtime retirement. Source inputs, branch refs, installed-lock and build
receipts, qualification scripts and actual pass/failure logs remain preserved.
Reusable source dependencies remain assigned to root for subsequent Rifare work.
No other repository or worker workload was stopped or cleaned. The five additive
inventory entries and existing intake/plan/license/structure checks pass.
