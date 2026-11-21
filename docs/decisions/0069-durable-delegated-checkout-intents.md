# ADR-0069 — Durable delegated checkout intents and receipt evidence

Status: authorized bounded development assignment before implementation.
Base: `bae37e8f55130328a5e5f4ba2a4a35549bf58388`.

## Assignment

The owner's instruction “Continue with next milestone” continues the authority
for local development, Git handoff and pushes. Assign `RCG-4A-NATIVE-INTENTS`
to the root integration agent on `feat/rcg4-native-intents`. Reuse the standalone
assignment precedent in ADR-0067/0068. An independent authority reviewer and an
independent regression reviewer assess the fixed final candidate. This is local
development; formal acceptance, deployment and release qualification remain open.

Fresh authenticated provider inspection found Marty UI main at
`f479d568a9ef750d804e6dde61ab70b318700963`, with PR #1994 still draft/unmerged at
`aec45c6176618b3fe12d7e51e6809c4ba2d87126`. Its route contract, registration,
OpenAPI and discovery provide no delegated receipt/current-state/final-use
transport. Protocol main remains `a9ce6a1d912f22a5627faebb482c44b9104d840d`.
The protocol repository is now reported private: its merged reference vectors
are available through authorized access, not assumed publicly redistributable.
Keep those bytes outside Git. No provider endpoint or final-use semantics may
be inferred from payload schemas or an internal service implementation.

## Bounded outcome

Add a durable customer-scoped checkout intent with original preview/context
identity, immutable request/context digests, original expiry and one verified
receipt observation. Preserve the identity across retries and process restarts.
Support local cancellation and retained-status reads. Every projection remains
`execution_authorized: false`; no provider consumption, purchase, payment,
operation queue, worker, send/retry lifecycle or public route is added.

Preparation accepts only original preview/context IDs and obtains current facts
from the existing native owners. Deterministic identity is scoped to tenant,
store and those original IDs. Same identity with changed facts conflicts.
Challenge and receipt fingerprints prevent reuse by another local intent within
the tenant/store and configured issuer/organization. These are local duplicate
checks, not provider replay prevention. Exact token retries may return retained
status without pretending to perform fresh verification; changed token input
conflicts. Cancellation, expiry, minimization and restore do not release claims.

Use one strict document kind in `commerce_support_documents`; no migration.
Keep bounded validated scans, canonical body/digest checks, fixed row ownership,
monotonic revisions, coherent lifecycle flags and terminal fingerprint tombstones.
Persist only a bounded purchase summary, exact binding digests and receipt
projection. Do not persist raw compact JWS, session/proof tokens, keys, full
server contexts or configurable executable callbacks.

## Current authority and atomicity

Reuse `DelegatedCheckoutReceipts` for cryptographic verification and its shared
current-context/trust/source/proof/deadline checks. A private WeakMap may bind the
actual returned immutable evidence object to its original verifier instance,
scope, preview, context and deadlines. A synchronous internal assertion rejects
serialized/caller-constructed objects and revalidates those original owners.
Use the same provenance pattern for a server-owned current binding capture.

The intent owner awaits actual verification, then performs the binding check,
duplicate/revision checks and SQL write in the existing synchronous kernel
transaction. Recheck current authority after hashing and persistence before
commit. No await or arbitrary callback is allowed in this completion path.
Any final failure rolls back the entire local change. Persisted data can never
reconstruct the WeakMap provenance or the process-local preview owner.

After restart, current customer proof may allow a retained-status read. Missing
original preview/context/trust prevents further capture. New facts require a
separate explicit intent, never replacement of the original identity.

## Privacy, recovery and portability

Add typed new-kind hooks to subject export/discovery, resource reassignment,
normal/held/already-erased erasure, uninstall, safe recovery and first/repeated
merchant import. Select original subjects from retained hashes even when they
have no current resources. Holds retain required personal bytes but revoke use.
Unheld erasure/cancellation/uninstall minimizes personal content while preserving
bounded duplicate-refusal identity. Restore/import revokes use; current external
suppression wins over old copies and held personal histories fail closed unless
suppressed. Validate transferred records before mutation and destination records
on repeated import. Keep body/digest/row state coherent after generic revocation.

## Allowed paths and controls

Runtime scope: new `delegated-checkout-intents.mts`,
`delegated-checkout-intent-records.mts`, `delegated-checkout-intent-privacy.mts`,
the minimal shared current/provenance accessors in
`delegated-checkout-receipts.mts`, and explicit hooks in `privacy-lifecycle.mts`,
`safe-recovery.mts`, `merchant-portability.mts`. Supporting scope: a new native
contract, focused tests/helper, this decision, the work record, current plan and
architecture/guide updates. Do not change the generic operation/dispatch owners,
migrations, public routes, root/optional manifests, upstream code, or old tests.

Under ADR-0008, append the actual new source members, proposed capability and
test registrations. Only source membership/count observations in the licensing
fixture may change. The privacy contract may add the new document kind's handling
to the existing SQLite document surface and its runtime/implementation pins;
retain all fifteen surfaces, schema and existing handling/qualification. Refresh
catalog source pins only if the changed existing source is already an included
transitive input; retain adapter operations, cases and fixtures unchanged.

Demonstrate a targeted behavioral failure before the fix. Run focused new
atomicity/idempotency/privacy/recovery cases and unchanged affected receipt and
lifecycle regressions. Retain inherited type/catalog failures explicitly, use
candidate-bound independent reviews and preserve the Git handoff. Do not alter
accepted goal criteria, the accepted ledger or prior test denominators.

## Prior corrective supplement: exact time and terminal expiry

Independent preliminary review reproduced a duplicate claim through synchronous
source reentry, revival after an observed expiry followed by clock rollback, and
loss of the existing receipt profile's nanosecond precision in integer history.
Authorize a final inert scoped SQL uniqueness/capacity check after all callbacks,
a durable one-way expiry observation marker, and reuse of the existing binder's
strict timestamp parser through an export alias. This minimal additional edit to
`delegated-receipt-binding.mts` exposes its existing implementation unchanged;
do not introduce another parser or alter prior accepted timestamp semantics.
Store the first integer-millisecond instant at or after receipt expiry, retaining
the original exact receipt timestamp. Refresh only the existing affected catalog
source pin. Observe expiry through current authorized reads/capture entry without
renewing original deadlines, and retain that terminal observation across restart.
