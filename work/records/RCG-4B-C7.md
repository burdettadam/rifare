# RCG-4B-C7 — Native signed authorization request

State: cryptographic foundation locally verified and independently reviewed;
native composition and full C7 acceptance remain open.
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
