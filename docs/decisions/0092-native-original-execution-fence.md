# ADR-0092 - Own and fence original native checkout execution

Status: assigned; implementation and mechanism proof pending. No connected or
production authority is established.
Base: `c0359132500d1dd6c527819e1142e929283b2593` (Rifare PR12).
Branch: `feat/medusa-native-execution-fence`; root is sole writer/integration owner
in the existing primary checkout. Assignment: RCG-4B-C12.

## Required outcome

Advance COMMERCE-AUTHORITY-01's original execution and actual-effect boundary.
C10 owns exact pending native payment association; C11 owns historical original
observations. Neither owns a native checkout attempt or fences a stale native
writer. Existing probes prove that a worker can complete checkout after losing its
Redis lease, and can still send HTTP after losing its PostgreSQL session. Preserve
those witnesses and the original parent requirements; do not relabel another
validate-hook wrapper as a final fence.

Implement one durable original native checkout-attempt owner in the existing
journal, with immutable original identity, opaque owner and monotonically increasing
fence generation. Consume the first entry opportunity before invoking upstream
completion. Interruption, workflow error, lost acknowledgement and owner loss retain
uncertainty and original identifiers. Expiry, process restart or an empty C11
observation must never allocate another checkout attempt. Cancellation cannot erase
an unresolved attempted effect. Extend privacy/hold/export/erasure/uninstall and
whole-database restore/refusal continuity without restoring execution permission.

Before workflow entry, require current native customer/auth/store/channel/privacy
ownership, exact original cart facts, original session/currency/raw principal,
retained C9 final result and genuine current C8 receipt verification. Reject stale,
expired, changed or unverified input before entering a workflow that has already
registered payment compensation. Reuse those owners; create no pricing engine,
alternate payment ledger, authority database or general worker scheduler.

Connected merchant permission and live ElevenID grant/revocation/account-link
sources are not installed by this task. The normal application must remain held
without them. An explicitly test/disposable local System qualification profile may
exercise actual mechanics using genuine independently signed synthetic C7/C8/C9
fixtures. Such fixtures are not a production authority source. Accept no caller
boolean, unsigned object or public environment-based request bypass as authority.

## Mechanism proof before claiming a fence

Prove a concrete, server-owned identity on the actual native module transactions.
A dedicated nonprivileged PostgreSQL login and its own worker connection pool are
a candidate: session_user can distinguish worker processes without a mutable pooled
session variable. Prove pool isolation, wrong/missing identity refusal, reconnect,
backend identity and role-forgery refusal through actual native writes. Do not assume
AsyncLocalStorage, workflow input or a context field automatically reaches SQL.
No production role provisioning or shared deployment architecture is assigned.

Where public workflow hooks cannot cover writes, narrowly owned PostgreSQL guards
must enforce the current original owner/generation at native order/cart/link,
reservation and payment write boundaries, with transaction ordering against
revocation. Missing or stale execution identity must fail closed for the protected
original. Preserve unrelated ordinary native behavior and explicitly distinguish
trusted administrative/database-owner powers from the bounded worker threat.
Prove original correlation before the first write; an error followed by compensation
or soft deletion is not zero stale effects.

Use supported upstream completion and module extension contracts. The pinned public
completion hook exposes validate only; later internal hooks are not a supported
extension claim. The public ModuleExports discoveryPath contract may allow a thin
native Payment service extension to preserve upstream resources/migrations while
guarding native provider edges. Prove it against the actual pinned implementation
before relying on it. Do not edit vendor files, replace the System provider under
an undisclosed identity, or copy completion/payment mechanics.

Database enforcement does not prove that an old process cannot issue an external
payment request. Native System calls and compensation need an explicit enforceable
edge in the local profile; external provider-side dispatch/fencing and original
outcome reconciliation remain distinct unqualified boundaries. No transaction may
span an external HTTP call. Keep the HTTP-after-session-loss witness intact.

## Required behavioral evidence

Reverse the retained failure: pause A after successful native validation; revoke its
owner/generation; establish a distinct successor/recovery owner; resume A. Assert
zero stale native order/cart/link/reservation/payment writes and zero System
authorization/capture/refund/cancel/compensation calls. A healthy scoped owner must
complete exactly one actual native order with original money through the same
owner/enforcement path. Wrong originals and direct native completion/payment calls
must not bypass it. Prove coverage of early native writes, not only final row state.

Exercise actual separate processes/connections, concurrent first entry, owner/lease
loss, backend loss and reconnect, deferred-COMMIT rollback, current ownership/privacy
withdrawal, genuine receipt expiry, captured-payment compensation-safe entry, lost
acknowledgement after claim and after native effect, and recovery of the original
without a resend. Preserve unknown/partial effects explicitly. Test privacy and
restore across each committed stage and prevent refusal-fingerprint reuse.

Fault the actual generation/owner enforcement so the unchanged stale-worker oracle
detects it, then restore exact source/DDL. Fixed own-dependency compiled qualification,
populated prior component/schema upgrade/replay, whole-database restore, exact
input/output/vendor/tool/evidence receipts and both independent review roles remain
required. Preserve all C7-C11 and relevant native commerce/claim controls. Do not
change criteria, oracles, catalogs or scope merely to obtain a passing result.

