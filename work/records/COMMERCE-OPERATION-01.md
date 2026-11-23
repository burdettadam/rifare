# COMMERCE-OPERATION-01 — Medusa PostgreSQL original-operation journal

State: implemented and exercised locally. Privacy-owner integration and independent review are pending.
Protected base: `84e0e0e4c76b6b44eebe802c55ce0820d5608650`.
Branch: `feat/medusa-operation-journal`.
Assignment: [ADR-0084](../../docs/decisions/0084-medusa-operation-journal.md).

## Why this increment

The prior local SQLite command journal is a useful behavioral contract but is not the persistence owner for the selected Medusa/PostgreSQL application. The cart observation endpoint is read-only and explicitly not an atomic currentness fence. A native operation journal is required before ElevenID authority can be bound to an actual Medusa commerce effect.

## Ownership

- Medusa owns the native commerce records and workflows.
- ElevenID owns identity, credentials, trust and delegation evidence.
- Rifare owns merchant policy, approvals, original cross-system operation identity, idempotency and reconciliation.

No shared Supabase subject/email is treated as ElevenID membership. Another workstream owns Marty; this assignment makes no ElevenID repository changes.

## Required implementation

Implement a narrow Medusa module/service and PostgreSQL migration in the existing commerce application. Database constraints—not process-local locking—must arbitrate original command identity and FINALIZE challenge non-reuse. The service must support durable admission, status, immutable first observation, recovery preparation and revision-bound cancellation. It must bind the operation to the exact native cart/customer/store/merchant and currency-safe payable amount.

Admission must use a supported PostgreSQL transaction strategy with actual row locking/re-read and commit the original operation before any network call. The initial implementation must not send commands, call ElevenID, or execute commerce. It can persist only a verified native operation as `awaiting_authority`; it cannot claim approval.

Privacy export/hold/erasure/restore/import and suppression hooks are required before personal data is persisted. Keep credentials, tokens, proof bytes, keys and raw JWS out of the journal.

## Evidence ledger

| Item | Status |
|---|---|
| Protected base and branch | Complete |
| ADR and assignment | Complete |
| Medusa/PostgreSQL schema and migrations | Applied and rerun on disposable PostgreSQL 16 |
| Serializable admission and database uniqueness | Implemented and locally exercised |
| Native tests with independent DB connections/processes | Passed, including committed original after lost response |
| Existing identity/cart/commerce regression | Passed on local checkpoints below |
| Deliberate unique-constraint/currentness faults | Original uniqueness, cart lock and cross-owner check faults verified |
| Independent reviews | Not run |
| Publication of implementation | Not done |

Checkpoints below identify the exact local evidence and remaining qualification. Acceptance and production qualification remain open.

## Branch and dependency checkpoint

Codex owns the linked checkout at `../rifare-operation-journal` relative to the
primary Rifare checkout. The starting checkpoint is
`1c28a13eea3cbebdb3df191d96096e4a2d7b4ff2`, verified against the published
branch. There is no open Rifare pull request. All eight historical delegated
checkout and receipt branch tips are ancestors of this checkpoint. Development
at `202ea5320606049e0f4f740f6a96fc3bb5a09ebf` has two documentation commits
whose net tree matches the common base. Preserve the existing refs.

From `apps/commerce-backend`, `npm ci --no-audit --no-fund` passed using
Node 24.14.1 and npm 11.11.0. It installed 952 packages with the unchanged
committed lockfile. `npm ls --depth=0` confirmed Medusa 2.23.0 and TypeScript
5.9.3. The installed `node_modules` belongs to this checkout and can be retired
after the final local qualification and source checkpoint are preserved.

The Medusa 2.23.0 repository selects the supplied transaction manager, and
MikroORM's SQL entity manager passes its active transaction context to SQL
execution. The next test must establish that native cart facts and journal
admission use the same PostgreSQL transaction, including an independent
connection holding a competing cart update. The install result provides
dependency evidence only.

