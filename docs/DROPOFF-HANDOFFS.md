# Item-level drop-off acceptance

## Local development scope

M20-G03 adds an initial drop-off observation to the existing InternationalHandoffs
custody owner. It records the individual units actually reported by a synthetic
source, including rejections and later corrections. Unmentioned units remain
outstanding. The prior assignment is
[ADR-0064](decisions/0064-dropoff-item-acceptance.md); progress and exact evidence
belong in [the M20 work record](../work/records/M20-dropoff-milestone.md).

This is bounded local preparation. Accepted prerequisite milestones, connected
providers, real sites, devices and physical handoff qualification remain open.
Source observations do not establish warehouse receipt, inspection, inventory,
fees, refunds or settlement. Those stages retain their existing native owners.

## Ownership and identifiers

The source wraps the actual G02 credential fixture and its original directory,
account and separate provider database. Its journal contains immutable, secretless
events. Recording a new acceptance requires the credential payload and the exact
original item manifest; neither is copied into the event journal.

The core caller supplies only an original issue operation and event ID:

```ts
const source = new DropoffHandoffFixtureSource(credentialSource);
const custody = new InternationalHandoffs(kernel, partnerSource, {dropoff: source});

custody.importDropoff(scope, {issue_operation_id, event_id});
custody.readDropoff(scope, issue_operation_id);
```

Read-only historical projection also works through a freshly constructed
two-argument InternationalHandoffs owner, without an attached drop-off source or
delivery key. The new methods leave legacy shipment plans and sent/received
observations in their original format.

Each unit is identified by the original return family, line and one-based ordinal.
The stored unit reference is opaque. Credential replacement does not create new
unit identities. A source family is limited to one hundred expected units; complete
journals and native typed records have explicit one-thousand-event bounds.

## Acceptance and correction behavior

| Observation | Effective quantity and custody |
|---|---|
| No observation for a unit | Outstanding, with no accepted site |
| Accepted | Counted once at its observed site |
| Rejected before any acceptance | Rejected and outstanding |
| Rejected correction after acceptance | Disputed and outstanding; the last accepted site remains visible |
| Accepted correction after a dispute | Accepted once; the dispute is resolved |
| Exact same event replay | Original event and quantities are retained |
| New event repeats an already observed unit | Denied; correction must name its current parent |

Accepted observations use the fixed reason accepted. Rejected observations use
wrong_item, damaged, unsupported or not_present. No free-text event field is
accepted. A correction can affect a subset of its parent's units, and disjoint
subsets can be corrected independently. A stale parent for any affected unit
rejects the complete correction.

Rejected and disputed counts are separate. Outstanding always equals expected
minus accepted, so it includes rejected and disputed units. Retracting acceptance
does not prove that goods returned to the customer. The history retains both the
original observation and every linked correction.

## Admission, uncertainty and retry

The source assigns admission time and sequence. A genuinely new scan must use a
currently usable credential; callers cannot backdate it. A valid earlier event
can be imported after credential expiry, revocation or loss of the delivery key.
Corrections can also follow expiry because they update retained evidence and
cannot introduce an unobserved unit.

If the source commits an event and loses its response, retry the same event ID
and exact original intent. That retry retains the original admission, even after
expiry. If native import rolls back, the source event remains available for an
original-ID retry. A changed event under the same ID is an integrity conflict.

Core import requires the complete prior family sequence. Missing events and
correction parents must be imported first. An unavailable lookup writes nothing.
G03 does not resolve an unknown credential issuance: G02 must reconcile that
original issue before G03 may import its handoff evidence. Time alone advances
neither credential uncertainty nor accepted quantities.

## Authority and retained data

Only actual owner, operator or reviewer sessions with current operation and
resource permissions can use the new APIs. Import also checks current return
mapping, lifecycle and execution controls. The final source lookup and authority
checks occur before the native write, inside the same core transaction. Duplicate
imports are subject to the same checks. Customer and worker scopes cannot ingest
or read these operator observations.

Erasure, held erasure, uninstall and restore retire ingestion authority. Ordinary
erasure removes the personal request, case and item mapping while retaining
opaque unit/event identities and quantitative history. A current hold retains
required evidence; it does not preserve import authority. Current suppression
takes precedence over a hold copied in an older snapshot.

Retained reads require actual human privacy administration and original-resource
read permission. Minimized reads expose aggregate quantities and opaque unit
references without restoring item-line mappings. A current unsuppressed hold can
retain those mappings for the authorized privacy administrator. An issue without
imported G03 evidence cannot reconstruct expected quantities after G02 terms are minimized and reports
DROPOFF_HANDOFF_NOT_FOUND. Restore and merchant import validate original and
destination graphs independently and do not invoke the source or replay effects.

## Focused evidence and continuation

Reviewed product 2565443968c467e1c7f5db42c1f2e015cd592251 has complete passing
evidence for all forty-eight assigned cases on that exact clean candidate:

| Completed file | Passing cases |
|---|---:|
| Item-level handoff acceptance | 12 |
| Unchanged credential lifecycle | 14 |
| Unchanged partner services | 22 |

The first three-file invocation reached its shared sixty-second deadline after
the first twenty-six cases passed. That report remains failed; its interrupted
partner child receives no completed-case credit. A narrow continuation ran only
the remaining twenty-two partner cases. Defaults were unchanged, and no passing
G03 or G02 file was rerun. This is complete passing evidence across two
invocations, not one successful forty-eight-case batch.

The one isolated fault deliberately stored three accepted native units from one
source unit. Unchanged CASE03 first verified the provider's single unit and then
failed on the real native count, three instead of one. CASE02 separately detected
zero outstanding instead of two. Twelve fault cases executed, with three passes
and nine behavioral assertion failures; later assertions after each failure are
not credited. The broken branch remains isolated outside product ancestry.

Both independent nonauthor reviewers approved this bounded local scope. The
M20 work record and checkpoint evidence bind exact source hashes, the independent
author's fixture correction, raw reports, fault and review decisions. Closing
changes affect documentation only, preserving the executed runtime and tests.

The unchanged fixture does not provide an otherwise-valid above-one-hundred-unit
native positive control. The bounded implementation and malformed-input checks
must not be presented as physical-site or large-return qualification.

G04 remains a separate assignment for consolidation and custody continuity. It
can consume stable unit and event identities, with later physical stages still
requiring their own actual observations.
