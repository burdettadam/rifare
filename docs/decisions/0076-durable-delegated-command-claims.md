# ADR-0076 — Durable original delegated-command claims

Status: bounded delegated assignment before implementation.
Protected source: `031bd324ec270c4b75268928587f1bfbcba5a454`.

## Assignment and ownership

The owner again requested continued development. Under existing delegated
development and feature-branch publication authority, assign **RCG-4B-C2**:
durable local P03 original-command claims and immutable result observations.
Root owns integration in `feat/rcg4b-command-claims` / `rifare-command-claims`.
`command_consumer_impl` writes only its five new paths below, in a separate
worktree created from this committed assignment. Independent review remains
`commerce_checkpoint_audit` (authority/security) and `receipt_regression_review`
(regression), with at most three corrective rounds. Neither reviewer authors
the implementation or its test oracle.

The fresh provider read remains open draft
`1063f32b5f65094ca3f98351804ff4b5994fc87b`; the Protocol remains
`6126da7619e057be2ff58dd38a5d50f49891d1b3`, as pinned in
[the C1 record](../../work/records/RCG-4B-C1.md). Internal current access,
EXACT_OPERATION policy and protected mutual-TLS request/proof ingress exist.
Public use serving, deployment, credential/certificate lifecycle, selected
attestation and independent public-consumer qualification remain upstream.
The separately active provider conversation owns that work. C2 installs no
transport or provider route and does not read private provider state.

## One technical retention owner

Use a new strict `delegated_command_claim` kind in the existing
`commerce_support_documents` table; retain all 46 migration files unchanged.
Do not extend `delegated_checkout_intent` v1: preparing that existing native
intent requires an independently established receipt context, while the original
START command must be retainable before such a context exists. This new journal
owns protocol originals and unverified observations only. Existing checkout,
receipt verification, business operations and provider execution keep their
current owners. Do not call `queueOperation`, create operation/work/lease rows,
or introduce a second checkout state machine.

The fixed constructor configuration is a detached, descriptor-checked frozen
closed value: `provider_ref` (native ID grammar, 1–96 characters), lower-case
non-nil UUID `organization_id`, and existing typed `Principal` restricted to
SERVICE_ACCOUNT or MACHINE_IDENTITY with an opaque local actor ID matching
`[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}`. This is a deliberately limited local
correlation namespace, not URI qualification, credentials or authenticated
provider identity. Bodies cannot select or override the configuration.

Hash the complete configuration with a domain separator. Claim identity hashes
tenant, store, namespace digest and original command UUID. Keep and compare the
full digest even if the row ID abbreviates it. Exclude resource, subject, kind
and command digest from identity, so changing any of those cannot reclaim an
occupied original UUID. Bind original native resource and subject immutably.
For FINALIZE, retain and enforce a namespace/challenge-UUID fingerprint within
tenant/store across all terminal and minimized records. This is local challenge
non-reuse; no proof-nonce equivalence or START-parent authority is inferred.
Different stores or configuration digests remain separate local partitions;
neither this identity nor the command digest is provider-wide deduplication.

Expose synchronous `claim`, historical `read`, `observe`, `recovery` and
revision-bound `cancel`. Reuse the unchanged C1 encode/bind/recovery functions.
Only START_USE and FINALIZE_USE may be claimed. Exact repetition converges;
same UUID with a changed valid mutation conflicts. Unresolved claims remain
occupied without expiry, retry, takeover or replacement. The first observation
is immutable: use its retained response as C1's `previous` input internally.
A later identical result may change only `recovered`, without replacing the
first stored response, observation time or revision. Derive recovery from the
complete retained original, never just caller-supplied hashes. Terminal claims
cannot accept new observations or regain personal content.

Store one canonical request string and at most one closed response object in
a nullable personal projection with original customer and configuration. Retain
identity, namespace, original UUID, command kind/digest, original resource/subject,
FINALIZE challenge fingerprint, first response/result hashes, revision and local
timestamps outside that projection. States are `claimed`, `observed` or
`cancelled`, with separate monotonic retirement/minimization. No raw JWS, proof
submission, bearer, credential or signing key is stored. Bound canonical body
bytes to 16,384 and validation scans to 10,000 rows per tenant/store. The narrow
C1 fields and bounded correlation strings fit this ceiling; reject oversize
records rather than truncate. Parse exact shapes, recompute all available
bindings, check row/body coherence and uniqueness, and use digest/revision CAS.

Derive access only from opaque native Scope and `growthCustomer`; require actual
customer role and current proof before record lookup, parsing or disclosure.
Return a non-disclosing denial for another original resource/subject. Repeat
current access checks after writes, then perform an inert SQL identity/digest/
uniqueness fence after all callback-capable checks. Mutations reject an already
active SQLite transaction before database work; they return only after the
kernel's top-level commit. Typed privacy helpers remain composable inside their
existing enclosing transaction. Local mutation clocks cannot move backwards.

All public journal views remain explicitly historical/unverified with
`execution_authorized: false`, `provider_authenticated: false` and
`receipt_signature_verified: false`. Native ownership permits retention access;
it does not bind arbitrary protocol intent to a current native purchase. An
observation is supplied through this local API, not an authenticated transport.
No method creates a ReceiptContextSource, verified receipt, `evidence_verified`
intent, send permission, callback or merchant effect.

## Privacy, holds and restored records

