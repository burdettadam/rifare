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

### Prior catalog preservation decision

Before modifying the shared client or catalog, the maintainer adopts an additive
continuation profile. Keep the existing public entry's three operations, 23 wire
cases, API profile, scopes, direct fixtures and qualification claims unchanged.
Renew only its source hash/version to the actual intentionally extended client.
Add one distinct diagnostic `delegated_use_public_continuation` entry for proof
submission, FINALIZE, final-result recovery and receipt recovery. It has no real
external account/scopes or production qualification, and no direct fixtures.
Bind its four operations to the actual new whole wire-test file, with a fixed
case set. Do not change the catalog-only 327680-byte limit or any generic limit.

Protected C6 scope remains 49 adapters, 230 operations, 359 unique native cases
and 47 direct fixtures. After validating the full current catalog, its existing
registration test may subtract only the independently validated new entry's exact
one/four/new-case contribution before its unchanged scoped assertions. Add full
new-scope assertions and exact subtraction guards. Preserve the original 23 wire
tests and negative oracles. Earlier public-subtraction helpers must first validate
and remove the exact continuation addition so their old C5 residual hash stays
`06033d81d78481d8225cf83752cdefec171e77cfeadc6d3d79f4e8e9ef9c75ed`.

Freeze the complete prior C6 metadata too. Protected expected-coverage canonical
digest is `a0dd3d8aae778fb027edda176f621d333a6c4d55251fc2064c3f9e28b1cd952d`.
Compare the catalog/coverage after exact continuation subtraction, restoring only
the independently checked public-source hash/version and coverage-file oracle pin
for that historical comparison. No other prior metadata or test hash may drift.
The old public source SHA-256 is
`e05461dc4bec360cdcb2ce58cd6965f1c63ee53092e186d174aa9825636bf0a1`.

Inspection of all 721 prior pin paths found one inherited portability mismatch:
the expected-coverage oracle pin `8c392d78746636a0043c35efbabf95cf884bb5cc9bf876ded4562b41df15b51b`
is its CRLF encoding; disk and protected Git both have LF bytes with SHA-256
`d6f5f15a8e60033ecfc585fe1760bd7019ff0523f21008dc784393460e3c6b53`.
Exact LF-to-CRLF conversion reproduces the prior pin. Correct that pin to the
committed LF bytes before extending coverage; do not introduce newline
normalization or change the JSON data. The prior catalog's canonical digest
after this sole correction is
`525fe0356ee0912d35ab1cd0c9404837e4054d524f602850ed6293990e37256a`.
Independent regression review must verify these prior/candidate comparisons and
the old scoped counts alongside actual new and retained wire executions.

The same exact-subtraction rule applies to the retained C1 and C5 registration
assertions, which currently express the same 49/230/359/47 protected C6 scope.
Before modifying those test files, extend this prior decision to their scoped
registration results: validate the entire new catalog and exact new entry first,
then subtract only one adapter, four operations and its fixed 24 new cases.
Keep their old counts, original codec/client cases, negative assertions and
historical content digests unchanged. The new full-scope assertion remains
50/234/383/47; no validator or qualification threshold is relaxed.

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
