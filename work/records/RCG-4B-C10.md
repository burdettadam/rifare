# RCG-4B-C10 - Native original payment association

State: bounded local implementation accepted by delegated maintainer; normal PR9 integration pending.
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

## Independent source correction round 1

The authority reviewer required payment history lookup by collection OR session,
including deleted/mismatched links, and an actual live locked Region rather than
only a surviving eligibility link. Both are corrected with direct native refusal
assertions. The restore recovery-refusal assertion now uses a genuine synthetic
receipt verifier/public trust instead of an invalid placeholder. Regression source
review found no separate scoped blocker; both final reviews remain pending.

The first own-dependency compiled run at df53b12 passed all 18 payment groups plus
signature/codec checks, but its harness then reused the payment fixture country in
the C9 retention database. Preserve that setup failure; use separate databases in
the corrected qualifier. A source exploratory correction run reached C10-CLOSE then
failed closed in the inherited current C7 request-time gate while creating another
fixture; it is not a passing run and does not justify relaxing time enforcement.

## Fixed qualification and independent final disposition

Qualified source: `66504d0b4a3f463a8480bb5b1a6524bd0bf3a8fd`, against the C9 base above.
[PR9](https://github.com/burdettadam/rifare/pull/9) preserves the published branch.
Root reused the source dependency cache and the task-owned unchanged-lock production
installation after source correction; no linked checkout was created. Initial
installation used offline npm ci, omitted development dependencies and disabled
scripts. Host C free-space checks preceded allocation and correction qualification.

The fixed own-dependency compiled consumer passed payment association 18, real C9
native continuation 19 and synthetic mTLS session 10, receipt signatures 38 and proof
codec 21, retained C8 receipt 13 and final unchanged uninstrumented C7 request 11,
plus native schema/privacy. The money selector fault removed only the session raw
amount equality: FIRST passed, then MONEY failed the unchanged expected-refusal
assertion. Restoring exact compiled bytes returned selector SHA256
`32fbd5c060e985cdd401cdd6919b972dfdd600681068ab06c677b6357143be0c`.

Whole PostgreSQL dump/restore erasure and uninstall reconciliation passed with a
genuine synthetic receipt verifier. Populated prior-C9 service/component and schema
upgrade/replay preserved all 14 checked whole-table counts/digests, including retained
C7/C8/C9 evidence and native commerce history. The real prior f786212 service was
transpiled with TypeScript 5.9.3 while only the new migration was paused. This was
not a whole prior-application rebuild. All six added columns were nullable and null
for existing rows. All signatures/providers/records were synthetic; native System
authorization/capture/refund setup qualifies local history refusal, not live effects.

Fixed receipt `evidence/operation-journal/66504d0b4a3f463a8480bb5b1a6524bd0bf3a8fd/c10-runtime-input-output-receipt.json`
has SHA256 `432debd78ebdf7144b7d8ed2864a34d00557e53f6b68ce0e2781552ca0fe3db0`.
Both actual independent roles, `/root/c7_authority_review` and
`/root/rifare_regression_review`, recomputed all 324 Git/disk inputs and 91 compiled
outputs, dependency locks, fixture membership and listed evidence hashes. Both
cleared bounded local integration with no remaining scoped blocker. These are
actual separate reviewer sessions, not fabricated GitHub approving reviews.
Root accepts this bounded local prerequisite under the existing delegated authority.

Earlier corrected-candidate C7 executions failed in REQUEST_TIME_INVALID and the
WIRE blocked-UPDATE probe. Diagnostic and final uninstrumented executions passed
the same unchanged 11 cases. The cause remains unestablished: do not claim a clock
jump, deterministic reliability or a diagnosed product fix. Both independent roles
dispositioned this as nonblocking local qualification uncertainty; retain the failed
logs and diagnose recurrence during subsequent qualification without relaxing guards
or assertions. Other exploratory fixture/harness failures remain excluded as above.

Repository/generated/plan checks, TypeScript no-emit, full distribution and license
inventory, runtime intake four cases and Gitleaks passed. Shared public protocol 51
and retained client/catalog 47 cases passed unchanged. The first shared run selected
an incompatible host OpenSSL; the documented task-local Git OpenSSL PATH passed
with no test changes. No whole project suite, connected provider or release claim.

The selected profile is inert local pending System payment identity. Protected
execution, live status, remote outcome reconciliation, enrolled machine custody,
identity linking and final effects remain open. Supabase/ElevenID deployments stay
with their other workers. The broad handoff goal remains active. Next: normal merge
of exact published metadata checkpoint after review carry-forward; retire owned
inactive runtime/compiler output with Windows gates and retain source/cache/refs,
installed-lock bytes, logs, dump and review evidence. Rifare audit scope remains
one active primary (root) and zero linked checkouts; no verification checkout exists.
