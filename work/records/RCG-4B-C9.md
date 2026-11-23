# RCG-4B-C9 - Native proof association and original finalization

State: assigned; implementation pending.
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
