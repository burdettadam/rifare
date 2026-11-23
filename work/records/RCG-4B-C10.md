# RCG-4B-C10 - Native original payment association

State: implementation checkpoint; fixed qualification and independent reviews pending.
Base: `f7862128261e22f1febb02ce498cf1a8ea66409b`.
Branch: `feat/medusa-payment-binding`.
Writer/integration owner: root, existing primary Rifare checkout.
Contract: [ADR-0088](../../docs/decisions/0088-native-payment-association.md).

C9 PR8 is verified merged with the published feature checkpoint retained. Its owned
80,991-file runtime and 86-file compiler output are removed after fresh Windows
link/consumer/mount/process/delete-share checks. A normal deletion hit a verified
261-character generated path; fresh extended-path retry retired the remainder.
Windows allocated bytes measured on the retry were 418877568; observed host free
space rose 429719552 during that retry under concurrent unrelated activity. Raw
first/final audits, qualification receipts, installed-lock bytes and source refs
remain in existing ignored evidence. No linked checkout remains from C9.

This assignment inspected one primary/zero linked Rifare worktrees and no overlapping
payment/authority feature branch. Root keeps the primary active and starts this
branch from canonical development; no new checkout/cache/runtime is created.
The old implementation history and all prior feature refs stay preserved. Host C
free space observed 62561673216 bytes before assignment, not a guest-disk estimate.

Source inspection confirms Medusa's cart/collection and region/provider link owners,
raw payment amounts, provider-enabled state and compensation behavior. The existing
cart facts intentionally exclude payment data. C10 adds only a separate native
association prerequisite; protected effects remain held. Do not treat a pending
native session or signed historical ACTIVE claim as current execution authority.

Next: implement the bounded native reader/immutable association/privacy tuple with
actual PostgreSQL tests under ADR-0088, then fixed compiled qualification and both
independent roles. Connected provider/custody and complete execution gates remain
owned separately; do not duplicate ElevenID/Supabase deployment work.

## Implementation checkpoint

The native selector, immutable journal association, generated six-column migration,
privacy export/minimization/refusal restoration and native payment fixture are now
implemented. No new route or payment execution entry is enabled. Root remains sole
writer; one primary/zero linked checkouts. Compatible source dependencies are reused.

Exploratory source qualification passed 17 actual PostgreSQL groups, including native
System authorization/capture/refund history refusal, exact money and selection,
original C9/C8 continuity, duplicate writers, deferred COMMIT rollback, fresh-process
lost acknowledgement/recovery, blocked-write trust close, late COMMIT expiry and
ownership withdrawal, and hold/erasure/refusal continuity. Native outcome table
digests stay identical during association/refusal; main-process payment action
entry points are instrumented with zero calls. Child-process recovery is covered
by native table digests, not those process-local spies. All signatures/providers
are synthetic; no external provider or managed-machine custody is qualified.

An exploratory extension initially failed because CLF is absent from pinned Medusa's
currency table. The fixture now asserts unsupported CLF command refusal, exercises
four-decimal precision only at the existing money primitive, and uses supported
JPY/KWD/USD in selector component checks. This is not authenticated foreign-currency
end-to-end qualification. The failed setup log is preserved separately.

TypeScript no-emit passed. The checkpoint additionally includes canceled-entry and
whole-database privacy restore cases, pending fixed compiled execution. Next: own-
dependency compiled consumer, targeted fault, populated C9 component/schema upgrade,
restore and retained regressions; then both independent roles and normal integration.
The user does not know the provider endpoint/enrolled caller evidence path. Keep
that external boundary pending with the provider worker; no substitute identity.
