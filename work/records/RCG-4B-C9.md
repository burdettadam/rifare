# RCG-4B-C9 - Native proof association and original finalization

State: pure association foundation implemented and exercised; native transport,
persistence and full C9 qualification pending.
Base: `acab80a787b5e625e16527f22463a86deaa718e0` (merged C8 PR7).
Writer/integration owner: root, canonical primary `rifare` checkout.
Branch: `feat/medusa-proof-finalization`.
Contract: [ADR-0087](../../docs/decisions/0087-native-proof-and-finalization.md).

The previous turn merged C8 after fixed-candidate qualification and both reviews,
then retired its owned runtime and generated backend output. Source dependency
cache, branch refs and evidence remain preserved. This turn verified clean
development and one primary/zero linked Rifare worktrees. Assigned earlier local
feature branches are integrated; original implementation history remains preserved.
No open Rifare PR or stash was found. Root reuses this primary; no checkout or
separate compiler cache is created. Host free space observed 73,130,946,560 bytes.

Provider protected main now points to `e868aa97464aeaebb9c99137f1808b5b10caff74`.
Read-only local object comparisons found no change in selected public client,
wallet association or use-command paths since `7254680c`. The dirty provider
checkout was not changed. No actual endpoint, enrolled caller, credentials or
provider/Supabase deployment is consumed here.

Independent authority scoping confirmed the selected two-field form and compact
proof digest, closed five-field acknowledgement, historical duplicate recovery,
distinct durable FINALIZE identity and outer/inner receipt correlation. Preserve
historical recovery separately from first-dispatch currentness and retain DENY.
The provider worker must select managed-machine credential/presentation custody;
Rifare does not substitute human/device signing or invent an unreviewed signer.

Next: implement and exercise the pure association codec, then compose real mTLS
and durable native continuation under the same assigned contract. Foundation
evidence must not be represented as native, connected or full-slice qualification.
Both independent roles review the actual fixed candidate before integration.

## Pure association foundation

The source codec and its test script now pass 21 groups via the existing pinned
Node24.14.1/ts-node10.9.2 source toolchain. Exact command from the backend directory:
`node -r ts-node/register/transpile-only -e` invoking the exported test function
with NODE_ENV=test and RIFARE_COMMERCE_VERIFY=disposable. No Medusa bootstrap,
database, transport, credential or provider process was started. The test VP is
deliberately JWS-shaped synthetic syntax, with no signature-verification claim.

The prepared object privately captures bounded exact form bytes and compact-proof
digest, avoiding enumerable raw artifacts. Context is detached before awaited
module loading. Closed duplicate-safe acknowledgements bind original challenge,
proof digest and receive time to nanosecond bounds. Recovered transport observations
retain the same immutable semantic digest/time. The checks independently cover
form vs compact identity, prototype-like query names, all response mismatches,
time/calendar/offset boundaries, duplicates, size/syntax, mutation, bounded malformed-buffer diagnostics and retirement.

A deliberate source fault removed only the proof-digest equality check. Valid
form/recovery and wrong-challenge controls passed, then the unchanged wrong-digest
acknowledgement assertion failed with Missing expected exception. Source bytes
were restored in finally and the complete final suite passes. Logs are retained
under ignored `evidence/operation-journal/c9-proof-*`. This is behavioral codec
evidence, not native persistence, public-route or connected qualification.

Existing C1/C5/C6/C7/C8 implementations, tests, catalog claims and dependencies
are unchanged by this foundation. New files use the assigned first-party source
component. No full backend build/cache or additional checkout is allocated.
Next: independent foundation review, then the real continuation transport and
PostgreSQL owner/FINALIZE/receipt composition. The managed custody/endpoint gate
remains with its provider owner; absent exact recovery bytes must remain pending.
