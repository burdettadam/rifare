# Durable operations and recovery

M02-G13 through M02-G17 add local diagnostic event processing, durable work,
stable operations, reconciliation and minimized receipts. This is not a live
payment, notification, warehouse or store-mutation integration. The existing
PostgreSQL/React and hosted-environment qualification gaps remain open.

## Components and boundaries

| Goal | Implementation | Behavior |
| --- | --- | --- |
| M02-G13 | `packages/commerce/event-processing.mts` | Processes only authenticated, tenant-bound synthetic `cases/updated` inbox events. Delivery identity, logical event identity and resource version are different checks. Duplicate deliveries replay one committed result; older/conflicting events cannot reopen a closed projection. |
| M02-G14 | `packages/commerce/durable-work.mts` | Saves outgoing work with the state change. Uses expiring fenced claims, at most three attempts, bounded backoff, terminal failures and explicit unknown outcomes. |
| M02-G15 | `packages/commerce/operation-store.mts` | Pins one logical operation and command digest to an approved case receipt or verified projection transition. Alternative request keys refer to that same operation, never a new authorization. |
| M02-G16 | `packages/commerce/reconciliation.mts` | Reads a separately stored synthetic source journal, records discrepancies, repairs supported observed results and commits each page with its checkpoint. It never sends an effect command. |
| M02-G17 | `packages/commerce/operation-receipts.mts` | Appends minimized transition records and linked corrections. Private notes have separate access/retention and can be logically erased without rewriting original outcomes. |

Migration `011_operation_reliability.sql` is additive. Do not edit an applied
migration or delete operational history to roll back. Historical action receipts
created before this migration are not automatically queued for external effects;
lookup reports `OPERATION_NOT_REGISTERED` rather than inventing a past delivery.

The existing `ActionGateway.execute` now commits its approved synthetic case-plan
change, original action receipt, operation, work item and initial minimized receipt
in one transaction. A failure inserting any of them also restores the approval's
unused state. The original gateway and approval interface are preserved. Agents
cannot supply a replacement operation body, changed amount or provider result.

## Demonstration and checks

```sh
npm ci --offline --ignore-scripts
python3 tools/verify.py --runtime --harness
node --experimental-strip-types tools/demo-reliability.mts
```

The demo provisions two separate in-memory SQLite connections (application and
synthetic provider), delivers duplicate and out-of-order signed events, loses a
response after provider commit, reconciles without resending, follows a correction
link, retries a confirmed-unsent request and erases an expired synthetic note.
No credentials, model, provider account, network service or paid effect is used.
The full suite additionally requires the existing host Playwright/Chromium tooling.

Tests under `tests/development/` use native Node test. Process-crash fixtures under
`tests/fixtures/reliability/` read test session details through stdin, never command
arguments. Independent processes reopen committed files to verify recovery. Raw
reports and fault demonstrations belong in the separate evidence archive.

## Work states and retry rules

The work path is `pending -> leased -> sending -> done`. Only a source adapter's
explicit **known not sent** result permits `retry_wait`; the two available retry
delays are 1 and 2 seconds, within a three-attempt maximum. Rejection is terminal. Retry exhaustion
is `dead` and the operation is `failed`. Claims that repeatedly expire before
sending also exhaust the same budget. There is no unbounded retry loop.

A thrown error, malformed/mismatched response, timeout after sending, or expired
sending lease means `unknown`. An expired claim that never began sending is safe
to recover. An old worker cannot finish or send with its expired/superseded token.
An unknown operation is **not** eligible for another dispatch. Its source must be
read and matched; absence or an unavailable lookup remains unconfirmed. No force
retry or speculative financial reexecution is provided.

Work for one resource is ordered by its original committed receipt sequence.
Unfinished earlier work, including unknown outcomes, blocks later work for that
resource; active later leases also block a conflicting claimant. Status reports
include `blocked_by`. Different resources can progress independently. This ordering
protects the outgoing synthetic journal, not an unimplemented financial system.