If supported identity propagation, original correlation, provider-edge enforcement
or complete native write coverage cannot be proved, name the concrete blocker and
leave this assignment incomplete. A mechanism experiment is progress, not acceptance
of this contract or the parent authority/purchase goals.

## Existing work and environment

PR12 is normally merged at the base above, tree-equal to publication5e8c1a7.
Its source82cc019 passed27 new and61 retained groups on Windows PostgreSQL16.16.
All16 owned Docker clusters and the Windows cluster were preserved/stopped; four
temporary compiler/fixture targets were retired through106782 nondeleting probes.
Source/cache/configuration/refs,174 qualified evidence hashes and the immutable
server-log supplement remain verified. Keep that evidence and the known WSL clock
regressions; do not repeat them as a new qualification pass. Inspect compatible
caches and Windows host free space before allocating a new local runtime.

Provider main24e106dc0d87a4085559b8abf159bdcea3dd3626 was inspected read-only.
Its change since d0e63c9 concerns release authorizations and hosting/OpenBao catalog
records, not the selected Auth/delegated-use paths. It supplies no newly qualified
Rifare endpoint, enrolled caller or account-link operation. Other workers own those
deployments. No ElevenID/Supabase source, settings or service will be changed here.
Hosted Actions remain skipped under the cost instruction; local checks, explicit
independent review and normal authorized feature publication/integration apply.

## Restricted completion baseline

Candidate `9755bfbeb78312e01cd18d337ef12171c7f43892` invokes the pinned
`completeCartWorkflow` from a genuine separately initialized native module worker
using its per-original nonprivileged login. Fresh local PostgreSQL qualification
`completion5` reaches `LocalWorkflow.run` but is refused before a commerce write or
provider call. `DistributedTransaction.saveCheckpoint` raises
`SkipExecutionError: Transaction already started` for its newly generated `auto-*`
transaction ID after the workflow engine cannot persist its initial checkpoint.
The worker intentionally has no access to `workflow_execution`; the retained native
worker controls prove that infrastructure state is not generally readable or
writable by an original-execution principal.

The before/after cart, order, link, reservation and payment-family digest is equal,
and the System authorization count is zero. This reproduces the first concrete
healthy-completion blocker; it does not qualify healthy completion or full C12.
Broad `workflow_execution` grants are not an accepted correction. Any continuation
must preserve infrastructure isolation while proving that a workflow checkpoint is
narrowly owned by, and cannot escape, the claimed original and current generation.

Candidate `3cca6c9b47970b8036abcb83a03701db0317dc19` adds that narrow
continuation. The worker receives table privileges only behind forced row-level
security. The policy admits `complete-cart` only when the transaction ID hashes to
the immutable execution seal owned by the authenticated per-original role and the
claim is current, unrevoked and unexpired. Other workflow rows remain invisible.
Fresh `completion9` advances beyond checkpoint creation and is next refused by the
cart query's ungranted `cart_promotion` read. All 31 installed tables in the native
write allowlist remain digest-equal and System authorization remains zero. This
qualifies only checkpoint scoping and identifies the next read-visibility boundary;
healthy completion and full C12 remain unqualified.

Fresh `cartread2` and `completion12` at
`ed975ebe9f5c4e7e85677b0ffb737114dbcd1a03` add forced row-level
visibility for `cart_promotion`. The current per-original role sees only its
claimed cart's link rows; a wrong-cart row is hidden, writes remain ungranted, and
altered or additional policy composition prevents worker creation. An ordinary
nonworker role remains unaffected. The actual completion query advances to the next
ungranted link, `product_shipping_profile`, with the 31-table native write digest
unchanged and zero System authorizations. This is a cart-link read-visibility slice,
not healthy completion or full C12 qualification.

Fresh `productread1` and `completion14` at
`8d4ad1d30e4665531c9381e55b39dee7f5c1277d` scope
`product_shipping_profile` to products actually present on the claimed cart. Own
product links are visible, foreign-product links are hidden, writes are ungranted,
policy drift prevents worker creation and ordinary nonworker access is preserved.
The actual workflow then completes its cart queries and enters upstream
`create-orders`; the existing original guard refuses the first `order_item` because
no execution order has yet been bound. The workflow transaction rolls back with the
31-table native write digest unchanged and zero System authorizations. This proves
product-link read visibility and exposes the order-binding boundary; it does not
qualify healthy completion or full C12.

## Initial mechanism disposition

The a4c7a7e native setup disproved the service-subclass/discoveryPath hypothesis.
It did not reach the intended stale-writer assertion. The pinned loader selects the
re-exported/discovered native service; the official [v2 migration guidance](https://docs.medusajs.com/learn/introduction/from-v1-to-v2)
states that existing services cannot be extended. Preserve that finding and use a
supported extension instead of relying on an undisclosed loader override.
Worker-authentication proof can proceed against unchanged native modules. A separately
named provider adapter is a candidate for local provider-edge enforcement,subject
to explicit profile/binding design and actual native proof. It must not replace
pp_system_default,change legacy C10 commitments or present itself as connected
payment authority. No alternative is accepted merely because the first is unsuitable.
