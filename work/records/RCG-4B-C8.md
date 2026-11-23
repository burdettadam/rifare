# RCG-4B-C8 — Native delegated receipt admission

State: signature/context foundation independently reviewed; native PostgreSQL
receipt admission implemented and exercised locally. Isolated compiled runtime,
populated upgrade, whole-database restore and native candidate reviews pending.
Base: `4d07b3aa797a794dd318e9dc95cffa04e5333692`.
Writer/integration owner: root; branch `feat/medusa-native-receipts`.
Checkout: canonical primary `rifare`; one primary, zero linked, clean at assignment.
Contract: [ADR-0086](../../docs/decisions/0086-native-delegated-receipt-admission.md).

PR6 is merged into development. The assigned local feature branches are ancestors of that
integration branch; the original implementation ref retains its distinct history.
No open Rifare PR or stash was found. Preserve branch refs.
The completed C7 linked checkout has already been removed with its evidence and
compatible source dependency cache preserved in the primary. Reuse that cache.
Host C free space was 52,764,901,376 bytes before this assignment.

The prior turn inspected current provider source and workspace audit/work records
without finding qualified endpoint/caller enrollment evidence. The ignored
`evidence/operation-journal/c7-provider-dependency-inspection.json` records its
scope. This establishes a pending connected gate, not provider deployment failure.
Current provider pin is `7254680c9491f6e79d8ca981ad71f44e9398142c`.

Independent regression scoping found the legacy-preview/native-original digest
mismatch and recommended the native receipt-context owner before an effect-fence
experiment. No existing binder or assertion may be weakened to bridge it.
Independent authority scoping of the holder/custody boundary is recorded below.

Next: implement and exercise the real signature/native-context foundation, then
compose the immutable native journal observation and privacy/upgrade/recovery
qualification. Final review must bind both independent roles to actual candidate
source and evidence. No product acceptance or connected qualification is claimed.

Primary checkout remains active with root as owner until the full assigned slice
is integrated or safely parked. No verification checkout or extra build cache is
assigned. Provider and Supabase workers retain their deployment scopes.

## Foundation observations

The new native receipt verifier reuses the unchanged pinned receipt JOSE adapter,
strict JSON and exact nanosecond timestamp parser. Its detached server trust and
original context bind native operation digest, authenticated nonce, full machine,
grant, represented subject, KEY thumbprint, policy, status and local ceiling.
Opaque private results explicitly confer neither live status nor execution
authority. The old preview binder is unchanged. The compiled shared closure now
contains 21 modules; source receipt JOSE loading stays lazy so older source
sessions do not acquire an eager optional root dependency.

The normal backend build and direct invocation of its compiled synthetic scripts
passed 37 new receipt cases and 34 retained request-signature cases. Both ES256
and Ed25519 signatures are real; the receipt's nonce differs from its Flow UUID.
The scripts run without bootstrapping Medusa native services and therefore do not
qualify native persistence or a standalone installation. Build used an owned
tmpfs PostgreSQL fixture, subsequently stopped/removed; no provider process ran.
Raw logs and exact qualification commands are under ignored
`evidence/operation-journal/c8-*`. Source cache and generated build remain owned
by root for the ongoing C8 qualification; retire generated output when it ends.

A targeted fault in only the generated shared JOSE module replaced compactVerify
with raw payload decoding. The unchanged valid control passed, then the unchanged
wrong-private-key assertion failed with `Missing expected rejection` at compiled
test line75. The generated module was restored byte-for-byte in finally. No
product source or old assertion was weakened. This is a signature fault, not a
native persistence/authority fault.

The optional root runtime installer initially failed to launch bare npm on
Windows. Resolving its executable through PATH installed the exact cached JOSE
6.2.18 offline (80 files, tree hash
`8247cbabe4fe086e6330038cc15353b9f5cd001dd7650916657e68de4e6cf863`).
An initial Windows unit invocation encountered the old literal `npm` test
expectation and unavailable symlink privilege. After the separately recorded
platform expectation adjustment, all 13 installer tests passed in a no-network
read-only-source Linux container, including every symlink/special-file assertion.
No skipped cases or elevated permissions were used.

The first build used a placeholder database and was deliberately stopped after
its actual owned CLI PID/parent/command were verified. Its final log shows types
had generated and backend compilation had started; the exact reason it had not
finished at the observation point was not established. A premature compiled-test
attempt failed because that build had not emitted the file. A subsequent real-DB
build passed; the first runner then stopped on Node's stderr experimental-SQLite
warning under PowerShell ErrorActionPreference=Stop. The corrected runner retains
stderr, checks actual exit codes, and passed both scripts. Those earlier logs
are preserved; none counts as the deliberate signature fault.