The adapter is `SyntheticJournal`, backed by a separate SQLite connection/file.
It explicitly records synthetic effects only. Its stable provider identity is
persisted and pinned before sending; another database with the same display name
cannot substitute during retries or reconciliation. The journal's idempotency
contract yields one synthetic record per operation/hash; this is not a universal
exactly-once-delivery promise for real third-party systems.

## Event processing

Accepted event bodies have exactly `schema_version`, `event_id`, `resource_id`,
`source_version`, `source_updated_at` and `state`. States are `open`, `approved`,
`closed`. This projection is separate from actual return/financial state machines.
Only the synthetic `cases/updated` contract is enabled. Unknown shapes, changed
raw bytes, future timestamps, disabled routes, quarantined deliveries and
unverified routing cannot drive a transition. Existing Shopify-shaped deliveries
remain quarantined; this goal does not qualify their tenancy or live processing.

Successful projection changes, outgoing work and per-delivery disposition commit
together. Different delivery IDs may represent one logical event; conflicting
bodies under one logical ID are recorded as conflicts, not silently accepted.
Distinct valid source versions remain processable. Arrival order is not authority.

## Read-only operational inspection

The existing loopback server exposes authenticated inspection:

- `GET /v1/resources/{resource_id}/operations`
- `GET /v1/operations/{operation_id}`
- `GET /v1/operations/{operation_id}/receipts`
- `POST /v1/operations/by-receipt`, with `receipt_id`, `idempotency_key`, and
  `expected_receipt_digest`, binds an alias to an existing gateway-created operation.

The alias endpoint cannot create an effect. Lease tokens, commands, note contents
and credentials are absent from status responses. Receipt reads additionally
require audit and resource permissions. No public endpoint accepts dispatch,
completion, provider URLs, reconciliation pages, arbitrary receipts or raw SQL.
Trusted local integration code may call the documented classes; it is not an
untrusted agent boundary. Existing ordinary local startup enables no live source.

## Reconciliation

A run records provider identity and a fixed upper sequence. Each page is limited
to 100 records; ordered sequence IDs, source binding and checkpoint concurrency are
validated. Page repair, drift records, receipts and cursor movement are one
transaction. A page failure leaves the previous cursor and operation states intact.
New source records above the captured upper bound are picked up by a subsequent
run. A new run scans the bounded source history again; scalable provider-specific
incremental feeds and retention policies are not yet implemented.

An observed matching result repairs only a `sending`/`unknown` operation. A
mismatch, unmapped operation, unexpected effect for an unsent/failed operation,
or changed source identity is visible drift. Already confirmed states are not
silently overwritten. Source unavailability does not imply failure, settlement,
refund, or permission to send again. The implemented effect stage is only
`synthetic_recorded`.

## Receipt and data boundaries

Receipts retain opaque actor/action/resource references, command digests, original
configuration/policy/approval references, source references, observed state and
correction linkage. Database triggers reject updates/deletions; a hash chain checks
content integrity. Corrections reference a later source-confirmed receipt for the
same operation and preserve their reason code. They do not rewrite execution state.

Customer notes are separately stored, bounded, permission-checked, expire and are
logically deleted only by an authorized retention action. The audit chain retains
only an opaque payload reference after erasure, not the text, subject mapping or
content hash. Obvious credential forms are rejected, but pattern matching cannot
detect every secret. Do not place credentials in notes. Logical erasure is not a
claim about SQLite free pages, backups, snapshots or forensic media erasure; those
need their own storage/retention controls.

The process/database administrator can modify code or drop triggers. The local
hash chain is not external tamper-proof/WORM storage or signed independent
attestation. No hostile-process sandbox, independent production review, target
PostgreSQL isolation or real-source semantics have been established here.

## Source references

The implementation uses explicit SQLite transaction boundaries and trigger aborts.
Authoritative references consulted on 2026-10-16:

- SQLite transactions: https://www.sqlite.org/lang_transaction.html
- SQLite trigger semantics: https://www.sqlite.org/lang_createtrigger.html

These sources describe database semantics; the executable tests establish the
observed behavior of this diagnostic implementation, not a platform certification.
