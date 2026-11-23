# Native delegated continuation

[ADR-0087](decisions/0087-native-proof-and-finalization.md) assigns the internal
proof/FINALIZE continuation. [The C9 work record](../work/records/RCG-4B-C9.md)
records exact qualification and review status. Connected managed-machine custody,
enrolled endpoint/caller and commerce execution remain separate gates.

## Internal server composition

`openContinuationSession(originalBytes, descriptorBytes, verifiedContext, transport,
requestVerifier, receiptVerifier)` composes the concrete native journal, explicit
mTLS transport and concrete C7/C8 verifiers. Trust/configuration belongs to the
server. Customer request flags cannot stand in for verification or select an origin.
No public route, wallet, signer or credential-custody service is introduced.

The existing `start`/`recover`/request-verification methods retain C6/C7 semantics.
`prepareProof(exactCompactVPBytes)` captures input before awaiting and returns a
session-private handle. It requires a current concrete C7 verification and persists
the selected original/challenge/query/request context and compact-proof digest.
It does not persist the VP or nested MachineCredential. `submitProof(handle,
originalBoundChallenge)` consumes its transient ticket once. After authenticated
TLS, native currentness/ownership/privacy/cart and verifier/time checks commit the
first-dispatch claim before the client may emit the captured form.

`recoverProof(exactOriginalCompactVPBytes, originalBoundChallenge)` is explicit.
It requires matching independently custodied bytes, original context, a previously
committed dispatch claim, current native ownership/privacy/cart and current provider
transport access. It does not mint a currently valid C7 verification for historical
context. A prepared-only original with a lost transient ticket remains pending.
Missing original bytes, an unclaimed intent or an absent provider result cannot
mint a new proof identity, signer, command or automatic retry.

The first closed acknowledgement retains original submission ID, challenge, compact
proof digest and provider receive time atomically. Per-transport `recovered` does
not enter that semantic identity. Changed historical identity/time is refused.

`prepareFinalization()` returns another private handle after retaining a distinct
server-generated FINALIZE UUID and exact C1 canonical bytes/digest. `finalize(handle)`
uses its one-use native post-TLS claim. `recoverFinalization()` and `recoverReceipt()`
use the exact original FINALIZE/recovery intent. Every continuation operation checks
that the immutable configured transport origin matches the retained C7 submission
origin, including after TLS. No redirect or response-selected origin is followed.

## Inert results and signed receipts

FINAL_USE binds original FINALIZE UUID/digest, challenge, PERMIT/DENY, selected
receipt reference/digest, original ordered times and EVIDENCE_ONLY. First outcome
and receive history remain immutable; DENY cannot create another finalization.
Native commerce state remains awaiting authority: protocol evidence never approves
or dispatches payment, inventory or order workflows.

Receipt recovery binds outer/inner result and exact compact bytes. C8 admission
then verifies the genuine signature and selected trust, original nonce, principals,
grant, KEY, operation, policy and status evidence. Before persistence, it also
matches final receipt ID/digest/decision and expiry; signed issue time must be no
later than provider recorded time, which cannot exceed native observation time.
Provider recorded time follows proof receive time; expiry remains within the Flow.
Signed historical ACTIVE status is not a live revocation lookup or execution permit.

## Persistence and privacy

Generated migration `20261123121939` adds sixteen nullable continuation columns.
`20261123124010` additionally requires a committed proof claim for a submission
observation. Fifteen personal fields participate in export, hold and minimization.
The unique FINALIZE UUID survives erasure as a refusal identity alongside original,
challenge and receipt identities. Current five-field refusal records preserve it;
legacy records cannot discard a retained UUID. Reconcile current erasure/uninstall
state after restoring a database and before admitting work.

Currentness is a native transaction-point observation, not a global physical-send
or business-effect fence. Compiled local PostgreSQL/mTLS tests are diagnostic
qualification; they cannot close connected provider custody, live grant status,
final-effect fencing, payment equality, original-outcome reconciliation or release
acceptance. See the work record for the exact tested candidate and remaining gates.
