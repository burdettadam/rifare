# Current-state journey follow-ups

## Assigned local scope

ADR-0056 assigns one transactional tracking follow-up to an existing journey
intent. It uses the native reviewed `queue_tracking` rule, the
`tracking_status_v1` email template and the existing operation/work/receipt
owners. This profile adds no campaign, consent, exposure, financial or message
ledger. It has no model-thread dependency. Exact runtime evidence and independent
review decisions belong to `work/records/M18-journey-checkpoint.md`.

The profile remains a local synthetic preparation. Formal M18 acceptance,
independent remote-client authorization, connected-channel delivery, target-host
qualification and missing-history reconciliation remain separate open gates.

## Schedule and inspect

`JourneyFollowups(k, journeys)` requires an actual same-kernel CommerceJourneys
and SupportDelivery. Cart, resolution and edit owners must be the same actual
native instances on both services. The delivery owner's optional sixth argument
supplies those owners; existing five-argument construction remains available.

`schedule(scope, customerProof, input)` takes the exact rule ID/version/digest,
journey ID/version/context digest/intent/reference, original native event,
ownership generation and expiry. It requires a separately supplied current
customer proof for the exact case/order/customer/source contact, a verified email
link, the current staff owner, `support.reply`, `operation.read` and native
`support.send`. JSON normalization rejects getters and extra fields before work.

One logical step belongs to tenant, store, journey, intent and the fixed template.
An exact original request returns its current finite projection after current
scope/proof/ownership checks. A changed request conflicts even after completion
or suppression. A new event ID cannot create another follow-up for that step.
The original native job uses reserved `sjf_` identity; ordinary `sj_` counterparts
and unsupported helpdesk routes cannot create a duplicate around it.

`inspect` takes case, verified email link, current ownership generation and the
original job ID. It reads current eligibility without queueing, dispatching,
confirming a cart or creating a business effect. Customers and current callers
without `operation.read` receive a finite restricted projection. The same
restriction applies to guarded records exposed through native job, delivery and
service-context views. Guard bodies, memory values, private native references,
proof tokens and source-specific observations do not enter those restricted views.

SupportService exposes `journey-followup-schedule` and
`journey-followup-inspect`, both taking exact `{customer_token,input}`. Its
`journeys` option feeds the same native owners to composition and delivery.
There is no additional worker grant or remote route.

## Native eligibility and delivery

The supported selections are tracking with no completion reference; shopping
with an attached canonical cart; return/exchange with an original refund or
store-credit operation; and editing with an original edit. Pending return intake,
replacement/label operations and additional-payment obligations are not selected
completion references for this tracking profile.

| Native observation | Follow-up meaning |
| --- | --- |
| Cart proposed or committed/active | Still eligible if the other current guards pass; inspection never commits it |
| Cart purchased | Suppress with `cart_purchased` |
| Refund accepted | Pending; acceptance does not establish settlement |
| Original refund cash settled | Suppress with `refund_settled` |
| Original store credit issued | Suppress with `credit_issued` |
| Edit ready for release | Pending |
| Edit released, cancelled or abandoned | Suppress with its exact terminal reason |
| Native uncertainty or unavailable owner | Require current review/reconciliation |
| Email accepted | A source acknowledgement, with `customer_delivered:false` |
| Email delivered | Preserve the actual native delivered observation |

The abandoned reason is supported from the native enum; local positive edit
fixtures exercise actual release and cancellation methods.

Waiting execution and final send validate original job/event/guard pins, the
current journey document version and digest, the selected canonical reference,
memory ID/version and its own original source link, current source versions and
digests, ownership, published rule/reviewer authority, consent and native owner
observations. Missing memory is explicitly version zero. No preference value or
memory-body digest is copied. The existing bounded G03 resource-wide uncertainty
guard also applies, including its store-wide 100-row native-return/edit-child
capacity checks.

The follow-up horizon is at most seven days, no later than rule expiry and
strictly after the actual native UTC due time. Native sender expiry remains at
most one day, and queued delivery expires within one hour or sooner with its
sender. Changing a current pin never automatically repins a scheduled step.

Before due time, direct queueing creates no operation. At due time a valid direct
queue can exist while the rule job is waiting. Dispatch refuses that incomplete
job before claiming work, preserving the eligible operation for native rule
execution. The final transaction repeats the completed-job/exact-operation check
and current eligibility immediately before `DurableWork.beginSend`. Existing
parent-session, sender, contact, consent, tracking, stop and recovery guards stay
in force; the saved parent session is not widened with operation-read authority.

Unknown or observed delivery retains the original operation and payload. Its
native reconciliation remains lookup-only, including after a journey is forgotten
or consent changes. It never becomes an unsent suppression or a fresh event.

## Retirement, privacy and recovery

Finite `journey_followup` documents use the existing support-document table.
All versions have contiguous numbering, validated hashes and one immutable
case/resource/subject/logical/request/job identity. The server's actual journey
document digest is stored separately from the caller's context digest.

Dynamic retirement appends one minimized tombstone, revokes every personal
version, and scrubs unheld context. Held personal history stays revoked and
unavailable; cleanup follows hold release. Original job and delivery pins remain
unchanged even when legitimate redaction changes an old guard-body digest.

Retirement cancels a waiting job. If an exactly associated delivery is provably
unattempted—operation queued, work pending with zero attempts and no lease,
observation, provider reference or contrary receipt history—it uses native
failed/dead `FINAL_AUTHORIZATION_DENIED` semantics. This releases the support
stream without a source call or new operation. Leased, retrying, unknown and
observed operations keep their existing native paths.

Subject export has an allowlisted `journey_followup_records` projection. Retained
subject identity also finds original guarded jobs and delivery copies after an
order is reassigned or the subject owns no current resources. Erasure minimizes
all versions and those exact native copies before case/source erasure, preserving
attempted operation identities and recorded stages. Uninstall revokes all history.

Backup restore and first/repeated merchant import validate original and
destination retained structures separately. Copied context is scrubbed in place
and waiting work is cancelled. Current erasure overrides an obsolete copied
hold; unsuppressed held personal guard data causes atomic
`JOURNEY_FOLLOWUP_RESTORE_HELD`. Nothing automatically resumes after restoration.

## Verification boundary

The independent author froze 19 native cases before runtime implementation. The
assigned selection also includes nine support-delivery, eight support-rules and
24 growth-marketing cases: 60 native cases, four whole files and one 60-second
deadline through the unchanged runner. No full-regression or formal-acceptance
claim follows from that selection.

An isolated fault removes only the new final journey guard. Its purchase race
uses a transactional tracking payload without a campaign, while the original
journey, memory and tracking facts remain unchanged. The independent cart source
changes purchase status in `beforeFinal`; zero message-source effects is the
oracle. The fault branch must remain outside the candidate's ancestry.
