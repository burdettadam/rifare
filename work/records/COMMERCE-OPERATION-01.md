# COMMERCE-OPERATION-01 — Medusa PostgreSQL original-operation journal

State: assigned; implementation and verification not yet performed.
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
| Medusa/PostgreSQL schema and migration | Not started |
| Transaction/unique constraint design | Specified; implementation pending |
| Native tests with independent DB connections/processes | Not run |
| Existing identity/cart/commerce regression | Not run |
| Deliberate unique-constraint/currentness faults | Not run |
| Independent reviews | Not run |
| Publication of implementation | Not done |

No implementation, test, review, publication, acceptance or production claim is made by this assignment record.

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