Fresh disposable PostgreSQL 16 migrations and `npm run test:commerce`
passed all 17 native baseline groups on the same source checkpoint. This used a
loopback-only Docker fixture and Medusa's synthetic manual payment provider.
The commerce config suite passed 7 cases and checkout preview passed 16 cases.
The retained runtime config suite passed 14 of 16 cases. CFG-04 and CFG-06
failed in fixture setup because Windows refused symlink creation with EPERM.
The cases remain enabled and require a symlink-capable test environment.

## Native cart locking test

On November 22, 2026 (America/Denver), Codex ran
`node run.mjs exec ./src/scripts/verify-operation-cart-lock.ts` using
Medusa 2.23.0 and the local PostgreSQL 16 Alpine image
`sha256:16bc17c64a573ef34162af9298258d1aec548232985b33ed7b1eac33ba35c229`.
The freshly migrated fixture listened only on loopback. Its independent
PostgreSQL backends 146 and 147 demonstrated actual blocking using
`pg_blocking_pids`. After the writer committed, the reader saw the new native
cart value. Rolling back the reader left the committed value visible through
Medusa's Cart service. TypeScript passed with `tsc --noEmit`.

A disposable script copy with only `.forUpdate()` removed failed at the intended
blocking assertion after migrations succeeded. The copy and fixture containers
were retired. This test establishes the behavior of the native cart row lock
through Medusa's PostgreSQL connection. The journal must still bind its write
and every fact contributing to admission to the same transaction. Codex owns
that next implementation and its independent-process and privacy qualification.

## Journal schema checkpoint

Medusa 2.23.0 generated Migration20261123030615.ts (Git blob 96e000f118e293030e15d6d48620b77edf90252d)
for the local journal module. The original UUID and challenge fingerprint have
unconditional PostgreSQL unique indexes. UUIDs are reserved across merchant
and customer changes, including after retirement. The module exposes no CRUD
or admission entry point yet. Privacy lifecycle and guarded service methods
are required before admitting personal data.

On November 22, 2026 (America/Denver), fresh disposable PostgreSQL 16 passed
npm run db:migrate twice and verify-operation-journal-schema.ts through
the Medusa exec launcher. The schema check exercised cross-merchant original
UUID reuse, challenge reuse, missing customer binding, amount overflow, and
retirement without identity or challenge reuse. Dropping just the original UUID
index in a disposable fixture made the expected rejection assertion fail and
allowed two rows with one UUID. All 17 native commerce groups, 7 config cases,
6 external identity config cases and TypeScript also passed. The disposable
schema fixtures were retired. Codex continues on the linked checkout with the
transactional admission service, ownership checks and privacy lifecycle.

## Transactional cart facts checkpoint

On November 22, 2026 (America/Denver), the journal cart reader used the
existing Medusa PostgreSQL connection and required a serializable transaction.
It locked live native rows in stable order, bounded related-row reads, and
used the pinned Medusa totals helper and existing Rifare cart projection.

The disposable PostgreSQL 16 run of `npm run test:cart-context` passed all 22
retained groups and the new transaction group. The new group rejects use
outside a transaction or at the default isolation level. Within a serializable
transaction it compares the complete facts and digest with the native HTTP
observation after an item update, an address change and a credit. The fixture
also contains an item promotion, taxes and shipping. The decimal assertion now
follows the changed row ID through canonical sorting. TypeScript passed.

The existing observation profile rejects persisted shipping adjustments that
lack its required tax-inclusive flag. Medusa 2.23.0 has no such column on
shipping adjustments. The transaction reader preserves that refusal. The
admission service still needs native association checks, the journal write in
the same transaction, and concurrent and privacy lifecycle verification before
handling personal data. Codex continues on the linked checkout.

## Ownership checks in the cart transaction

The journal cart reader now requires a verified Medusa customer and channel
context from its internal caller. In the serializable transaction it checks
the actual cart owner, the configured sole live store, the active sales
channel, the registered customer and the current auth-identity association.
It refuses an existing order link before projecting cart facts. The digest
binds the customer and auth identity under the server merchant and store.

