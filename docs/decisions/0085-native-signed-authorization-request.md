# ADR-0085 — Native signed authorization-request verification

Status: assigned, implementation and qualification remain open.
Protected base: `c5bf5d422a584133efbdb8eaac710119e4ecb823`.
Branch: `feat/medusa-signed-request`.

## Assignment RCG-4B-C7

Root owns implementation, tests and integration in the existing active checkout.
Retain independent authority/security and regression reviewers. Reuse the C6
transport and native PostgreSQL journal. Add signature and selected request-context
verification, then atomically retain the first verified artifact for its original.
Do not enable proof submission, FINALIZE or commerce effects in this assignment.

Provider source is Marty UI `169ba94680653a7235319498f5bff2f6da221515`.
Read-only comparison with current main `b3a6f78e117e172d851fc883687d9f6070a5e163`
found no changes in request_object.rs, delegation_use_wallet.rs, delegated-use
configuration or oid4vp-contract's JWT-VC query validator. The unrelated dirty
Marty checkout was not changed. Provider deployment remains with its worker.

## Selected trust and claims

Pin the independently administered provider, organization, complete machine
principal, HTTPS origin, verifier DID/client identity, request-signing purpose,
ES256 key ID/public JWK and complete expected DCQL/metadata. Request-provided keys
or key URLs cannot configure trust. The selected client ID is
`decentralized_identifier:{verifier DID}`. The signed audience is exactly
`https://self-issued.me/v2`, not Rifare's origin or customer client ID.

Accept only the selected standard compact ES256 JWS with
`typ=oauth-authz-req+jwt`, exact pinned kid, exact issuer/client identity,
`response_type=vp_token`, `response_mode=direct_post`, retained challenge UUID as
state, and exact configured-origin challenge `/submit` response URI. Require
bounded canonical base64url and duplicate-safe JSON, selected claim/header keys,
integer issuance/expiry under a trusted clock and the retained challenge bounds.
Reject unsigned, encrypted, DC API, Lissi, x5c and wallet-nonce variants here.

The complete query must match trusted frozen configuration and the provider's
explicit single type-only holder-bound `marty_nested_vc2_jwt_v1` / `jwt_vc_json`
profile. Preserve exact query IDs, types and metadata. Generic or direct VC2
profiles cannot be substituted into the selected public proof-association path.

C1 supplies no expected proof nonce. Learn the provider-chosen nonce only after
signature and challenge/context verification, then retain it with exact JWS bytes,
digest, verification-context digest and observation time. Independent reviews
confirmed this bootstrap matches the provider contract. It establishes continuity,
not global nonce uniqueness/entropy. Provider nonce generation and signing-key /
purpose enrollment remain explicit external qualification dependencies.

## Native composition and evidence

Bind verification to the journal's retained original START, first CHALLENGE,
provider/machine correlation and selected trust context. Concurrent different
valid artifacts must have one immutable winner. Same-artifact retry and fresh
process recovery preserve original bytes, nonce and time. Changed configuration
or keys cannot silently rebind an original. Return an opaque verifier-owned result,
without presentation verification, proof-submission or execution authority.

Check current ownership/privacy and request lifetime after awaited verification
and before native persistence/return. Use the existing serializable journal and
privacy locks, not a new database. Include new fields in export, hold, erasure,
uninstall and restored-database suppression. Never persist credentials or proofs.

Tests must use real ES256 signatures and the actual native journal. Cover bad
signatures/keys/algorithms, duplicates, alternate schemes/profiles, every context
binding, exact query/metadata mismatch, time boundaries, altered nonce/bytes,
concurrent first results, acknowledgement loss, COMMIT rollback, restart,
cross-original replay, privacy and unforgeable results. Demonstrate a real targeted
signature-verification fault against unchanged assertions. Preserve all C6/C5
tests and source/qualification controls. Retain source and compiled consumer
evidence and independent reviews before local integration.

JOSE 6.2.18 is already pinned in the backend graph. Authorize declaring that same
existing package as a direct dependency, preserving its exact tarball/integrity
and every existing lock entry. Any corresponding intake pin change requires its
exact reviewed before/after record. Do not replace maintained JOSE verification
with a new signature implementation. Reuse the existing strict JSON scanner.

The full handoff goal remains active. C7 verification cannot establish current
delegation permission, verify a presentation, approve payment equality or create
an order. COMMERCE-AUTHORITY-01 and DELEGATED-PURCHASE-01 retain those later gates.