Intake initially failed on inherited C7 CRLF manifest pins. ADR-0086 records the
prior owner decision and exact LF/CRLF comparison. Corrected exact Git-blob pins
pass intake; the manifests, graph, package integrity and script inventory remain
unchanged. Four retained commerce-intake attack tests, license/source inventory,
repository/generated/plan checks and whitespace checks pass. Independent review
of the exact foundation candidate and later native composition remains required.

Authority scoping confirmed that `/v1/devices/holder-signatures` is a paired
human/device interface. Managed-machine lifecycle tests hold their own ephemeral
VP key; the remote request/issuer/receipt keys are distinct. A supported managed
machine credential/presentation custody interface must be selected by the
provider owner. Do not substitute device bearer custody or test/private service
keys. Public proof submission and FINALIZE transport contracts are available for
later consumer composition; native receipt development can proceed locally.

All 58 retained legacy receipt binding/JOSE/hardening cases passed unchanged in
three whole files under pinned Node24.14.1 in a read-only-source, no-network
container with the normal network-deny hook (zero skips/cancellations). The first
host attempt passed 17 then hit an existing test-helper Windows absolute-import
URL error. The container development wrapper next hit its ten-second Git diff
observation deadline, so the three already selected whole files were invoked
directly with the same native Node test options and network-deny hook. Neither
failure was counted as a pass. The missing ignored provider vector was separately
restored from the exact authorized local Protocol Git object and matched its
existing SHA-256; it was not regenerated or added to source. Logs retain each
attempt. The Linux direct native invocation took 2.006 seconds.

## Native implementation checkpoint

Both independent roles cleared foundation `d5459e09c7d11378625e2a02accd5182ba6de374`
against protected `4d07b3aa`. Each independently recomputed all 61 source inputs
and 71 then-current compiled hashes; authority also reran all 37 compiled cases.
They explicitly limited clearance to the foundation. The checkpoint is published
on the assigned feature branch. Their actual dispositions and fixed-input receipt
are preserved under ignored `c8-foundation-independent-reviews.json` and
`c8-foundation-input-receipt.json`. The native changes below require renewed review.

The native context owner now requires the complete C7 tuple, retained exact
original/START/CHALLENGE hashes and correspondence, request bytes/digest, nonce,
state and expiry consistency. Receipt verification derives its operation, grant,
currency and exact amount from that trusted original, without a legacy preview or
a caller's verification flag. It uses the retained C7 observation as historical
authenticated context, while independently checking current receipt trust and
native ownership/privacy/cart state. Provider lifetime inspection led to an
additional independent Flow challenge interval bound and one new signature test
(38 cases now). No request lifetime or old binder assertion was relaxed.

The existing service admits one immutable receipt tuple under serializable native
currentness and revision checks, with database time before/after crypto and after
COMMIT/current cart reads. It rechecks verifier retirement/cancellation around
awaited writes and return. Recovery verifies the same original bytes/context and
preserves the first observation; a persisted time floor survives a fresh verifier.
Receipt evidence leaves the operation awaiting authority, with no commerce effect.

Native DML generated `Migration20261123110127`: six personal receipt fields plus
one unique receipt identity fingerprint. The fingerprint is independent of key
rotation and survives minimization. Privacy export, hold, erasure, uninstall and
refusal reconciliation include the new fields. Pre-C8 three-field refusal records
remain supported when they discard no C8 fingerprint; current four-field refusals
can preserve a later fingerprint across an older backup. The exact compatibility
decision is recorded before implementation in ADR-0086.

The normal source backend build and all 38 signature cases pass. All 13 actual
PostgreSQL receipt groups pass: first result/retry/context immutability; concurrent
valid winners; missing C7/cross-original/current owner refusal; changed cart;
receipt identity reuse after cancellation/minimization and refusal restoration;
deferred COMMIT rollback; separate-process acknowledgement loss/recovery; trust
retirement during an observed blocked UPDATE; late-COMMIT expiry; owner withdrawal
at COMMIT; fresh-verifier persisted clock floor; historical request context after
JWT expiry within a still-current challenge; and privacy hold/export/erase/release.
Raw observations are `c8-native-*`; the qualification runner is preserved there.

The first retained C7 rerun encountered `us` already assigned to the new suite's
region. Its setup failure is preserved separately as
`c8-native-first-C7-fixture-collision.log`. A fresh separate regression database
then passed all 11 unchanged C7 native groups, old schema and privacy scripts.
No old fixture/assertion or accepted count was changed. Both owned PostgreSQL
containers were stopped/removed. No provider or Supabase resources were used.

The new populated-upgrade witness is source only at this checkpoint; it has not
yet run. Next: qualify the fixed compiled consumer with its own production-only
dependencies, populate a real pre-C8 schema and verify migration/replay preservation,
run whole-database restore with current erasure/uninstall reconciliation, and obtain
both native candidate reviews. Keep the primary active with root as writer; no new
checkout was created. Source dependency cache is reused. Retire generated outputs
and any later owned runtime after their qualification/review preservation gates.