On November 22, 2026 (America/Denver), TypeScript and all 24 groups in
`npm run test:cart-context` passed on disposable PostgreSQL 16. New cases
cover the wrong owner, guest, wrong store or channel, mismatched or stale
native identity, and an already-ordered cart. A copied reader with the
cart-owner comparison removed passed the positive projection check and
failed the cross-owner refusal assertion at the expected line. The fault
copies and both containers were retired. Admission and privacy persistence
remain open. Codex continues on the assigned linked checkout.

## Original command encoding

The local journal accepts one versioned preparation command. The exact
canonical UTF-8 JSON fields in alphabetical order are cart_facts_digest,
cart_id, command_id, currency, currency_exponent, kind, payable_minor_units
and profile. The kind is prepare_purchase and the profile is
urn:rifare:medusa-original-operation:v1. The service owns all merchant,
store and actor binding fields. The command parser returns the original
canonical bytes and their SHA-256 digest. The cart match compares the native
cart ID, digest, exact payable minor units, currency and exponent.

On November 22, 2026 (America/Denver), all 25 groups in the native
cart-context suite passed on disposable PostgreSQL 16, including 22
retained groups. The new group checked the exact-byte digest, rejected
noncanonical or malformed inputs, and rejected changed facts, cart, amount
and currency against the locked transaction result. TypeScript passed.
The fixture was retired. The command remains an internal preparation input.
Codex continues on the assigned linked checkout with the privacy hooks and
transactional journal write.

## Subject erasure and hold checkpoint

The generated Medusa migration adds a privacy subject table keyed by an
HMAC of the native customer and configured merchant/store partition. It
stores the keyed digest, suppression flag and timestamps. The transaction
upsert takes the same subject row lock for admission checks, erasure and
hold changes. The caller must keep the privacy key stable and private.

Erasure retires held rows while retaining the data required by the hold.
Unheld rows and held rows released after erasure clear cart and customer
references, merchant/store linkage, actor/facts/command/observation digests,
canonical bytes, and money fields. They retain the original operation ID,
original command UUID, challenge fingerprint, retired state, revision and
timestamps. Retained identifiers are duplicate-refusal data. Privacy
exports, uninstall, restore and import still require their owning callers
and verification before the admission service is enabled.

On November 22, 2026 (America/Denver), TypeScript, two migration runs on
fresh disposable PostgreSQL 16, the native schema check and the new native
privacy check passed. The privacy check covered atomic rollback, durable
suppression, stable repeat erasure, row scoping, stale holds, release
minimization and two independent PostgreSQL connections. PostgreSQL reported
that a competing suppression check waited for the in-flight erasure, then
the check saw suppression after commit. The disposable fixture was retired.
Codex continues on the assigned linked checkout.

## Export, uninstall and transfer checkpoint

The internal privacy hooks now export retained subject rows under the same
subject lock, including retired material under hold. An installation marker
shares a lock with subject operations and records uninstall for the selected
merchant/store. Uninstall retires that installation's held rows and minimizes
its unheld rows. A later subject check remains suppressed even if the
customer had no operations before uninstall.

The trusted transfer owner can restore or import only the operation ID,
original UUID and challenge fingerprint. The hook inserts retired tombstones.
An exact repeat preserves the destination row and its current suppression.
A conflicting UUID, operation ID or challenge aborts the enclosing transaction.
Personal payloads are rejected. Admission and the owner wiring for these
internal hooks are still open. Whole-database recovery requires reconciliation
with current privacy markers before reopening any application traffic.

On November 22, 2026 (America/Denver), the latest TypeScript check, migrations,
and the native PostgreSQL privacy suite passed. The suite demonstrated
held export, scoped uninstall, repeat import, conflict rollback, rejection
of personal payloads and retained suppression after import. Both disposable
fixtures were retired. Codex continues on the assigned checkout.

## Transactional admission checkpoint

