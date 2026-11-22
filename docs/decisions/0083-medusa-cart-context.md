# ADR-0083 — Medusa cart ownership and observation

Status: assigned local development; approval and execution remain held.
Protected base: `afd678f44f25396c2159f0532f48fc46a3c4f129`.
Branch: `feat/medusa-cart-context`; sole writer/integration owner: root.

## Assignment and ownership

The owner requested continued development with Medusa owning commodity commerce,
an external authentication provider shared by separate application clients, and
ElevenID owning identity/trust/delegation. Assign **COMMERCE-CONTEXT-01** under the
existing delegated development authority. Another conversation owns Marty; inspect
its published interfaces read-only and make no upstream or provider-account changes.

ADR-0081 supersedes ADR-0080's SQLite-specific C6 composition. Preserve its public
wire, request-artifact and recovery contracts, but require a Medusa-native source,
original-operation journal and currentness/admission design before connecting C6.
An asynchronous cart read is not the retained synchronous transaction fence.

## Bounded implementation

Protect registered-customer carts through native customer bearer authentication,
current AuthIdentity/customer association and native customer/cart records. Cover
native cart routes and cart-dependent shipping/product context routes. Preserve
guest capability behavior only for an explicitly unregistered native customer (or
an unassociated cart); missing/deleted/ambiguous customer state must not downgrade
a protected cart. A customer token is never an operator or merchant permission.

Hold the native customer-transfer route: this profile supplies no guest-claim or
original-owner transfer proof. Validate nested line membership before native item
mutation and refuse caller-supplied address IDs/references on cart create/update.
Use native cart creation, pricing, promotions, taxes and shipping; do not introduce
another commerce engine. Keep every existing completion/payment/order/return hold.

Add a separately versioned authenticated observation endpoint. It reads an owned,
uncompleted native cart without an existing order linkage, an explicitly configured
merchant namespace and native store, and the selected publishable-key channel.
Project bounded native lines, adjustments, tax/shipping/credit facts, exact monetary
values and contact/address commitments. Use Medusa's decimal utilities and currency
digits, with a maintained deterministic serializer; reject unsupported precision.
Preserve fractional native components as exact major-unit decimals; separately
require an exactly representable minor-unit payable total, without invented rounding.
Keep time outside the stable facts digest. Reuse the native cart lock for a short
cooperative read and document its single-process/cooperative limitations.

This is an observation of persisted values, not fresh catalog pricing, stock
reservation, immutable approval, payment consistency, ElevenID account linking,
START/FINALIZE authority or durable execution currentness. Do not invoke native
refresh workflows that mutate payment collections inside the read. No receipt,
caller digest, email or shared OIDC subject supplies the missing service authority.

## Allowed paths and proof

Allow target application cart policy/observation source, middleware/configuration,
one native verification script, the exact `safe-stable-stringify` 2.5.0 direct pin
(already present in the locked graph), package/lock/intake, component inventory,
and scoped architecture/plan/work records. Preserve root dependency inputs, legacy
owners/tests/oracles, capability targets and the acceptance ledger.

Demonstrate real PostgreSQL/native HTTP behavior: own/other/guest/deleted/stale
identity cases; alternate cart consumers; nested item/address substitution; held
transfer/effects; exact native amounts; stable/reordered/changed facts; completion
and existing-order refusal; reads without commerce effects. Demonstrate an isolated
ownership-check fault with the unchanged cross-customer HTTP assertion. Retain the
existing native identity and commerce regressions. Normal focused checks retain
60 cases/four files/60 seconds; each native database/HTTP run has a separate
240-second deadline. Root writes product/tests; obtain two independent read-only
authority/security and regression reviews, at most three corrective rounds.

Existing feature-branch publication authorization applies with `[skip ci]`. No
default-branch merge, production migration, deployment, paid service, provider
account action, release tag or hosted CI dispatch belongs to this assignment.
