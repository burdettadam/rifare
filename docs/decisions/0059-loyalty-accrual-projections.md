# ADR-0059: Assign original-unit loyalty accrual and reversal projections

## Prior authority and scope

On 2026-10-20 the owner instructed: "Proceed with next goals working towards the
next milestone." Under the existing delegated local development authority, root
assigns the next bounded increment, M19-G02, from the clean recovered G01 closure
fa7ae08824b4e4acf4031a4262bf8c6da79490a5. Root is integration owner, runtime writer
and sole test executor on goal/M19-loyalty-milestone. Protected main stays at
a33c4ad. This is local synthetic preparation; accepted dependency, merchant-owned
provider, target-stack, privacy qualification and formal M19 gates remain open.
No public release, remote publication, paid action or live provider operation.

The independent test author owns only tests/development/loyalty-accrual.test.mts,
tests/development/loyalty-accrual-helpers.mts and
tests/fixtures/loyalty-accrual/independent-values.json in its separate worktree.
Freeze those tests before runtime work. Authority and regression reviewers remain
independent nonauthors. Root owns packages/commerce/loyalty-accrual.mts,
packages/commerce/loyalty-accrual-evidence.mts,
packages/adapters/loyalty-accrual-fixture-source.mts,
packages/commerce/contracts/loyalty-accrual.v1.json, the optional native owner and
one dispatcher case in support-service.mts, docs/LOYALTY-ACCRUAL.md, this ADR,
PLANS.md, work/records/M19-loyalty-milestone.md and necessary additive inventories
and pins. No financial-owner, permission, worker-grant, migration, accepted-goal
or canonical planning-baseline changes. G03-G05 require their own prior bounded
assignments; this record does not preclaim them.

## Native sources and authority

Reuse LoyaltyBalances for the current verified customer, exact case/link,
ownership generation, current provider snapshot, erasure/uninstall and recovery
interlocks. The G02 projection is staff-only: actual operator, reviewer, owner or
worker role, plus existing resource and operation permissions. A customer cannot
request ancestor financial history. There is no staff impersonation or broader
customer token. Start at a registered original order; a descendant request
returns unsupported/LOYALTY_ORIGINAL_SCOPE_REQUIRED without ancestor details.

LoyaltyAccrual(kernel, {balances, finance, lineage, accrual}) accepts only native
LoyaltyBalances, ResolutionExecution, ExchangeLineage and
LoyaltyAccrualFixtureSource owners. All kernel owners must belong to that kernel;
the finance owner must use the same native ResolutionFixtureSource as lineage.
The accrual source must wrap the exact balance source. Check separate physical
core/finance/fulfillment/loyalty databases, including aliases. Owner references
are immutable. Cross-tenant/store/customer/source binding failures throw; they
are not converted into a successful empty result.

project(scope, customerProof, input) takes exactly case_id, link_id and
expected_generation, the same input as G01 context. It is a synchronous read-only
transaction. It reads financialFacts/unitComponents and the native lineage owner,
ResolutionExecution.read, original source commands/results and capture rows. It
never dispatches, settles, reconciles or edits financial records. Direct source
journal inspection supplements native reads; it is not a new money authority.
Current permissions are required for every descendant and original operation.
Read only this root's bounded descendant graph (at most 100 nodes), original
units (at most 1000), and financial operations (at most 1000); overflow is explicit.

## Versioned synthetic earning rules

G01 redemption rules do not prove historical accrual. A separate native fixture
owner, LoyaltyAccrualFixtureSource(balanceSource), records immutable historical
rule and original-purchase pins in the same isolated disposable loyalty fixture
database. No new customer-linked core persistence or commerce table is added.
Source identity binds the G01 source identity and
rifare-loyalty-accrual-fixture-v1. The G01 owner and its snapshot contract are
unchanged. This fixture owner has no accrue/reverse/reserve/redeem effect method.

Fixture-only publishRules(input) takes exactly revision, currency,
minor_per_point, eligibility, rounding, retained_fees and store_credit. Revision
is a positive safe integer, currency is an uppercase three-letter currency,
minor_per_point is a positive decimal string of at most 24 digits. The fixed
semantics are eligibility=original_paid_total_v1,
rounding=floor_cumulative_per_original_unit_v1,
retained_fees=remain_eligible and store_credit=unsupported. Rules are immutable
per revision; identical current replay is idempotent; decreasing/conflicting
publication fails. Original net paid gross-minus-discount plus allocated tax,
shipping and duties is eligible. Retail/catalog value is never the earning base.
Retained fees are not a settled refund and do not cause reversal. Store credit
does not become money or an automatic reversal under this contract.

Fixture-only pinOriginal(input) takes exactly resource_id, customer_id,
financial_source_identity, original_digest and rules_revision. It binds the
immutable native registered original record's digest and historical earning
rules. A pin is immutable; identical replay is idempotent. readOriginal(resource,
customer) validates stored hashes, identity and the referenced historical rule.
Missing pin or rules means pending evidence. Publishing a later earning rule
cannot change the original award or its reversal. Pin creation is explicit
fixture administration; a projection never creates a historical assertion.
All stored bodies include source identity/scope and are strictly revalidated.

The initial native original seed is synthetic paid-allocation evidence, not a
real capture journal or proof of a historical provider points award. Outputs
remain proposals and cannot claim that the provider already issued those points.

## Economic derivation and limits