The local Medusa module now admits an original preparation command only with
verified native customer and channel context, the configured merchant/store
and a valid installation privacy key. One serializable transaction checks
privacy suppression, locks and reads native ownership and cart facts, then
inserts the exact canonical bytes and digests under the original UUID.
An exact repeat returns the original operation. A conflicting original,
wrong owner, stale facts or erased subject is refused. Local serialization
failures retry the same transaction and original. The only created state
is awaiting_authority.

On November 22, 2026 (America/Denver), TypeScript and all 27 native cart
groups passed on disposable PostgreSQL 16. The journal cases checked missing
configuration, unchanged retry, conflicting bytes, stale amount with no
admitted row, cross-owner denial and erasure. Independent Medusa processes
converged on one original. In a separate attempt the first process committed
a fresh original and exited before returning its ID. The parent recovered the
same row by repeating the original bytes. The disposable fixtures were retired.

Codex continues on the assigned linked checkout with status, immutable first
observation, revision-bound cancellation, and explicit recovery preparation.
The authorized privacy-owner integration still requires verification.

## Status, observation, recovery and cancellation checkpoint

The internal Medusa service rechecks current customer, identity, cart, channel
and store ownership before accessing historical records. Status includes the
first observed digest and timestamp. Recovery preparation returns the saved
operation ID, original UUID and command digest. The service records its first
local cart observation once, without changing authority state. Revision fences
protect observation and cancellation.

Cancellation retires and minimizes an unheld operation while retaining its
duplicate-refusal identifiers. A held operation is cancelled and hidden from
ordinary journal access. Releasing that hold retires and minimizes it. The
original UUID is never made available again.

On November 22, 2026 (America/Denver), TypeScript, 28 native cart-context
groups and the native privacy suite passed on freshly migrated disposable
PostgreSQL 16. Tests covered cross-owner denial at every new method, immutable
first observation after a cart change, stable recovery, stale revisions,
terminal non-reuse and hold release. The fixture was retired. Codex retains
the active checkout for final privacy-owner integration and independent
qualification and review.

## Installation privacy key and regression checkpoint

The verified local database now records a key binding at a stable digest of
the merchant and store. Subject privacy checks and uninstall verify that
binding before looking up suppression. A different configured key fails
closed instead of creating a blank privacy namespace. The deployment must
preserve its original key and privacy tables together. This checkpoint
does not qualify rekeying or physical database restore.

On November 22, 2026 (America/Denver), migration 20261123033322 applied on
fresh disposable PostgreSQL 16 and the migration command reran successfully.
TypeScript, the native schema suite, the expanded native privacy suite and
all 28 cart-context groups passed. The privacy suite supplied a different
key after erasure and after uninstall and verified that neither admission
checks nor export would accept it. Disposable containers were retired.

The immediately preceding journal checkpoint 1072d48 also passed all 28
synthetic OIDC identity groups and 17 native commerce groups on PostgreSQL.
The Linux configuration regression ran with Node 24.14.1 in Docker using
image sha256:80fc934952c8f1b2b4d39907af7211f8a9fff1a4c2cf673fb49099292c251cec,
with a read-only source mount and networking disabled. All 16 cases passed,
including CFG-04 and CFG-06, which Windows could not create fixtures for.
The local Node image is retained as a reusable qualification dependency.
Codex continues on the active linked checkout.

## Native shipping discount checkpoint

On November 22, 2026 (America/Denver), a freshly persisted Medusa shipping
adjustment reproduced the observation refusal recorded above. Medusa
2.23.0 persists no per-adjustment tax-inclusion flag on shipping adjustments
and its native totals treat the absent flag as tax-exclusive. The shared
projection now follows that convention only for shipping adjustments.
Line-item validation and previously representable digests are preserved.

On fresh disposable PostgreSQL 16, the native HTTP observation and locked
reader agreed on the discounted facts and canonical digest. An independent
money assertion verified that a USD 1.00 adjustment at ten percent tax
reduced the payable total by 110 minor units. All 29 cart-context groups,
including the admission and recovery groups, and TypeScript passed.
The fixture containers were retired.
