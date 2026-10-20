# ADR-0058: Recover Rifare and assign the local loyalty balance foundation

## Authority and recovered source

On 2026-10-20 the owner requested recovery after a nonresponsive chat and then
continued development. Standing delegated local development authority applies.
Root restored the exact roadmap base a33c4ad and the later saved M18 continuity
checkpoint 98b968cd0965366af6bb7dd12d23057abc8f6155, tree
d1e4a01f770f64c374e4c675f70c2ede02f7feee. The supplied shopper-memory ZIP is an
older ancestor. All 291 later package hashes, 95 changed-source hashes and 21
saved refs match; native Git fsck passes. Seven deliberate fault refs are
preserved outside product ancestry. Protected main remains a33c4ad.

Later chat descriptions of M19 are not recoverable implementation: no M19 source
or commit exists in these saved refs. Missing later M15/M16/M23 source remains
unreconciled. This assignment starts from the verified M18 source, preserving
all accepted records and formal gates. It assigns only bounded local M19-G01,
not G02-G05 or formal M19 acceptance. The goal's local-then-separate-qualification
path permits synthetic preparation; M07/M09 and actual provider prerequisites
remain open. No external provider, publication, release or production effect.

## Ownership before implementation

Root is integration owner and sole runtime writer/executor on recovery/M19-resume.
An independent test author owns only tests/development/loyalty-balances.test.mts
and loyalty-balances-helpers.mts in a separate worktree, with a committed freeze
before runtime implementation. Two nonauthors independently review authority
and regression. Prior test assertions and all native owners remain unchanged.

Assigned root paths: packages/commerce/loyalty-balances.mts,
packages/commerce/loyalty-values.mts,
packages/adapters/loyalty-fixture-source.mts,
packages/commerce/contracts/loyalty-balances.v1.json, and the additive optional
owner plus two dispatcher cases in packages/commerce/support-service.mts.
Documentation: this ADR, docs/LOYALTY-BALANCES.md, PLANS.md and
work/records/M19-recovery-checkpoint.md. Root owns necessary additive component,
source/test/capability inventory and runtime/oracle pins. No migrations, kernel
permissions, worker grants, canonical goal/acceptance records or dependencies.

## Source contract fixed before tests

LoyaltyFixtureSource(db, config, clock) uses a separate SQLite fixture database.
config has exactly tenant_id, store_id, account_id and provider; IDs use native
id validation. provider is full or limited. The source has readonly db, tenant,
store, account, provider, identity and contract. contract is
rifare-loyalty-fixture-v1; identity binds the entire configuration and contract.
Reopening the same fixture database with a different identity fails.

Its fixed capabilities are booleans read, accrue, reserve, redeem, reverse and
lookup. full declares all true. limited declares read/accrue/redeem/lookup true
and reserve/reverse false. These are synthetic source semantics, not installed
effect handlers or evidence about an external provider. No source effect method
is implemented by this read-only increment.

publish(input) is fixture-only administration. Its exact input is customer_id,
source_revision, observed_at, expires_at, complete, balances and rules.
source_revision is a positive safe integer. Timestamps are nonnegative safe
integers; expires_at is after observed_at and at most 300000 milliseconds later.
complete is boolean. balances has exactly unit, pending, earned, reserved,
redeemed, reversed and available. unit is points. Counts are nonnegative safe
integers and available equals earned minus reserved, redeemed and reversed;
pending is never spendable. Validate arithmetic without unsafe intermediate
Number sums. rules has exactly revision, unit, minimum_redemption,
maximum_redemption, redemption_step and expires_at. revision and the three
redemption limits are positive safe integers; maximum is at least minimum;
unit is points. Rules have a finite positive safe-integer expiry.

Source snapshots are immutable versions in fixture_loyalty_snapshots with
customer_id, source_revision, body and digest columns and a composite key.
fixture_loyalty_identity stores its original source identity. Same-version
identical publish is idempotent; conflicting or decreasing source revisions
fail. Rules cannot decrease revision, or change content within a revision.
observe(customer_id) returns null when absent, otherwise the highest snapshot
as an envelope: schema_version=1, tenant_id, store_id, account_id, provider,
source_identity, source_contract, qualification=synthetic_only, capabilities,
the exact snapshot fields and digest. digest hashes the envelope without itself.
It validates stored body/digest and row identity; it never refreshes observation
time merely because a caller reads. No HTTP/network provider is introduced.

## Current access and nonauthorizing quotation

LoyaltyBalances(kernel, source?) accepts only that native source class and refuses
the core database as the fixture source. context(scope, customerProof, input)
accepts exactly case_id, link_id and expected_generation. Reuse supportCase,
growthCustomerProof, SupportConversations.linkRecord, ownershipRow and
assertSupportOwner. Require a current exact customer proof and case/link/resource/
tenant/store match; noncustomer readers must own the current support generation.
Current support/resource permissions, source customer ownership, erasure,
uninstall and native recovery egress interlocks apply. No model is required.
Source tenant/store/account identity is checked on every read; callers cannot
supply an account or snapshot to expand scope. Inspecting another kernel or
using an arbitrary source-shaped object is rejected.

