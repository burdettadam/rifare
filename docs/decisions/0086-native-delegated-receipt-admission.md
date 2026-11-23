# ADR-0086 — Native delegated receipt context and admission

Status: assigned; implementation and qualification pending.
Protected base: `4d07b3aa797a794dd318e9dc95cffa04e5333692`.
Branch: `feat/medusa-native-receipts`; writer and integration owner: root.

## Assignment RCG-4B-C8

Implement the native receipt-context owner and immutable receipt observation in
the existing Medusa/PostgreSQL operation journal. Reuse its ownership, exact
original, current cart, transaction, recovery and privacy owners. Independent
authority/security and regression roles review the fixed candidate and actual
evidence. Reuse the primary checkout; no separate checkout is needed.

The legacy receipt binder derives its request digest from a synthetic checkout
preview. Native START selects `urn:rifare:medusa-original-operation:v1` and the
retained canonical original command digest. Do not invent a legacy preview or
change its accepted digest contract to make native receipts pass. Preserve that
binder and all its tests. Reuse the existing pinned receipt JOSE verifier and
duplicate-safe JSON/time parsers; introduce only the native context validation.

Provider source is Marty UI `7254680c9491f6e79d8ca981ad71f44e9398142c`.
The selected command/request/client paths are unchanged from C7's `169ba946`.
`receipt.rs`, `authorization.rs` and `oid4vp.rs` bind receipt evaluation.challenge
to the verified proof challenge, which is the signed request **nonce**, not the
Flow challenge UUID. Native expectations must use C7's authenticated retained
nonce. The Flow UUID still binds the original START/result and request context.

## Trusted context and verification

An independently administered server configuration pins the receipt issuer/key
purpose, exact public key and algorithm, organization, full managed machine,
represented subject, KEY thumbprint, status issuer, policy ID/version and local
currency/spending ceiling. No key, policy, subject or spending limit comes from
receipt claims or customer input. Configuration is detached, closed and bounded.
The factory issues opaque verifier-owned results; decoded JSON or a caller's
verification assertion cannot enter native receipt admission.

Derive grant revision/terms and the entire operation from the retained canonical
START and original, and the nonce from the retained independently verified
request. Verify all original hashes/context/challenge identities and current
native ownership/cart facts. Receipt signature, issuer, organization, principal,
grant, KEY binding, operation, nonce, policy, PERMIT, active status, proof/status
lifetimes and full claim shape must match. Accept only the selected no-domain
managed-machine profile; required domain evidence needs a separate assignment.
Use database time in native admission, recheck after awaited crypto and COMMIT,
and preserve the first observation clock floor across restart. Evidence is not
current live grant permission or merchant execution authorization.

Persist a bounded immutable first receipt observation with exact bytes, digest,
verification-context commitment, receipt identity, first observation and expiry.
Same-artifact recovery preserves those values; different valid artifacts cannot
rebind an original. Enforce database replay/non-reuse constraints, including after
privacy minimization. Apply export/hold/erasure/uninstall/restore suppression to
new personal fields before integration. No proof, credential or private key is
stored. Migration/upgrade/replay and restored-database tests use actual PostgreSQL.

## Qualification and limits

First qualify maintained signature verification and native claim binding using
genuine synthetic signatures and independent mismatch assertions. Then qualify
native concurrent first admission, original/restart recovery, expiry and trust
retirement around awaited work, rollback and acknowledgement loss, cross-original
replay and privacy. Run the compiled standalone consumer with its own dependencies.
Demonstrate a targeted signature/context fault against unchanged assertions.
Keep source/build intake and old C6/C7 controls and tests intact.

The shared build closure may add the unchanged existing receipt JOSE adapter.
Reuse pinned JOSE 6.2.18, with no dependency version or lock change. Use the
existing optional root receipt-runtime installer for source ESM resolution and
the standalone runtime's own JOSE for compiled resolution. New first-party source
and records belong to the existing Rifare source-inventory component and retain
its license classification and obligations; update only that inventory list.

The existing installer invokes bare `npm`, which Python's Windows subprocess
cannot resolve to npm.CMD. Resolve that same executable through the system PATH
before launching it, retaining all locked manifests, flags and package checks.
The installer test's literal executable spelling may follow this platform
resolution; preserve its arguments, graph, promotion and tamper assertions. Run
the unchanged symlink assertions in a Linux container rather than skipping them
when the Windows user lacks symlink creation privilege.

### Inherited manifest byte-pin correction

Before changing intake pins, the maintainer inspected committed C7 `43b2e99`
and current Git blobs: the backend package/lock are unchanged LF text. C7's
checker instead pins their CRLF encodings. Converting only LF to CRLF reproduces
both accepted pin hashes exactly. The fresh primary therefore fails the old
byte check despite having the exact committed manifests. Pin those two exact
Git LF blobs: package `e919ba12131958f439bdbd229832cdffe6c108f54bfe0626a5a3b63140d48f47`,
lock `853af121bebf48ec6a836945e78cd014f3dbd76601a9bd986e24257ff1aa5780`.
No manifest, dependency graph, script or package integrity changes are authorized
by this correction. Do not add generic newline normalization or relax the exact
byte check. Independent review must verify both encodings against the prior pins.

This assignment does not send a proof, issue FINALIZE, enable checkout, verify
current live revocation, acquire final business authority or perform payment/order
effects. Those are remaining steps toward DELEGATED-PURCHASE-01 and
COMMERCE-AUTHORITY-01, whose full requirements remain unchanged. The provider
worker owns enrolled caller/trust and endpoint qualification; no Supabase or
ElevenID deployment changes are assigned here. Run local checks, preserve actual
failures and reviews, and publish with `[skip ci]` under the existing authorization.
