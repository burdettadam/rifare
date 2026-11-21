# Durable original delegated-command claims

RCG-4B-C2 adds a local journal for the complete original P03 START_USE or
FINALIZE_USE request and its first structurally bound response. It preserves
command identity when a local process or its caller loses a result. The
[C1 codec](DELEGATED-COMMAND-CONSUMER.md) remains the sole wire validator; the
existing [checkout intent](DELEGATED-CHECKOUT-INTENTS.md), receipt verifier and
business-operation owners are unchanged.

The implementation and verification checkpoint is recorded in
[RCG-4B-C2](../work/records/RCG-4B-C2.md), under
[ADR-0076](decisions/0076-durable-delegated-command-claims.md). This module has no
network transport, public HTTP route, provider credential or dispatch callback.

## Local API and identity

Construct `DelegatedCommandClaims(kernel, correlation)` with a fixed server-side
configuration. It contains a bounded native `provider_ref`, lower-case non-nil
UUID `organization_id`, and typed SERVICE_ACCOUNT or MACHINE_IDENTITY actor.
The actor identifier is a bounded opaque local string, preserved exactly.
Configuration is detached and frozen; a request cannot choose it.

The complete configuration digest partitions claims by tenant and store.
Within that partition, the original command UUID is occupied by one immutable
mutation. Subject, resource and command digest are deliberately outside the
identity key: changing them cannot create a second claim under the same UUID.
The full identity digest is checked even though its storage ID is abbreviated.
A FINALIZE challenge fingerprint additionally prevents another command UUID
from claiming that challenge in the same local partition.

| Method | Retained behavior |
| --- | --- |
| `claim(scope, originalMutation)` | Accept a complete START_USE or FINALIZE_USE mutation through C1 and commit its original UUID, digest and payload. Exact repetition returns retained status; changed intent conflicts. |
| `read(scope, originalCommandId)` | Read historical status under current native customer proof, without needing a live preview, receipt context or provider. |
| `observe(scope, originalCommandId, rawResponse, options?)` | Bind input to the retained complete original. Persist only the first response. Later matching results may vary `recovered` without changing the first response, time or revision. The optional `recovery` is checked by C1; callers cannot supply the previous result. |
| `recovery(scope, originalCommandId)` | Derive the exact RECOVER_RESULT request from the retained original. It creates no row or new UUID and makes no retry decision. Retired/minimized originals are unavailable. |
| `cancel(scope, {command_id, expected_revision})` | Retire the original claim using its current revision. Minimize unheld content and keep all refusal identities. Cancellation never releases a UUID or challenge. |

All access requires an actual customer Scope and current native proof for the
original resource and subject. Checks run before record disclosure and again
before the final SQL fence. Another customer's or order's occupied identity
produces a non-disclosing denial. Public mutations reject a pre-existing SQLite
transaction, so returning a claim cannot acknowledge only a nested savepoint.
Concurrent writers use the existing kernel transaction and SQLite locking.
Claim, observation and recovery preparation also recheck the existing recovery
and migration egress fence after the final native access check. Historical reads
and cancellation retain current-proof access.

The journal stores no attempt count, lease, retry deadline, transport eligibility
or `may_send` value. An unresolved original remains claimed indefinitely.
Different command UUIDs can still describe the same business intent; preventing
duplicate business effects belongs to the existing commerce operation owner.

## Observations and authority

Every public view marks itself as `historical_unverified_observation` from
`local_unverified_input`, with these flags:

```json
{
  "execution_authorized": false,
  "provider_authenticated": false,
  "receipt_signature_verified": false,
  "qualification": "candidate_contract_only"
}
```

`observed` means that supplied data passed the codec's shape and original-command
binding checks and was retained locally. It does not authenticate a provider or
prove execution. PERMIT, a receipt reference or a matching receipt digest cannot
promote it to a native verified receipt or an `evidence_verified` checkout intent.

Native ownership permits access to this journal; it does not prove that a P03
operation, grant or digest matches a current native checkout purchase. The later
commerce adapter must establish that purchase binding separately. Likewise the
constructor's organization and actor are correlation expectations. A future
transport must establish authenticated provider identity and verify agreement.
Changing configuration creates a different local partition and cannot be called
recovery of a previous partition. Local uniqueness is not provider-wide
idempotency across stores or configuration changes.