Every observed envelope is strictly revalidated by the service, including its
digest, source identity, capabilities, units, coherent integer amounts and rules.
No source yields needs_configuration/LOYALTY_SOURCE_NOT_CONFIGURED. No matching
account snapshot yields unavailable/LOYALTY_ACCOUNT_NOT_FOUND. Invalid source
content yields unverified/LOYALTY_SOURCE_INVALID. Incomplete yields
incomplete/LOYALTY_SNAPSHOT_INCOMPLETE. A future observation, expired snapshot,
observation older than 300000 milliseconds or expired rule yields stale with
LOYALTY_SOURCE_FUTURE, LOYALTY_SOURCE_EXPIRED, LOYALTY_SOURCE_STALE or
LOYALTY_RULES_EXPIRED respectively. A valid current source yields
available/LOYALTY_CURRENT_SOURCE. Expiry is inclusive (expires_at <= now).

Context includes schema_version, case_id, resource_id, ownership_generation,
status, reason, snapshot, snapshot_digest, model_required=false,
execution_authorized=false, production_qualified=false, context_digest. snapshot
is the verified envelope without digest only when available; otherwise null.
snapshot_digest is that envelope digest only when available; otherwise null.
Source scope violations and current caller/proof failures throw, not unavailable
responses. Neither model text nor a context digest authorizes an effect.

quote(scope, customerProof, input) adds exactly points, unit and snapshot_digest
to the context input. points is a positive safe integer, unit must be points,
and snapshot_digest is a lowercase SHA-256. It rereads current context and
requires that exact snapshot before producing terms. It returns schema_version,
case_id, resource_id, points, unit, eligible, reason, terms, snapshot_digest,
execution_authorized=false, enrollment_authorized=false, send_authorized=false,
monetary_conversion_supported=false, production_qualified=false and quote_digest.
No current context => eligible=false with its reason and null terms. A changed
snapshot => LOYALTY_SNAPSHOT_CHANGED. Missing redeem/reserve/lookup capability
=> LOYALTY_REDEMPTION_UNSUPPORTED / LOYALTY_RESERVATION_UNSUPPORTED /
LOYALTY_RECONCILIATION_UNSUPPORTED. Missing reversal is exposed in snapshot
capabilities, not emulated. An amount outside minimum/maximum or not an exact
multiple of redemption_step => LOYALTY_REDEMPTION_RULES; insufficient available
points => LOYALTY_INSUFFICIENT_POINTS. Otherwise eligible=true with
LOYALTY_QUOTE_ELIGIBLE. terms is exactly account_id, source_identity,
source_revision, rules_revision, points, unit, expires_at (minimum of source and
rule expiry) only when eligible. Eligibility is a diagnostic proposal condition;
there is still no reservation, redemption, enrollment, discount or send action.
Every ineligible quote has null terms. Strict inputs reject money/store-credit
units, conversion fields, provider threads, accessor properties and snapshots.

SupportService receives an optional native LoyaltyBalances instance as loyalty,
requiring its kernel to match. It defaults to an unconfigured read service.
post actions loyalty-context and loyalty-quote accept exactly customer_token
and input, authenticate the token and call the corresponding owner. No new HTTP
route, work grant or autonomous effect authority is added.

## Privacy and recovery boundary

Context and quotes are transient. No customer mappings, snapshot, points, rules,
quote or transcript is persisted in commerce storage, logs, support documents,
model memory or application caches. Existing private customer records retain
their lifecycle owners. After erasure/uninstall/takeover/proof revocation,
previously returned context cannot reopen access. Restored native databases keep
their existing egress/customer-proof restrictions. The separate disposable
fixture source is synthetic test data; erasing Rifare does not purport to erase
external provider storage or bytes already returned to an authorized caller.
Future persistent loyalty operations require a separate storage/lifecycle design.

## Focused evidence and continuation

Freeze 20 independent native cases, including CASE-M19-G01-01/02/03, before
runtime. Cover source freshness/integrity/units, provider differences, current
proof/scope/ownership/permissions, exact quote binding/limits, dispatcher,
erasure/uninstall/recovery, and absence of a persisted personal cache or effect.
Select the new whole file plus existing support-conversations (7), growth-shopping
(15) and privacy-lifecycle (9): planned 51 native cases, four files, one unchanged
60-second deadline. Root runs once per coherent candidate; repeat only for a
concrete failure or corrective review. A separate temporary freshness fault must
be caught behaviorally by unchanged new tests and must never enter product.
Independent reviewers inspect actual source/evidence; no duplicate test campaigns.

Formal G01/M19 remains open. G02 original paid-line accrual/reversal projections,
G03 durable points reservations/unknown outcomes, G04 current incentive comparison,
G05 real lifecycle and G99 assessment remain later assignments. The final handoff
will include full native history so recovery no longer depends on an older ZIP.
