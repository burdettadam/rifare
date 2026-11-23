# ADR-0091 - Recover original native payment observations

Status: implemented, locally qualified and independently reviewed; integration pending.
No payment dispatch authority or parent-goal acceptance.
Base: `258904eaa384a6bbe4f9f8084751ac4e42323580` (Rifare PR11).
Branch: `feat/medusa-original-payment-outcomes`; root is sole writer/integration owner
in the existing primary checkout. Use the existing work-goal/worktree-flow skills.

## Assignment RCG-4B-C11

Continue COMMERCE-AUTHORITY-01's original-outcome recovery requirement. C10 already
binds an exact pending native collection/session/provider, but its pending-only
recovery refuses after actual payment progress. Add a separate internal historical
observer over that committed association. Preserve C10's pending behavior/profile,
all existing C7/C8/C9 evidence/criteria, public holds and operation states. This is
an application recovery feature, not permission to perform or repeat a payment.

Use the actual retained original command and C10 association. Search native payments
matching collection OR session, including deleted history. Require one consistent
original with exact IDs, provider, original currency and raw principal. Refuse
replacement/extra/mismatched/aliased identity; do not choose the first convenient
row. Persist the first native payment ID, scoped refusal fingerprint and observation
time once in the existing journal, with revision/privacy locks and a unique
constraint. Future reads recover that identity or refuse. Native payment absence is
explicitly unresolved, never proof of no provider effect. Retain contradictory data
for the owning reconciliation path; add no provider call, resend or compensation.

Keep current native customer/auth identity, merchant/store/channel ownership and
privacy checks. Completed carts, expired original request/receipt evidence, changed
cart totals and retired provider/region eligibility do not themselves invalidate a
historical financial observation. Do not run fresh cart/receipt admission or promote
historical evidence into execution authority. Copy verified server context before
awaits, sample the database clock after lock waits, reject regression and recheck
ownership/privacy/original binding after first-binding COMMIT and before return.

Return a bounded allowlist of native IDs, exact raw-derived minor amounts, statuses,
deletion markers and observation times. Keep payment/capture/refund facts separate
from original order transactions/credits/summaries. Bind any completed order through
both original cart and original collection links with matching current party/channel
access. A refund-success/bookkeeping-error must remain visibly distinct from a
reconciled outcome. Never expose provider data, metadata, notes, tokens, keys or
customer addresses. Never infer external settlement/current provider status or a
safe no-effect retry from native status, captured_at, missing rows or workflow errors.

Add only nullable fields/constraints/indexes to the existing journal model/migration.
Privacy export/hold/minimization/uninstall/whole-database restore must preserve the
new refusal fingerprint and immutable first identity. Legacy refusal records remain
valid only when they do not discard a retained newer fingerprint. No new ledger,
payment engine, account-link service, public route, provider adapter, deployment,
policy exception, source-catalog rebaseline or release is assigned. A pure factoring
of the C10 canonical identity/digest is allowed only if its exact profile/output and
retained controls remain unchanged.

## Required evidence

Use actual PostgreSQL/Medusa System fixtures and genuine synthetic C7/C8/C9 originals.
Demonstrate pending absence, authorization, partial/full capture, refund/cancellation,
completed-order binding, expired receipt and changed-cart recovery, native refund
bookkeeping failure, missing/replaced/aliased/ambiguous identities, raw money and
provider/region retirement semantics. Assert zero provider/workflow calls and native
financial/order table changes during observation. No external settlement is implied.

Exercise concurrent first observations, fresh-process lost acknowledgement recovery,
deferred COMMIT rollback, post-wait/post-COMMIT ownership/privacy/abort changes,
immutable identity replacement refusal, unique fingerprint reuse after minimization,
privacy hold/export/erase/uninstall and whole-database restore. Fixed integration
requires own-dependency compiled execution, populated prior-C10 component/schema
upgrade/replay, exact input/output/lock/evidence receipt and both actual independent
review roles. Fault original session/payment equality and the unique refusal guard;
unchanged independent assertions must detect them, then verify exact restoration.

Reuse the existing source cache/primary before any runtime allocation; check Windows
host free space first. A later owned runtime/generated output retires after review
and integration with the workspace lifecycle gates. Hosted Actions remain skipped
under the cost instruction; normal authorized feature push/review/merge applies.
Provider/Supabase deployments and enrollment/account-link evidence stay with their
other owners. Full COMMERCE-AUTHORITY-01, IDENTITY-APP-02, DELEGATED-PURCHASE-01,
provider reconciliation, final-effect fencing and production/transfer stay open.

## Observation contract before implementation

The new internal method is recoverNativePaymentOutcome(original UUID, verified native
context, optional AbortSignal). Its profile is
urn:rifare:native-original-payment-observation:v1. It returns the original association,
native_payment or null, capture/refund record arrays, exact minor-unit native
collection totals, optional original-order transaction/credit/summary facts,
consistency comparisons, immutable first-payment observation time and a later database
observation time/content digest. Provider payloads and idempotency keys are excluded.
execution_authorized, live_provider_status_verified, external_settlement_verified and
absence_of_remote_effect_proven are always false. A content digest may stay unchanged
while observation time advances; it is neither a grant nor a settlement proof.

The native projection uses a consistent serializable snapshot and bounded explicit
columns. Existing owner/privacy locks remain; do not lock financial writers merely
to manufacture freshness for a historical observation. Recheck in a new transaction
after first-binding COMMIT. Report/refuse ambiguous or inconsistent identity rather
than migrating the original to another native payment. Keep C10's strict original
principal/currency checks; native order totals may legitimately change after credit
lines and are reported separately from the original paid principal.

## Qualified local profile and temporal limit

Qualified source82cc0199ba13603d10dbe51b4ba83ec387ffce36 executes the99-file compiled
application in its own unchanged-lock dependency installation. Windows PostgreSQL
16.16,UTC,loopback SCRAM and an owned portable data directory are the explicit
passing temporal profile; no service registration or shared-clock change occurred.
The official [EDB binary index](https://www.enterprisedb.com/download-postgresql-binaries)
resolved its Windows16.16 archive; no archive checksum was published. The retained
archive SHA256 and valid EnterpriseDB executable signatures bind the actual tool.
[pg_ctl](https://www.postgresql.org/docs/16/app-pg-ctl.html) controlled only that fixture.

The uninstrumented campaign passes27 C11 groups and retained C10=18,C9=19,C8=13,
C7=11. A separate100-original native setup probe observed no negative steps but
is exploratory,not proof of permanent clock stability. Docker PostgreSQL16 provided
actual populated prior-component/source/compiled schema upgrade/replay and both
meaningful faults; Docker and Windows provided separately attributed whole-database
restore evidence. Those profiles are not interchangeable deployment acceptance.

Earlier WSL/Docker native setup captured database backward steps of776ms and1913ms;
Windows samples surrounding those calls advanced. CPU affinity did not resolve it.
The host-level cause is unestablished. Original time guards remained unchanged and
correctly refused affected operations. WSL/Docker temporal qualification and all
production clock behavior remain open; no retry or time-floor waiver is introduced.
The [work record](../../work/records/RCG-4B-C11.md) binds the immutable receipt,
server-log snapshot supplement,actual independent reviewer actions and lifecycle.
