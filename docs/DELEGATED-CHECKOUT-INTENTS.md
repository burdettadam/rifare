# Durable delegated checkout intents

RCG-4A preserves an original checkout intent and one receipt-verification
observation in native SQLite. It supplies local identity, duplicate refusal,
cancellation and retained-status reads. All results explicitly report
`execution_authorized: false` and `evidence_status: historical_observation`.
This is a local implementation candidate under
[ADR-0069](decisions/0069-durable-delegated-checkout-intents.md).

## Native API

Construct `DelegatedCheckoutIntents(kernel, receipts)` with the actual
`DelegatedCheckoutReceipts` instance bound to that kernel. The receipt owner still
requires the independently configured context and pinned JOSE verifier described
in [receipt verification](DELEGATED-RECEIPT-VERIFICATION.md). No production
provider context, transport or public application route is added.

| Method | Meaning |
| --- | --- |
| `prepare(scope, {preview_id, context_id})` | Obtain original facts from current native owners and save an immutable intent identity. |
| `read(scope, intent_id)` | Return retained local status under current customer/resource/proof checks. |
| `verifyReceipt(scope, {intent_id, compact_jws})` | Verify the actual signature against the original binding and atomically retain its evidence projection. |
| `cancel(scope, {intent_id, expected_revision})` | Terminal local cancellation; no provider cancellation is implied. |

Requests contain IDs and the compact receipt only. They cannot supply snapshots,
expected claims, verification flags, keys or persistence callbacks. Read access
does not depend on a live receipt configuration, but still requires current native
customer proof and ownership. A staff or agent scope cannot impersonate that
customer through the new API.

## Identity, retries and local claims

The intent ID derives from tenant/store, original preview ID and original context
ID. Its binding digest covers the original context digest/revision, preview
digest, challenge, grant, amount, subject/resource identity and deadlines. The
stored personal projection contains only the necessary IDs, challenge, grant,
currency/total and verified receipt; it excludes raw compact JWS, full contexts,
session/proof tokens and keys. The full preview digest binds all purchase facts
without persisting a second copy of the cart, quotes or source envelopes.

Repeating preparation with identical original facts returns the same record and
timestamps. Reusing those IDs with changed facts conflicts. A second intent cannot
claim the same challenge within its tenant/store and issuer/organization namespace.
A verified receipt ID is similarly reserved locally. A changed signature input
for an already recorded intent conflicts even if it would otherwise verify.

An exact recorded-token retry returns retained status and does not repeat
cryptography. It may therefore report expired, cancelled or revoked local state.
The original intent expiry is unchanged; the view also becomes expired at the
receipt's earlier deadline. An authorized read or capture entry durably records
that expiry once and increments the revision. This terminal observation survives
another owner, restart and clock rollback. The stored receipt boundary is the
first integer millisecond at or after its exact nanosecond timestamp, preserving
the existing verifier's semantics. These responses never assert that external
authority is still current. Cancellation and minimization retain the identity fingerprints,
so they cannot free a challenge or receipt for another intent.

The bounded owner validates at most 10,000 rows of this document kind per scan,
and each canonical row body is at most 16 KiB. It fails closed beyond that bound.
This deliberate local limit is not a high-volume production index or capacity
qualification. No migration, queue, worker claim or automatic retry is introduced.

## Atomic recording and restart

The receipt owner keeps private WeakMap provenance for its actual frozen binding
and verified output objects. Provenance binds the verifier instance, original
opaque scope, preview, exact context and original time. Serializing the object or
loading its stored projection cannot reconstruct that provenance.
`currentBinding` is only the capture step; internal callers must invoke the final
`assertBindingCurrent` guard before completing a mutation. Authentic output
objects can keep their original scope/context reachable through WeakMap values
until garbage collection. Closing invalidates use and does not promise immediate
memory reclamation or zeroization.

After cryptography completes, the intent owner opens the existing synchronous
kernel transaction. It validates the original binding, duplicate claims and
revision, writes the evidence, and then rechecks context/trust, native purchase
sources, customer proof, recovery controls and deadlines. Final inert SQL checks
detect cancellation and cross-record duplicate claims created during source
callbacks, and enforce the scoped row limit. Failures roll back the write;
there is no awaited callback or continuation inside the transaction.

After an ordinary process restart, a fresh kernel can read the retained identity
under current customer proof. The original preview owner remains process-local.
Saved rows cannot recreate it, establish a current external context, import keys
or resume verification. A new preview/context identifies a separate explicit
intent and must respect existing local challenge/receipt claims.

## Privacy and recovery

The existing `commerce_support_documents` table contains the new strict
`delegated_checkout_intent` kind. Dedicated lifecycle hooks select original
subject hashes and resource IDs, including historical subjects with no current
resources and records whose resource has been reassigned.

Subject export returns a bounded historical projection. Erasure, uninstall and
unheld cancellation remove personal content and revoke use, retaining only
minimal correlation/duplicate-refusal identity. Holds retain required personal
bytes while revoking use; ordinary intent reads hide those personal fields and
only the explicitly scoped privacy export may disclose held content. Already-erased and repeated-import paths scrub old
copies again; old held content cannot override a current independent suppression
checkpoint.

Backup restore and merchant import preflight typed records, revoke all restored
authority and minimize unheld personal content. Unsuppressed held personal
records cause atomic refusal. First import and repeated import both apply these
rules. The transfer digest proves transferred-byte integrity, not authorization
to revive saved evidence. Existing provider/caller copies and physical database
page deletion retain their separate, unqualified privacy boundaries.

## Local verification and continuation

Install the exact optional runtime using `python3 tools/install_receipt_runtime.py --offline`
when its pinned archive is cached. The intent tests generate their own synthetic
signatures and do not need proprietary protocol vector bytes.

```sh
python3 tools/dev_tests.py --files tests/development/delegated-checkout-intents.test.mts tests/development/delegated-intent-privacy.test.mts
python3 tools/dev_tests.py --files tests/development/delegated-receipt-native.test.mts
```

The [work record](../work/records/RCG-4A-native-intents.md) records actual results,
candidate and review limits. Original accepted criteria and prior tests remain
unchanged. This slice supplies no final-use or merchant execution capability.

The next provider-bound assignment must consume an actually published transport
and authenticated current-authority contract. It must preserve original operation,
challenge and idempotency identity before any send, keep ambiguous outcomes
unresolved, reconcile by the original identity and separate provider authority
consumption from the merchant effect. A timeout or unconfirmed lookup must never
silently mint a replacement identity or retry a purchase.
