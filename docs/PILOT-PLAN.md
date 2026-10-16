# Rifare bounded pilot plan

**Status: proposed; no merchants recruited, consent obtained, observation period
started or pilot authorized.** This is M00-G02 planning. M07-G17 implements the
approved measurement protocol; M07-G18 collects and independently reviews actual
observations. No source file or assistant statement can stand in for those facts.

## Roles and decisions before recruitment

[The benchmark](../planning/release-benchmark.json) contains eight roles, each
with an unassigned person and absent approval reference. Appoint the product
owner, benchmark custodian, pilot lead, per-merchant authorizer, operations owner,
privacy/security owner, independent regression reviewer and independent authority
reviewer before activation. A product owner may authorize work; they are not an
independent reviewer of their own implementation.

Recruitment is separately authorized. Target three independent real merchant
profiles, initially technically supported US physical-goods merchants using the
approved domestic USD workflows. Synthetic apparel/fragile/clearance profiles are
design fixtures, not participating customers. Record store/merchant independence
and sample limitations rather than inferring representativeness or market fit.
Do not email prospects, create accounts or incur service charges from this plan.

## Staged entry

1. **Synthetic fixtures:** verify contracts, adversarial cases and manual paths.
   These count only as synthetic tests, never as live cases or pilot days.
2. **Connected test store:** obtain scoped test credentials; qualify actual native
   records, holds, gateway semantics and recovery. Test settlement is not live
   settlement; a local manual refund record is not proof of funds movement.
3. **Read-only shadow:** obtain merchant permission and notices, compare with
   operators without sending messages or changing commerce state. Establish the
   prior/manual baseline and independently verify expected facts.
4. **Human-approved pilot:** name one writer per workflow, require exact action
   approval, confirm budgets/limits and emergency takeover. Progress only when
   prior gates and the specific merchant/platform configuration are accepted.
5. **Bounded autonomy:** qualify each permitted skill/profile/platform/runtime/
   model configuration separately. Safe handoff remains a valid expected behavior.
   Provider/model changes require new scoped evidence, not inherited global trust.

These phases are readiness gates, not calendar promises. Moving a case to human
handling because of an outage remains a recorded outcome, not a deleted attempt.

## Consent, privacy and source access

Obtain recorded merchant opt-in for exactly permitted actions, account scopes,
order/currency/value limits, channels, messages, data categories, model endpoints,
egress policy and cost caps. Merchant opt-in does not establish shopper marketing
consent. Approve required notices, channel opt-out behavior, withdrawal handling,
source-system read access and retention before collecting personal records.

Use minimized pseudonymous case references; keep source records in approved access
boundaries. Do not put raw identities, messages, merchant secrets, financial records
or model inputs in Git. Need-to-know reviewers obtain evidence through the agreed
secure channel. A reference or digest must not pretend that external content was
actually reviewed. Approve applicable privacy/legal requirements independently.

Proposed retention is 30 days for minimized raw pilot evidence after review closes
and 90 days for permitted aggregate/reference records, unless separately approved
required schedules apply. Those are proposals for review, not legal determinations.
Deletion must cover attachments, indexes and agent traces. Consent withdrawal stops
new processing immediately; an authorized deletion or missing evidence must be
reported honestly without silently improving denominators.

## Enrollment and measurement

Before outcomes are known, freeze case identity, source, eligibility, expected
handling, exact configuration and observation cutoff. One case represents one
customer intent; retries/messages do not create additional successes. Preserve
failed, pending, cancelled and excluded cases and their reasons. Handoffs can be
correct handling but are not autonomous resolutions or completed resolutions.

Targets: three independent opted-in merchant profiles, at least 100 in-scope live
outcomes, 30 consecutive pilot calendar days, and at least 20 cases per required
quality stratum. Report per-merchant exposure and per-configuration counts. Many
configurations may require substantially more than 100 cases to satisfy every
stratum. Overall rates cannot hide a failing small stratum.

Seven-day related-contact windows start after completed resolutions. Wait for the
last required window, or report incomplete follow-up. A 30-day collection window
can therefore require follow-up beyond day 30. Immature or missing observations
cannot become zero repeat contacts. Record attempts, human handoff/completion,
correct outcomes, elapsed time, native financial stages, all attributable costs,
appeals, consent problems and survey coverage separately.

Prior/manual comparisons use a separately consented, frozen and comparable scope,
window and cost basis. Publish sample and selection limitations; do not claim
causal ROI, statistically conclusive product quality or accounting profit from
these minimal pilot counts. Forecasts, partner services, broad currencies and
unsupported configurations remain excluded unless separately qualified.

## Stop, recover and decide

SEV0/SEV1 findings stop the affected actions/configurations immediately and go to
the accountable owner. Provider outages, stale approvals and unknown irreversible
outcomes lead to safe human handling and reconciliation. No unapproved fallback
provider may receive data. Preserve incidents and negative observations.

Before any rollback, stop new writes, establish ownership and reconcile outstanding
native obligations. A restored worker cannot replay queued live actions. The
operations owner must demonstrate actual restore, resource and alert behavior
under the declared workload; a document pass supplies none of those guarantees.

The product owner and independent reviewers decide the permitted release claim
using the integrated candidate and actual observations. Insufficient recruitment,
missing consent, unassigned reviewers, unmeasured capacity, unresolved high/critical
findings or incomplete follow-up keep the affected claim blocked. Ship only an
explicitly limited beta/release candidate if separately authorized. Do not lower
thresholds, invent elapsed days or interpret synthetic examples as real customers.

## Review checklist

The review must resolve the exact M00-G01 revision, benchmark revision, role
assignments, 20-case-per-stratum proposal, workload/recovery targets, consent and
retention choices, permitted autonomy, provenance, external review channel, stop
ownership, migration/restore plan and data-removal procedure. Record decisions in
an authenticated review process; the worker does not fill in approval for others.