Validate the original current paid lines against its immutable registered
original record and the pinned digest. Original prior-refunded/resolved units
without complete event attribution remain pending historical evidence. Current
aggregate prior_refunded_minor alone never qualifies a reversal. Missing current
post-edit paid allocations returns pending/LOYALTY_PAID_ALLOCATIONS_REQUIRED;
do not restore pre-edit facts or infer payment from a changed order total.
Changed original paid allocation/pin is discrepant. Unqualified edit/dispute or
external financial changes are explicit restrictions, not invented point events.

Each original (resource, line, unit ordinal) earns once. Descendant paid totals
are carried funding, not purchases. Validate each native imported node against
its source parent, parent digest, scope, customer, consumed units and funding
amounts. This first projection supports a single consumed unit into a single
child unit per exchange; ambiguous split/merged multi-unit lineage is explicitly
unsupported. Multiple original units and independent single-unit branches are
supported. Missing/unknown imports remain pending, conflicting ancestry remains
discrepant. No implicit traversal outside the authorized root.

Only an exact settled additional-payment capture adds eligible funding. Only an
exact settled refund subtracts eligible funding. Match the immutable core
command and native allocation, all command fields in both the terminal core
observation and authoritative source result, original operation identity, source,
customer, currency, amount and native ID. Additional payments also require the
original exact capture and full settled payment object. Hashes, op.state or
ResolutionExecution convenience booleans alone are insufficient. Duplicate or
reordered observations do not create events; key events by original operation.
Pending/accepted/unpaid/partial/unknown/missing evidence stays explicit and
excluded from qualified totals. A rejected/failed/expired operation with no paid
amount is excluded with its native reason. Conflicting terminal evidence is
discrepant. A source result and local observation must both prove the effect.

This first projection requires a financial event to refer to one native allocated
unit. Multi-unit event allocation is unsupported rather than assigning arbitrary
point shares. Native allocation and operation records must agree. Preserve the
original unit identity through every supported exchange generation. A settled
refund can reverse no more than its unit's original plus truly additional funded
basis. Missing provider accrue/reverse capability keeps that target unsupported;
the native financial refund and its independent authority continue unchanged.

For each original unit, earned_points=floor((original_paid+qualified_additional)
/minor_per_point). Candidate reversal_points equals earned_points minus
floor((original_paid+qualified_additional-qualified_refunds)/minor_per_point).
The reversal ceiling is earned_points. This cumulative rule avoids event-order
rounding drift. Points use safe integers; financial arithmetic uses BigInt. Zero
paid promotional units earn zero while retaining their physical identity.

## Output and service surface

Output fields: schema_version=1, case_id, resource_id, status, reason,
context_digest, source_revision, rule_revision, rule_digest, units, events,
proposals, totals, model_required=false, execution_authorized=false,
enrollment_authorized=false, send_authorized=false,
monetary_conversion_supported=false, production_qualified=false and
projection_digest. totals has earned_points, reversal_points and net_points,
meaning qualified proposed targets, never a spendable provider balance. If the
original basis cannot be verified, totals is null and units/proposals are empty.
Status is ready, pending, discrepant, unsupported or the unready G01 status;
discrepant takes precedence over unsupported, then pending, then ready.

units is canonically sorted by original_line_id/unit_index. Each member contains
original_line_id, unit_index, original_paid_minor, additional_paid_minor,
settled_refund_minor, earned_points, reversal_points and net_points. Financial
events are sorted by operation_id and include operation_id, kind, amount_minor,
original_line_id, unit_index, state (qualified/pending/discrepant/unsupported/
excluded), reason and evidence_digest. No client-supplied event list is accepted.
proposals contains two cumulative targets per original unit (kind=accrual or
reversal), with stable id, original_line_id, unit_index, points, eligible,
rule_revision and operation_ids. IDs bind source/account, original unit,
historical rule and kind; projection_digest binds the entire current result and
source evidence. Targets are not executable delta commands. Unsupported provider
targets remain ineligible and excluded from qualified totals; zero targets do
not manufacture an operation. Returning a recommendation grants no authority.

SupportService may accept an optional native loyaltyAccrual owner bound to its
kernel and balance owner, with exactly one additive loyalty-accrual dispatcher
action taking customer_token and input. Without configuration, that action is
explicitly unavailable. No change to existing dispatchers or default source.

## Independent oracle and verification envelope

The additive two-line fixture has alpha quantity 2 at 1000 paid minor each and
gamma quantity 1 at 1000 paid minor (gross 1200 less discount 200). Rules award
one point per 10 minor. Gamma exchanges with a settled additional 200 into funded
1200, then with a settled residual refund 300 into funded 900. Refund one alpha
unit for 1000 and settle through the native owner. Literal oracle: earned320,
reversal130, net190; alpha net100, gamma net90; three financial operations, one
additional capture, two imported nodes. Replacement retail value is not accrual.
With alpha refund merely accepted: earned320, reversal30, net290; its original
refund remains pending. A later rule cannot multiply either original reversal.

Freeze 20 new native cases, including the three original M19-G02 obligations,
current authority, integer/rule history, alias separation, source/capture
integrity, edited facts, capability gap and no persistence/effects. Native
focused batch: new G02(20), G01 loyalty(20), exchange-lineage(17),
order-edit-return-facts(1): 58 cases/four whole files under the unchanged single
60-second deadline. Root alone executes sequentially with the established
NODE_OPTIONS=--test-isolation=none environment. A separate fault branch will
deliberately add replacement carried value as fresh accrual; the frozen tests
must fail behaviorally, without altering their oracle. No full/connected/formal
suite claim follows from this bounded batch. Both reviewers assess the exact
candidate and preservation of all existing assertions and denominators.
