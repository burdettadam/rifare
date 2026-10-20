# Durable synthetic loyalty redemption

The bounded local contract is assigned by [ADR-0060](decisions/0060-loyalty-redemption.md).
Implementation and evidence status are recorded in the
[milestone work record](../work/records/M19-loyalty-milestone.md). At the prior
assignment checkpoint, independent tests are being authored and no G03 runtime
result is claimed. This document describes the assigned behavior.

## What an approval means

A current human support owner obtains a quote for an exact number of points and
a named synthetic reward. The quote binds current customer proof, ownership,
source balance, redemption rules, benefit terms and configuration. A separate
human approver approves those precise terms through the existing ActionGateway.
The gateway consumes that approval and creates one durable reservation and one
original operation, together in the core transaction.

The preview and receipt state a point quantity and benefit. Neither contains a
monetary amount or currency. A points approval does not grant a charge, refund,
store credit, enrollment, customer message or autonomous worker permission.

The fixture starts with 1000 earned, 150 provider-reserved, 200 already redeemed
and 50 reversed points: 600 available. Its additional 900 pending points cannot
be spent. A primary reward costs 400 and another reward costs 200. These are
explicit invented provider terms, not qualified benefits from a live provider.

## Reservation and original identity

Two cases belonging to the same source account and customer share one capacity
calculation. A transaction serializes the check, approval consumption and new
reservation across core connections. Two concurrent 400-point reservations cannot
both consume a 600-point entitlement.

| State | Meaning | Permitted next step |
| --- | --- | --- |
| reserved | Approval consumed; quantity reserved; no provider call observed | Initial dispatch, or proven unsent release |
| unknown | The outcome may have occurred | Original-operation lookup |
| redeemed | Exact original debit and reward proved | Read or identical replay |
| rejected | Exact provider evidence proves rejection without a debit | Read or identical replay |
| released | A live reservation was proved never sent | Read or identical replay |

Before invoking the provider, dispatch durably records unknown. A separate core
write transaction then protects the final authority checks and synchronous source
call from another core connection changing approval or ownership between them.
The provider debit and source journal are atomic in their own separate database.
If the source commits but its acknowledgment is lost, the core remains unknown.
A later call looks up that same original operation; it does not redeem again.

The local reservation expires after ten seconds, bounded by all underlying terms.
Only a proven unsent live reservation can release. An unknown quantity survives
expiry, timeout, process restart, erasure and restore until exact source evidence
resolves the original outcome. A null lookup is not cancellation evidence.

## Available points and source evidence

For a before-effect timeout, the source still reports 600. The local 400-point
unknown hold leaves 200 available. Expiry or opening another case does not restore
the 400 points to capacity.

For a lost acknowledgment after a successful debit, the source reports 200 and
the local record still holds 400. Complete source history can prove that this
exact original debit is already reflected in that 200. The projection identifies
400 accounted held points and leaves 200 available; it does not subtract the same
debit a second time. The unknown record remains unknown until reconciliation.
An unverified journal or unexplained balance change supplies no such credit.

Source history starts from an immutable account anchor. Every later snapshot
must match an exact original-operation debit. A successful booking changes only
source revision, redeemed and available; it does not extend observation freshness
or rewrite earning/redemption rules. Rejection records a no-debit result. One
source transaction writes the snapshot and journal together and validates both.

This first fixture protocol deliberately refuses externally published post-anchor
balance refreshes for new spending. Historical lookup can still inspect the
original operation without requiring current benefit or quote freshness. Each
account journal is bounded to 1000 entries; overflow is explicit.

## Existing operations stay under their existing owners

The points operation uses the native action receipt, generic operation identity,
work, source target and operation receipt chain. The receipt remains discoverable
through the existing receipt-to-operation association. One durable quote can
bind to only one original operation.

Both native financial uncertainty checks recognize valid typed loyalty work as
a separate effect. An unknown points outcome does not block an otherwise
authorized worker refund. A malformed record or an action string alone cannot
claim that exception. Generic DurableWork, synthetic-record reconciliation and
generic reauthorization cannot change the points outcome.

The existing ExceptionQueue presents the original operation and its permitted
lookup action. No second inbox, worker scheduler or new financial ledger is added.

## Privacy and recovery

Customer-linked quote and operation context uses two strictly validated kinds in
the existing support-document table. There is one current row per identity, with
at most 1000 quote and 1000 operation records per store. Capacity limits apply to
admission; reconciliation and minimization can update existing records at the
limit. Economic state is separate from authority and personal-data retention.

Subject export, erasure and holds recognize retained subject identity even when
no current resource belongs to that customer. Erasure removes personal quote,
proof and case context, revokes issue authority and retains only the minimum
point quantity and original command/source linkage needed for unresolved effects.
Configured holds retain the required context while authority remains revoked.
Provider storage and older source files require their own retention treatment.

Historical holds also protect the original loyalty context when an order has
since moved to another customer. Eligible erasure minimizes only the affected
loyalty records and retires their own preview/approval copies, including when the
original customer has no current resources. It does not erase another customer's
current order merely because that order appears in historical quote terms.

Releasing an unsent reservation during erasure requires the configured native
source to confirm that no original booking exists. Without that source binding,
the record can be minimized and its authority revoked, but its points stay held.
That retained reserved state has no current reconciliation route; reconciliation
is for unknown outcomes. Restore converts copied reservations to unknown without
requiring provider availability.

An active-store human with privacy administration and original-resource operation
permissions can reconcile a minimized original operation. That narrow path does
not load erased customer content, renew proof, issue, retry or bypass worker
restrictions. A late source result adds only minimized outcome evidence. Native
uninstall disables the store and sessions; this contract adds no access bypass.

A restored reserved record becomes unknown before suppression or quote retirement.
A dispatch could have occurred after that snapshot was taken. Physical restore
and initial/repeated merchant import validate the original and destination rows,
retain holds, revoke old authority, replay current suppression and preserve a
previously reconciled destination outcome. Restored operations cannot dispatch.

Merchant re-export omits local replay fences. A fresh import reconstructs its own
fences before checking copied restored records; repeated import first validates
the existing destination and rejects a missing fence there.

The bounded audit chain also reserves room for completion. Optional customer
notes and corrections cannot consume the receipts needed for remaining native
transitions or for erasing outstanding notes. Other operation types retain their
existing receipt behavior.

## Verification and qualification boundary

The assigned focused batch contains 20 independently authored G03 cases, the 21
existing gateway cases and 17 existing privacy lifecycle cases. A separate exact
parent fault must incorrectly release a before-effect unknown while its source,
proof, rules and benefit remain current. The unchanged tests must detect the
resulting double-spending opportunity behaviorally.

Actual results, source identities, preserved inventories, the isolated fault and
both independent decisions belong in the milestone work record and evidence.
This synthetic local contract does not qualify a merchant-owned loyalty provider,
formal M19 dependencies, production operation, connected messaging, target-host
behavior or the full applicable regression gate. G04 incentive handling, G05
lifecycle reporting and G99 assessment remain separately assigned work.
