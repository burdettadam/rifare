# Rifare return receiving and completion

## Supported diagnostic surface

M03-G16 through M03-G21 extend the existing return lifecycle. SQLite application,
financial, inventory/carrier, warehouse, and native-change fixture databases remain
separate. None is a production integration. Every model and agent uses the same
case pins, permissions, original-value accounting, approvals, and execution stops.

### Receiving (M03-G16)

Open an expected-items session from an established native-return record. Submit
unique scan IDs and an expected session revision. Each scan records observed
variant, quantity, grade, and optional clean evidence references. Replaying an
identical scan returns the original state; conflicting content or stale revisions
are rejected. The transaction includes physical units, immutable scan history and
session revision. Wrong and excess units remain evidence, not eligible inventory.
Partial, empty, unknown-condition, or mismatched returns block new monetary
resolution after receiving starts. A different authorized reviewer may acknowledge
a fully received damaged return, but cannot turn missing/wrong units into receipt.
Carrier delivery does not create a warehouse receipt or restock anything.

### Explicit disposition (M03-G17)

Restock, quarantine, disposal and supplier-return disposition require an exact
preview and a different authorized approver. Each matched physical unit can have
one disposition. Only sellable units can increase stock, at the pinned location;
the other dispositions have zero sellable-stock delta. Operation identity, source
identity, grades, quantity and location are rechecked. The source records the
adjustment and unit claim together. Lost responses become unknown; a new process
looks up the original result rather than incrementing inventory again. Cleanup
must retain the source ledger and original operation identity.

### Cancellation and expiry (M03-G18)

Cancellation closes remaining *local* obligations, not the platform's native
return object. It records an approved terminal state and a unique notification
intent (not delivered). Completed refunds, credit, replacements and receipts remain
unchanged. Fresh operator authority can expire an unused request using the
server-derived cutoff; customer proof is not reused to authorize money. Eligible
reservations need source-confirmed release. Unknown or created replacements block
release. Labels need their own existing void approval; confirmation, pending
reimbursement and actual reimbursement remain separate. Late physical receipt may
still be recorded for an already closed request, without enabling new execution.

### Portable workflows and manual UI (M03-G19 / M03-G20)

`handle-return` and `handle-exchange` are instruction-only version-2 bundles.
Install through the existing exact-origin/digest approval. A request pins the
bundle and case configuration. Changing the agent does not reselect a policy or
allocate stock. `ReturnWorkflowRunner` and the separate standard-library Python
client consume the same structured records. The client verifies resource and
bundle digests and recomputes the structured source digest. Guidance is not a
settlement or shipment oracle. No model is required for canonical quotations.

The `/return-operations` screen resumes the request, shows independent stages and
requests quotations. It uses memory-only credentials and text rendering, clears
stale responses and needs separate approval through the existing interface/API.
It does not present a one-click complete/refund button. The return-specific source
records do not require a provider thread or proprietary agent checkpoint.

### Native changes (M03-G21)

A separately configured read-only fixture feed reports native returns, refunds,
replacements and receipt/disposition observations. Source identity, account,
resource, original payment/currency, monotonic versions, timestamps and historical
records are checked. Original paid totals bound external refunds. Confirmed unit
outcomes and observed refunded amounts reduce remaining local entitlement. Missing
or changed native records invalidate pending work. A local unknown refund still
requires reconciliation against its original source; an unrelated feed cannot
assert its settlement. Receipt disposition may advance from unassigned to one
recorded disposition but cannot be rewritten. Delayed snapshots cannot undo it.
The adapter has no production HTTP transport; it never modifies the native store.

## Run

```sh
npm ci --offline --ignore-scripts
python3 tools/verify.py --runtime --harness
node --experimental-strip-types tools/demo-return-completion.mts
node --experimental-strip-types tools/demo-return-completion.mts --serve
```

The headless demonstration uses no credentials and makes no external calls. It
receives a damaged mixed return, obtains separate review, settles a synthetic
refund, issues synthetic credit, creates (not ships) a replacement, restocks only
sellable units, and cancels the remaining local work while retaining history.

The server prints a loopback `/return-operations` address and a private temporary
session-file path. The file includes operator/reviewer tokens, request ID, catalog
ID and approved skill hashes. Tokens are not embedded in the page or printed. Use
the return or exchange hash matching the selected workflow. Ctrl-C stops only
that instance and removes its temporary credential file. Source archives contain
neither this file nor databases. The separate client takes JSON on stdin as
shown in `examples/clients/return-workflow-client.py`; do not put credentials in
shell history. The default development server does not configure warehouse/native
sources. No browser/API request can select an arbitrary source or inject approval.

## Storage, privacy and recovery

Migration 017 is additive and checksummed. Export includes subject-attributed
receiving, closure, disposition, workflow and native-change records. Logical
erasure scrubs new quotation bodies and disables subject access/authority. Physical
unit histories and minimized audit/payment/source identifiers remain subject to
retention policy; this is not forensic erasure or legal certification. External
sources, outboxes and older backups need separately governed cleanup. Restore only
through the existing quarantine/erasure-checkpoint mechanism and retain every
source identity and uncertain operation. Never restore a backup as a new source
and replay unconfirmed adjustments.

## Qualification and limits

Tested Linux diagnostic scope only. PostgreSQL/React, real Shopify/warehouse/
carrier/payment sources, actual hardware scans, shipping/settlement guarantees,
independent merchant validation and direct served-browser qualification remain
open. Browser-component tests explicitly bridge rendered controls to the real
local API; they are not a claim of an end-to-end production browser deployment.
Wrong-item recovery requires a later reviewed correction workflow; immutable scans
cannot be edited to make counts agree. Cancellation does not reopen claims or
retroactively undo financial/physical effects. Full M03 acceptance remains blocked;
read [the milestone assessment](M03-QUALIFICATION.md) and
[maintainer review](RETURN-COMPLETION-REVIEW.md).
