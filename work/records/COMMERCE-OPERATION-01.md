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
