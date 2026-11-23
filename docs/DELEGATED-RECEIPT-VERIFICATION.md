# Local delegated receipt verification

RCG-3 adds real ES256 and Ed25519 signature verification and native checkout
binding. It returns **evidence with `execution_authorized: false`**. This is a
local implementation candidate under [ADR-0068](decisions/0068-native-receipt-verification.md),
not acceptance, remote provider qualification or merchant execution.

RCG-4A adds a separate [durable intent owner](DELEGATED-CHECKOUT-INTENTS.md).
The verifier shares synchronous current-state guards and nonserializable object
provenance with that owner. The verifier itself still stores no raw token or
durable authority; historical SQL evidence cannot recreate current provenance.

## Owners and authority

| Owner | Responsibility |
| --- | --- |
| `PinnedReceiptJoseVerifier` | Verify original compact-JWS bytes with `jose` and independently configured public keys; enforce strict envelope/JSON rules and trust retirement. |
| `DelegatedReceiptBinder` | Match authenticated claims to original expected identity, grant, operation, challenge, policy, domain and deadline facts; enforce the local ceiling. |
| `DelegatedCheckoutReceipts` | Resolve an original server-owned context and native preview from IDs, then recheck current context, trust, sources, customer and recovery authority after asynchronous signature work. |
| `CheckoutPreviews` | Own the original frozen purchase snapshot; synchronously check current native cart, proof, privacy, quotes and expiry through `current(scope, id)`. |

The application request contains exactly `preview_id`, `context_id` and
`compact_jws`. A caller cannot provide an expected-claims object, public key,
issuer URL, replacement preview or self-attested verification flag.

The server must supply a `ReceiptContextSource`. `resolve` returns a bounded,
original context tied to the native tenant, store, resource, customer, preview ID
and digest. `assertCurrent` checks exact context facts and current authority.
Both are synchronous; assertions return `undefined`, do no I/O and invoke no
callbacks. A promise or boolean is rejected. Establish external state before
publishing a context; never derive expected claims from the received receipt.
The production context source is deliberately absent. Fixture maps exist only
in the native tests.

No configuration means the service is unavailable. The configured `available`
property describes service configuration/closure, not ongoing key or provider
qualification. Each verification separately checks the current trust instance.
Rotate public keys by constructing a new verifier and closing the old one;
closing rejects its in-flight work. Closing the evidence service also prevents
pending completion. Timeout cancels the local wait, with no retry or late result.

## Signature and claim profile

The pinned upstream decision-evidence contract is
[`marty-protocol` a9ce6a1](https://github.com/ElevenID/marty-protocol/blob/a9ce6a1d912f22a5627faebb482c44b9104d840d/protocol/delegated-authority/DECISION-EVIDENCE.md).
Its profile remains draft. The protected header must contain exactly `alg`,
`kid` and `typ: mip-delegated-decision+jws`. Supported algorithm/curve pairs are
ES256/P-256 and EdDSA/Ed25519. The pinned key purpose is
`urn:marty:delegated-decision:jws-v1` and the issuer is independently configured.
The verifier accepts public JWKs only, with no remote lookup or runtime download.

`jose` authenticates the original signed bytes. A separate bounded scan rejects
duplicate decoded JSON member names, including escaped names, before returning
native frozen values. Fatal UTF-8, BOM, unpaired Unicode, unsupported headers,
noncanonical base64url, detached payloads and excessive sizes/depth deny.
The only supported numeric source spelling is a bare nonnegative decimal safe
integer. Fractions, exponents and negative tokens are rejected even if
`JSON.parse` would round them to an expected revision. This is a deliberately
narrow implementation subset of the draft profile.

The binder checks exact issuer, organization, actor, subject, KEY/SESSION
binding, original grant ID/revision/terms, status issuer, operation/audience/
request profile/digest, policy, challenge and required domain evidence. A signed
permit does not override the native purchase facts, currency or delegated
ceiling. Native monetary values remain canonical decimal minor-unit strings.

Receipt, proof, status and domain deadlines retain the earlier binder's exact
timestamp checks. The service also enforces original preview, context and local
session deadlines after all injected source callbacks. A final hashing operation
cannot move time past expiry unnoticed. Repeated evidence verification is
allowed; there is no redemption or replay-prevention claim.

## Local setup and focused verification

Install the supported Node runtime and the optional locked dependency with the
[workspace instructions](../packages/adapters/delegated-receipts/README.md).
The helper uses the exact optional manifests and installs JOSE in ignored root
`node_modules`. Root manifests remain dependency-free. Run the optional setup
again after a root `npm ci` removes that installation.

The upstream vector bytes are **not distributed with this source**. At the pinned
commit the root LICENSE says proprietary, while the README says Apache-2.0.
Use separately authorized source access and stage the exact vector locally:

```sh
python3 tools/prepare_receipt_vectors.py --source /absolute/path/decision-receipt-v1.json
python3 tools/dev_tests.py --files tests/development/delegated-receipt-binding.test.mts tests/development/delegated-receipt-hardening.test.mts
python3 tools/dev_tests.py --files tests/development/delegated-receipt-jose.test.mts tests/development/delegated-receipt-native.test.mts
```

The preparation tool checks the exact SHA-256 in
[provider-source.v1.json](../tests/fixtures/delegated-receipts/provider-source.v1.json)
and writes only to ignored evidence. There is no download fallback or silent
skip. The first three JOSE cases require that separately supplied fixture.
The other eleven JOSE cases generate original ephemeral synthetic signatures;
the local adapter catalog binds those cases and does not need the upstream file.
Native binding cases use separate original signed facts for the USD 68 checkout.

The merged upstream vectors have a fixed example request digest and historical
timestamps. They prove compatibility of original signature bytes, not successful
native checkout binding or current provider state. Independent Python
cryptography verification provides a separate signature oracle. The native
tests hold verified cryptography while revoking proof, changing quotes or
contexts, retiring trust and advancing original deadlines.

The source privacy observer is unchanged. All four new runtime modules use the
existing process-memory surface: public-key configuration, transient tokens,
claims, context snapshots and pending work. No new durable receipt/context store,
SQL schema or logging sink is added. Source inventory does not qualify installed
third-party packages, caller-held copies, physical deletion or deployment privacy.
Dependency provenance and an installed-artifact release review are separate.

## Remaining integration boundary

The inspected `marty-ui` runtime work is still
[draft PR 1994](https://github.com/ElevenID/marty-ui/pull/1994), pinned for this
inspection at `aec45c6176618b3fe12d7e51e6809c4ba2d87126`. Public Gateway
routes, managed receipt signing, transactional current-state checks with Flow
challenge consumption, and the qualified remote session source are not
established by this increment. M15 remote sender-bound authentication is also a
separate prerequisite.

The next integration assignment must consume an actually available provider
contract, establish current external context and atomic final use, and preserve
the separation between evidence, authority consumption and merchant execution.
Do not infer routes, wire the evidence result to an operation queue, or reuse
customer-note operation receipts as an authorization store.

See the [contract](../packages/commerce/contracts/delegated-checkout-receipts.v1.json)
and [work record](../work/records/RCG-3-native-receipts.md) for exact limits,
candidate identity, test scope and independent review disposition.
