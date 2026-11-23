# Native delegated receipt evidence

[ADR-0086](decisions/0086-native-delegated-receipt-admission.md) implements receipt
verification and immutable retention in the Medusa/PostgreSQL operation journal.
The [work record](../work/records/RCG-4B-C8.md) binds local evidence and independent
reviews. No public receipt-admission route, proof submission, FINALIZE or commerce
execution is enabled by this integration.

## Internal interface

The trusted server constructs a verifier with
`createAuthorityReceiptVerifier(serverTrustBytes)`, then calls
`verifyAuthorityReceipt(originalCommandId, compactReceiptBytes, context, verifier)`.
The context comes from framework-verified customer authentication and sales-channel
access. The original must already have its retained native START, CHALLENGE and
complete authenticated C7 request observation. The service rechecks current
customer/cart ownership, privacy and exact original cart facts.

`recoverVerifiedAuthorityReceipt(originalCommandId, context, verifier)` verifies
the retained bytes against the same trust and original context. Both methods return
the receipt digest, original first observation, expiry and an opaque verifier-owned
handle. `verifier.describe(handle)` is internal evidence inspection; do not expose
its raw signed bytes or treat the result as an execution permit. Close the verifier
when retiring that trust selection. Forged or other-verifier handles are refused.

Exact recovery preserves bytes, digest, context commitment and first observation.
Different valid receipts, changed trust configuration or changed native facts cannot
silently rebind the original. State remains `awaiting_authority`; results declare
`execution_authorized: false` and `live_status_verified: false`.

## Trust and original context

The closed `urn:rifare:native-delegated-receipt-trust:v1` server configuration pins:

- Provider reference, organization UUID and complete managed-machine principal.
- Typed receipt issuer, represented subject and status issuer.
- Exact KEY thumbprint, policy ID/version digest and local currency/spending
  ceiling in integer minor units.
- One public receipt JWK, issuer, key ID, ES256 or EdDSA/Ed25519 algorithm and
  purpose `urn:marty:delegated-decision:jws-v1`.

Receipt claims and browser input cannot select those expectations. The reused JOSE
adapter refuses private keys, request-directed key URLs and alternate purposes.
Key rotation does not rewrite an original's immutable verification context.

The service derives the grant and entire purchase operation from the canonical
retained START/native original. It uses `urn:rifare:medusa-original-operation:v1`
and the original command digest, cart resource and store audience. The legacy
preview binder is unchanged and cannot supply this native digest.

The receipt's evaluation challenge is C7's authenticated retained **nonce**.
The Flow UUID binds START/request correspondence and cannot substitute for it.
Decoding an already authenticated retained request checks consistency; it does
not authenticate a fresh caller artifact or renew its lifetime.

The selected no-domain managed-machine profile requires exact closed claims,
PERMIT, matching principals/grant/KEY/operation/nonce/policy, signed ACTIVE status
and compatible proof/status times. Receipt expiry cannot exceed Flow challenge
expiry. Required domain evidence needs a separate assignment. Signed ACTIVE status
is historical evidence, not a live revocation lookup.

Database time is checked around awaited crypto/persistence and after COMMIT/current
cart reads. Recovery respects the persisted first-observation clock floor. Late
COMMIT can retain history while the returning current-evidence call refuses it.
Expired recovery never refreshes the original timestamps.

## Privacy and qualification

`Migration20261123110127` adds six nullable personal receipt fields: exact bytes,
digest, context commitment, UUID, first observation and expiry. A unique fingerprint
commits to provider, organization, issuer and receipt UUID independently of signing
key identity. It survives minimization to refuse reuse.

The existing privacy owner exports those fields, preserves an authorized hold and
clears personal content on erasure, uninstall or hold release. Reconcile current
privacy state after database restore before admitting work. Current four-field
refusal identities include the fingerprint. Legacy three-field records remain
compatible only where they discard no retained C8 fingerprint. A verified current
refusal can restore a missing fingerprint into an older minimized record;
conflicting identities and unique-index collisions fail.

Local qualification covers genuine synthetic signatures, actual PostgreSQL races,
rollback, separate-process recovery, trust retirement, late COMMIT, original/cart
binding, replay and privacy. The own-dependency compiled runtime, populated prior
schema upgrade/replay and whole-database restore cases also pass. Provider serving,
enrolled machine custody, live grant permission and final commerce execution remain
open. Preserve the public effect holds until those owners are composed and qualified.
