# RCG-4B-C7 — Native signed authorization request

State: assigned; no verification or product acceptance claimed.
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