The protocol challenge UUID remains distinct from the independently signed proof
nonce. A FINALIZE `proof_submission_id` is only a reference; the journal never
stores proof submission bytes, a compact JWS, session bearer, private key or
credential. Retained JSON cannot recreate native WeakMap provenance or current
receipt-context authority.

## Storage and privacy

The strict `delegated_command_claim` document kind uses the existing support
document table and changes no SQL migration. Each canonical body is bounded to
16,384 bytes. Validation scans allow at most 10,000 records. Normal calls are tenant/store
scoped; global restore validation also fails closed at that bound.
Every read validates exact field shapes, row/body/digest coherence, complete
identity and available original request/response bindings. Revision-and-digest
updates and the final inert SQL fence guard against stale or reentrant changes.

One personal projection holds the original customer, complete correlation
configuration, canonical request string and first response. Terminal tombstones
retain the original UUID, identity/namespace/command/result digests, original
resource and subject, challenge fingerprint and historical timestamps. These
are still personal linkage and duplicate-refusal data, not anonymous records or
provider replay prevention. No general legal retention period is inferred.

Typed lifecycle hooks integrate the journal with existing privacy operations:

- Subject export and erasure follow the original subject even after resource
  reassignment or removal of all live resources.
- A hold can preserve required personal bytes, but erasure or cancellation
  immediately retires use and masks ordinary views. Scoped privacy export may
  include held history; releasing the hold permits minimization.
- Uninstall retires all claims and minimizes unheld originals and observations.
- Current subject/resource suppression removes replayed personal content before
  export, restore or import, including copies accompanied by an obsolete hold.
- Restore and first/repeated merchant import independently validate transferred
  source rows and the current destination. Unsuppressed held personal history
  rejects restoration atomically. Other imported claims become permanently
  retired and minimized, retaining their refusal identities.

The private typed retirement helpers compose inside their existing enclosing
privacy transaction. The public API's top-level-commit rule does not interrupt
atomic erasure or restore. Minimized payloads cannot be repopulated from caller
input, an exact repeated claim or an old transfer package. Already-returned
caller memory and physical database-page deletion remain outside logical
minimization.

## Focused verification

The following are separate normal invocations; each retains the default
60-case, four-file and 60-second limits:

```sh
python3 tools/install_receipt_runtime.py --offline
python3 tools/dev_tests.py --files tests/development/delegated-command-claims.test.mts tests/development/delegated-command-codec.test.mts tests/development/delegated-checkout-recovery.test.mts
python3 tools/dev_tests.py --files tests/development/delegated-command-privacy.test.mts tests/development/delegated-intent-privacy.test.mts tests/development/privacy-coverage.test.mts
python3 tools/dev_tests.py --files tests/development/delegated-command-process.test.mts tests/development/delegated-command-catalog.test.mts
```

The process selection uses disposable separate Node processes over a real
file-backed SQLite database. A test-only IPC commit barrier lets the parent kill
a process before the application result reaches its caller. Replacement processes
then read the original claim or repeat the same observation. Two other processes
wait behind an actual SQLite write transaction and converge after it releases.
This is local commit/response-loss evidence; no provider request is sent.

The catalog selection repairs the prior C1 codec's missing registration with
four existing operations and twenty existing test references. It freezes every
earlier expected-coverage row independently, retaining 46 earlier adapters,
221 operations and 308 native cases before the additive registration. It does
not execute the old nested catalog campaign. That legacy test's earlier
38/199/262 count assertions remain an explicit pre-existing broader-gate issue;
neither they nor its runner are rewritten by this slice.

## Next integration boundary

Continue with the public provider authentication, current-state, start/final-use
and original-result contracts when available. Establish the real typed actor
namespace and native purchase binding before composing a transport with this
journal. Preserve the original command after uncertainty and reuse the existing
execution, approval, reservation, budget and business-idempotency owners.
Public serving, full isolated RCG-5, connected RCG-6, target PostgreSQL/React,
formal acceptance and production qualification remain separate obligations.
