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
