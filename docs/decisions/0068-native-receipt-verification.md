# ADR-0068 — Native local delegated receipt verification

Status: authorized bounded development assignment before implementation.
Base: `9bf387278a496c71bcca327873dc5233fe004ca6`.

## Assignment and authority

The owner instructed “Continue with next milestone,” continuing the authorization
for local development, Git handoff and remote pushes. Assign
`RCG-3-NATIVE-RECEIPTS` to the root integration agent on the isolated
`feat/rcg3-native-receipts` worktree. Follow the standalone assignment precedent
of ADR-0067; retain canonical goal criteria, the accepted ledger and all existing
test expectations. Independent authority and regression reviewers assess a fixed
candidate. Formal product acceptance and release qualification are separate.

## Reconciled upstream boundary

`ElevenID/marty-protocol` commit
`a9ce6a1d912f22a5627faebb482c44b9104d840d` publishes real synthetic ES256 and
EdDSA decision-receipt vectors and the draft JWS envelope. Runtime work in
`ElevenID/marty-ui` PR #1994 remains draft/unmerged at
`aec45c6176618b3fe12d7e51e6809c4ba2d87126`; normal public Gateway routes,
managed receipt signing and transactional final use are not established.

Implement local cryptographic verification and native evidence binding against
that pinned draft profile. No endpoint or provider transport is inferred. Keep
provider capability, remote agent authentication, final use and merchant
execution unavailable. An accepted signature remains evidence only.

## Bounded implementation

- Port the existing receipt claim binder to the native checkout and digest owners.
  Retain its prior behavioral obligations and fix the independently reproduced
  final-hashing expiry defect with a red-before-green regression.
- Use `jose` 6.2.18 for compact JWS and key import; do not implement signature
  primitives, wallet verification, Cedar, OAuth or key discovery.
- Require configured public keys bound to issuer, purpose, algorithm and key ID.
  Reject caller-supplied keys/URLs, duplicate JSON names, malformed encodings and
  unsupported header fields. Retire in-flight work when the verifier closes.
- Add a native evidence service taking only preview/context IDs and compact JWS.
  Resolve external pins through a trusted server-local synchronous context port;
  fixture mappings belong in tests. Derive local scope from the native preview.
- Reuse a synchronous `CheckoutPreviews.current(scope, id)` accessor for the
  final current-source/current-authority check. Check context revision and trust
  retirement first, then native facts and final receipt/preview deadlines.
- Bound in-flight work. Return frozen non-executing evidence without storing raw
  tokens, creating operations or claiming receipt redemption or replay control.

Allowed runtime paths are `packages/commerce/delegated-receipt-binding.mts`,
`packages/commerce/delegated-checkout-receipts.mts`, the minimal current/binding
accessors in `checkout-previews.mts`, and the optional verifier workspace
`packages/adapters/delegated-receipts/`. Allowed supporting paths include a new
receipt contract, focused tests/helpers, local vector preparation tool, guides,
this decision and the work record. Keep operations, action gateway, public routes,
migrations and existing behavioral fixtures unchanged.

## Prior dependency-intake decision

The root command profile remains exactly dependency-free. Before implementation,
authorize one separately installed, unbundled runtime workspace containing only
`jose: "6.2.18"`. Its official archive has integrity
`sha512-doV4thUwgkrycJH4yLeqwTGIIZphHl+pk7CPReuMIhYhncmgzdko85MaCG4YQFTxqMFr1/oEH32tZuKKovcDEg==`,
MIT terms, no runtime/transitive dependencies and no installation hooks.
Record exact manifest/lock bytes and official provenance; install with scripts
disabled. Package bytes and their original notices remain under ignored
`node_modules/` and are excluded from source exports.

Extend `tools/check_distribution.py` only for that exact workspace and graph,
retaining root/formatter rules and rejection of unknown manifests, packages,
hooks and pin changes. Preserve the legacy empty dependency observation for its
root command-profile scope; explicitly report optional runtime inputs separately
and application dependencies as present. Add independent intake tests and retain
all original intake/distribution tests. This source/development exception does
not relax the existing binary/container release audit or frozen license records.

The upstream vector's root LICENSE is proprietary while its README still says
Apache-2.0. Do not relabel or redistribute those bytes inside Rifare. Reference
the exact source and hash, stage a separately obtained copy only in ignored local
evidence for conformance, and generate distinct original synthetic signing cases
for native checkout tests. No upstream verifier implementation is copied.

## Registration and review

Append actual new source/test membership and proposed capability evidence under
ADR-0008, retaining old registry rows, components and obligations. Only source
membership/count observations in the licensing fixture may change. After
independent privacy review, register new runtime pins and the changed preview
owner in existing process-memory classification; preserve all fifteen surfaces,
schema, handling and qualification states. Source-catalog pins may change only
where an included changed source requires it; adapter operations and case
definitions remain untouched. No accepted baseline is redefined by this work.

Use focused native runs within the ordinary budgets, separate dependency-intake
and privacy checks, independent protocol-vector verification and candidate-bound
authority/regression review. Record publication only after an observed write.

## Prior integration supplement: optional installation and catalog membership

Inspection before candidate registration found two integration obligations.
The unchanged privacy observer inventories all executable files under `apps/`
and `packages/`, including a nested dependency installation. The unchanged
adapter catalog also requires every adapter module to have an explicit owner.
Keep both discovery controls intact.

Authorize `tools/install_receipt_runtime.py` and its focused tests to install the
unchanged pinned workspace through `npm ci --ignore-scripts` in an owned temporary
prefix outside those runtime source roots, then promote only the verified JOSE
package to ignored repository-root `node_modules/jose`. Preserve unrelated
installed packages, refuse an unexpected destination, retain upstream notices,
and leave the root package/lock and exact optional manifests unchanged. Ordinary
Node module resolution continues to apply; there is no custom runtime loader.
Document this setup and the need to reinstall after a root `npm ci` prunes it.
The privacy inventory continues to cover first-party runtime sources; installed
third-party artifact review remains a separate, unqualified boundary.

Authorize one additive local diagnostic receipt-verifier catalog entry, its new
source declarations and bindings to this increment's new executable JOSE cases.
The corresponding expected-coverage fixture may add only those new rows. Retain
every existing adapter, operation, native case, direct fixture, scope, version and
qualification unchanged. This is local cryptographic evidence coverage, not a
Marty provider transport or final-use operation. Independently review the exact
registration diff before closing the candidate.