Ship typed export, original-subject discovery, erasure, hold, uninstall,
safe-recovery and first/repeated merchant-import handling with the journal.
Cover detached/reassigned resources and subjects without remaining resources.
Held bytes become unusable immediately and are hidden from ordinary views;
authorized privacy export may retain them. Minimize unheld personal content
while retaining refusal identities and fingerprints. Current suppression wins
over replayed personal bytes and obsolete copied holds. Restored/imported claims
are permanently retired and minimized; unsuppressed held personal records reject
restore atomically. Validate original transfer rows and current destination
independently. First import's existing generic row pause has a narrow typed
parse exception; ordinary/repeated validation stays strict. Never rehydrate a
minimized record or reconstruct live native provenance from retained data.

## Exact allowed paths and control maintenance

The implementation writer owns only new:

- `packages/commerce/delegated-command-claims.mts`;
- `packages/commerce/delegated-command-claim-records.mts`;
- `packages/commerce/contracts/delegated-command-claims.v1.json`;
- `tests/development/delegated-command-claims.test.mts`;
- `tests/development/delegated-command-claim-helpers.mts`.

Root owns the other eight new paths: this ADR,
`work/records/RCG-4B-C2.md`, `docs/DELEGATED-COMMAND-CLAIMS.md`,
`packages/commerce/delegated-command-claim-privacy.mts`, and
`tests/development/delegated-command-{privacy.test,process.test,process-child,catalog.test}.mts`.
Root may add narrow typed hooks in `privacy-lifecycle.mts`, `safe-recovery.mts`
and `merchant-portability.mts`, without changing existing typed owners or generic
algorithms. Relevant current descriptions/links in ARCHITECTURE, PLANS, ROADMAP
and DELEGATED-COMMAND-CONSUMER may be updated.

Append these thirteen new source members, real executable case IDs and one
proposed capability in existing component/regression inventories. Under ADR-0008,
only licensing oracle source count/reason changes to actual committed membership.
Preserve all 3,659 previous case rows, 231 capabilities, 399 protected entries
and 1,800 original source members. Privacy retains the exact schema digest
`1be56171e04e051e0402ac4ccb339b0f1c910a09f8f358001e0a3e62cb70ff3b`
and 15 surfaces; append the three new runtime modules, refresh only the three
changed lifecycle-module hashes and add membership/retention text to the existing
document and process-memory surfaces. Preserve all other old runtime pins.

An independently reproduced C1 omission requires a specific additive catalog
repair: protected 031bd32's validator throws
`ADAPTER_CATALOG_UNDECLARED_ADAPTER_SOURCE` for the sole undeclared adapter,
`packages/adapters/delegated-commands/command-codec.mts`; all existing pins match.
Authorize a diagnostic `delegated_use_commands` adapter with four native,
sandbox-only operations (encode, recovery, response binding and receipt-byte
correlation), its unchanged C1 source pin, and references to the existing twenty
codec cases. Append the corresponding declarations/contracts/operations/native
cases to `expected-coverage.v1.json`; preserve all old rows, case names and
semantics. Append exact codec/contract/oracle dependencies as needed within the
unchanged 262,144-byte canonical catalog budget. For existing catalog oracle
pins, authorize only SHA refreshes for the three narrowly changed lifecycle
modules. Add a small bounded catalog test; do not modify the old catalog test's
assertions, fixture engine, runner, oracle or limits to obtain a pass. Its legacy
nested first case still asserts earlier 38/199/262 totals despite the protected
catalog's existing 46/221/308 totals; that pre-existing broader gate remains
deferred and is not claimed green by this repair.

No codec/parser/native-intent changes, SQL migration, API route, browser asset,
dependency, workflow, old test edit, acceptance-ledger update or upstream provider
edit is assigned. Existing authorized feature publication uses `[skip ci]` and
does not dispatch Actions, merge the default branch, release or deploy.

## Behavioral proof and review

Write bounded unit and lifecycle tests before the corresponding implementation.
Preserve the codec's independent synthetic oracle; use actual native customer
fixtures and SQLite. Test complete mutation conflict, cross-resource/subject
denial, immutable response/recovery, terminal challenge non-reuse, nested
transaction rejection, failed commit rollback, final access fences and no
business-effect rows. Separate file-backed child processes must demonstrate
restart after a committed response is lost, concurrent same-ID convergence and
changed-payload conflict. Promise.all on a synchronous API is not concurrency
evidence. No provider or real customer is involved.

Normal invocations retain at most 60 planned cases/four whole files/60 seconds.
Use a journal/unchanged-codec/unchanged-native-recovery group; a privacy/unchanged
intent-privacy/privacy-coverage group; and a separate small process/catalog group
for those concrete distinct risks. No broad regression or browser campaign is
needed. A missing module is not behavioral red. Reviewers execute isolated
targeted mutants of the finished code: remove same-ID command-digest equality,
and separately remove final-challenge non-reuse; relevant unchanged assertions
must fail while schema/UUID checks remain. Neither mutant enters product code.

Bind actual reports, source/runtime facts and both independent reviews to the
exact clean candidate. Keep raw evidence ignored and concise decisions in Git.
Closing documentation may use explicit runtime/test/source equivalence rather
than repeating product tests. C2 closes local retention only: authenticated
provider identity, current native purchase binding, public transport, actual
execution, full RCG-5/6 and production qualification remain separate work.
