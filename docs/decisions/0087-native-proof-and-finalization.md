# ADR-0087 - Native proof association and original finalization

Status: assigned; implementation and qualification pending.
Base: `acab80a787b5e625e16527f22463a86deaa718e0`.
Branch: `feat/medusa-proof-finalization`; root owns implementation and integration.
Reuse the active primary checkout and source dependency cache. Retain independent
authority/security and regression review; no provider deployment is assigned.

## Assignment RCG-4B-C9

Connect the existing C6 public transport, C7 authenticated request and C8 native
receipt owner through proof association and a separately retained FINALIZE intent.
Use the existing PostgreSQL journal and privacy/currentness owners. Do not add a
wallet, signer, credential store, authentication engine or business-effect engine.

Provider pin is Marty UI `e868aa97464aeaebb9c99137f1808b5b10caff74`. The selected
client, Flow wallet and command paths are unchanged from C8's `7254680c` source.
Machine presentation custody remains a provider-owned gap; paired-device signing
is not a substitute. Real connected qualification still needs that owner and the
enrolled caller/endpoint. Local genuine synthetic fixtures cannot close it.

## First foundation: exact association codec

Implement a pure, bounded native form/acknowledgement codec. It captures the exact
server-selected original/challenge/query/request context and compact VP bytes.
Public direct_post contains exactly `state` and `vp_token`; the latter maps the
frozen query ID to a one-element array of the original compact VP string. The
proof identity is SHA-256 of compact VP bytes, never the form or decoded payload.
Match the provider's 262,144-byte proof and 786,432-byte form bounds. Do not print
or make raw proof/form content enumerable in diagnostics. Codec success establishes
neither signature verification nor permission; no network or persistence occurs.

Decode the closed acknowledgement with duplicate-safe JSON: submission UUID,
challenge UUID, exact proof digest, original receive time and boolean recovered.
Require nonnil canonical UUIDs and receive time inside the original half-open
challenge interval, preserving nanosecond/calendar rules. Separate the immutable
semantic result from per-transport `recovered`; recovery must not refresh identity
or time. Capture inputs before awaits, use private prepared objects, support close
and bounded diagnostics. Test genuine byte/digest/form correspondence, independent
mismatches, malformed/duplicate input, bounds, aliasing and historical responses.

## Native transport and durable continuation

Reuse C6's actual explicit mTLS exchange for continuation; do not duplicate its
TLS engine or relax old origin/trust/cancellation/deadline/currentness controls.
Add explicit form content type, proof/form/receipt bounds and protected response
headers. Preserve all accepted old C5/C6 tests, scope claims and inventories. Any
required catalog extension must receive its own prior preservation decision.

First proof dispatch requires C7's actual current opaque verification and native
original/cart/ownership/privacy checks. Persist the selected context and exact
compact-proof digest before I/O. Never persist the VP or nested credential. After
uncertainty, recovery requires explicit byte-identical independently custodied
proof matching the retained digest, current native ownership/privacy and provider
access. Provider duplicate recovery precedes its new-submission active-Flow check,
so historical recovery must not depend on inventing a current C7 request. Missing
custody bytes leave the original pending; never automatically retry or re-sign.

Retain the first original proof-submission identity/digest/time atomically before
FINALIZE. Prepare a distinct server-selected FINALIZE command UUID, exact C1
canonical bytes and digest durably before sending it. A timeout, absent result or
pending claim cannot mint another command. Use a one-attempt dispatch fence and
explicit original-result/receipt recovery. Currentness checks happen after TLS
and after awaited observations, preserving the C6 transaction-point limits.

Correlate FINAL_USE against the original FINALIZE UUID/digest/challenge, decision,
receipt reference/digest, ordered original times and EVIDENCE_ONLY. Preserve DENY
as an observed terminal decision; C8's PERMIT-only admission cannot turn denial
into permission to retry. Receipt recovery also binds matching outer/inner result
and exact compact-byte digest. Compare receipt identity/decision/times with signed
claims before C8 admission. Public/customers cannot supply successful verification
flags or choose this trusted context.

## Qualification and boundary

Use actual PostgreSQL for immutable first association, concurrent writers, original
restart/acknowledgement-loss recovery, rollback, trust/ownership withdrawal, expiry,
privacy and restore suppression. Generate native additive migrations. Extend field
export/hold/minimization/refusal continuity before persistence. Preserve raw failures,
fixed source/build/dependency receipts, deliberate behavioral fault and both reviews.
Qualify the compiled consumer with its own dependencies before local integration.

New first-party source/records retain the existing Rifare component classification
and license obligations; append their exact inventory paths only. No dependency
versions or locks change for the foundation. Keep hosted Actions skipped under the
owner's cost restriction and use the authorized remote/normal merge path when ready.
Proof association, FINAL_USE and C8 evidence still confer no merchant execution
authority. COMMERCE-AUTHORITY-01, live grant status, final effect fencing, payment
equality, original-outcome reconciliation and the wider goal remain open.
