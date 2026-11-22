# ADR-0084 — PostgreSQL original-operation journal and approval admission

Status: assigned; implementation and qualification not yet performed.
Protected base: `84e0e0e4c76b6b44eebe802c55ce0820d5608650`.
Branch: `feat/medusa-operation-journal`.

## Decision

Implement a Medusa-native PostgreSQL journal for Rifare cross-system commerce operations. The existing SQLite delegated-command journal remains a diagnostic/reference contract; it is not the production journal for the Medusa application. Do not copy its SQLite kernel or add a second database.

The journal is a Rifare-owned module in the existing Medusa PostgreSQL database. Medusa owns carts/orders/payments and their workflows; ElevenID owns identity/delegation evidence and policy decisions; Rifare owns merchant authorization, approval consumption, operation identity, cross-system idempotency and reconciliation.

## Assignment: COMMERCE-OPERATION-01

Root owns integration and tests on `feat/medusa-operation-journal`. Implement a narrow module with durable original-operation admission, status/read, immutable first observation, recovery preparation and revision-bound cancellation. No public commerce effect is enabled in this assignment.

### Identity and constraints

- Persist a server-generated operation ID and the caller's original command UUID, tenant/merchant namespace, Medusa store/customer/cart references, actor binding digest, exact canonical command bytes and SHA-256 digest.
- Enforce a database unique constraint on the complete server-side idempotency partition and original command UUID. Do not rely on a process mutex, Medusa's default in-memory locking provider, or a pre-insert read.
- A repeated identical original returns its retained record. The same original UUID with a different canonical command or ownership context conflicts and must never allocate another row.
- Retain a unique challenge fingerprint for FINALIZE across active, cancelled, retired and minimized records. This is local non-reuse, not provider-wide idempotency.
- Use explicit states: `admitted`, `awaiting_authority`, `approved`, `dispatching`, `unknown`, `observed`, `completed`, `denied`, `cancelled`, `retired`. State transitions are a closed transition table with optimistic revision checks. Never infer that timeout, connection failure or missing response means no remote effect.
- Persist before any external call. The initial implementation has no transport callback, automatic retry, queue dispatch or business effect. Recovery always refers to the same original operation ID and command digest.
- Store exact integer minor-unit payable amount plus currency and exponent, and the canonical Medusa cart facts digest. Do not round component decimals. Reject unrepresentable totals.
- Bind the admitted operation to a single native cart, registered customer, merchant namespace and store. Guest carts and unassociated customer identities cannot enter approval admission.

### Transaction and currentness boundary

Use Medusa's supported PostgreSQL transaction manager/module-service transaction scope and database unique constraints. Prove actual transaction semantics with two independent database connections and concurrent processes. A Medusa in-memory lock is not a durable concurrency boundary.

Admission must lock/re-read the authoritative native cart/association inside the same PostgreSQL transaction that inserts the original operation, or use an equivalent supported database transaction strategy with explicit row locking and deterministic lock order. Recompute/read the exact approval facts from persisted Medusa records within that transaction. Do not perform network calls while holding the database transaction.

This assignment may persist an `awaiting_authority` operation only after the native cart/customer/store binding and exact facts are verified. It must not claim ElevenID approval or current provider authority. A subsequent assignment will add the provider approval handshake and the final synchronous currentness/payment-equality guard immediately at the Medusa native effect boundary.

Do not use the read-only cart-observation endpoint's digest as an atomic revision. It is an observation commitment only.

### Privacy, security and lifecycle

- No access token, refresh token, bearer, credential, private key, proof bytes or raw compact JWS in the journal.
- Retain only bounded identity references/digests and business facts required for recovery. Define per-field retention and avoid copying address/email plaintext unless an existing business owner requires it.
- Implement export, hold, erasure, uninstall, restore/import and suppression hooks before allowing personal fields into persistence. Tombstones must preserve original-ID/challenge non-reuse while personal content is minimized; restored records cannot reactivate work.
- Enforce customer/merchant ownership on every read and mutation. IDs, email, metadata, cart IDs and request-supplied merchant values are not authorization.
- No public API route in this assignment. Internal service methods only, with concrete owner checks.
- No change to ElevenID/Marty repositories or provider accounts. No mapping of shared Supabase subject/email to ElevenID membership without a supported, verified account-link contract.

### Allowed implementation scope

Add the Medusa module/model/service, generated migration, configuration registration, strict schema/transition validators, typed privacy integration and focused native PostgreSQL tests. Add no new database or queue. Reuse Medusa's PostgreSQL and transaction support. Preserve the existing identity provider and cart observation contracts unchanged.

### Verification

Use a fresh explicitly disposable PostgreSQL database and actual Medusa process. Required evidence:
1. migrations apply from empty and rerun idempotently;
2. exact original retry returns one row; changed payload/merchant/customer/cart conflicts;
3. concurrent claims through independent processes/connections yield exactly one winner;
4. crash after commit before response leaves one recoverable original;
5. transaction rollback leaves no admitted row;
6. cart/customer/merchant mismatch cannot be admitted;
7. stale revision, terminal state, challenge reuse and malformed canonical bytes fail closed;
8. erasure/hold/restore cannot resurrect original work;
9. current cart amount and facts digest are exact and currency-safe;
10. all existing 22 cart-context, 28 identity and 17 commerce native groups still pass, plus focused regression files within repository limits;
11. isolated mutations removing the unique constraint and final cart ownership/currentness check cause actual behavioral failures, not setup failures.

Independent read-only authority/security and regression reviews must inspect the exact tested tree and evidence. Record source pins, migration bytes, actual commands, report hashes, independent connection/process identities, fault parents and remaining limits. No formal acceptance until original criteria and connected qualification are met.

## Explicit exclusions

No ElevenID approval request or proof submission, public managed-machine transport, signed request verification, FINALIZE, receipt verification, payment capture/refund, order creation, carrier/warehouse action, automatic retry, production deployment, live Supabase account change, production migration, paid CI dispatch, release or default-branch merge. Protected commerce routes remain held.

## Next boundary

After the journal is qualified, a separate assignment selects and verifies the supported ElevenID human/machine account-link and authority contract. Only then compose authority evidence with this durable original operation, add a final native currentness/payment-equality check at Medusa's effect boundary, and qualify one complete cross-service purchase lifecycle.
