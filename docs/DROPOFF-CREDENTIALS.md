# Drop-off credential lifecycle

## Assigned local boundary

[ADR-0063](decisions/0063-dropoff-credential-lifecycle.md) assigns the next local
M20 increment after [eligibility discovery](DROPOFF-ELIGIBILITY.md). The assignment
composes the original return and qualified method with native human approval,
durable original operation IDs and a separate synthetic provider journal.
Implementation and evidence status are recorded in
[the M20 work record](../work/records/M20-dropoff-milestone.md).

Issuing a credential establishes only a provider credential under the declared
synthetic contract. It does not establish an accepted item, physical handoff,
custody, receipt, inspection, stock movement, collected fee or settlement.
Connected-provider and physical qualification remain open.

## Human workflow

1. The current human support owner obtains current G01 choices for the complete
   original return. Item-level eligibility and complete-return eligibility must
   both permit the explicit site/destination/method combination.
2. `DropoffCredentials.quote` saves the exact choice, items, separate fees,
   original owner/proof/source and expiry terms. The caller cannot supply another
   customer, arbitrary item subset, provider identity or expiry.
3. Native `ActionGateway.prepare`, a distinct human's `approve`, and the original
   owner's `execute` consume one approval and create one durable operation.
   These steps do not issue a provider credential.
4. The dedicated owner dispatches that original operation after rechecking current
   authority and unchanged terms. It records uncertainty before contacting the
   synthetic provider, so a lost response cannot erase the operation's identity.
5. Authorized protected delivery returns the original payload only while the
   provider credential is usable. Ordinary reads, receipts, lookup and exports
   contain metadata only.

The independent reviewer uses a narrow canonical review path. It recomputes the
original owner's current terms while checking the actual reviewer's permission;
it does not impersonate that owner or take over the support case.

## Outcome and usability are separate

| Record | States | Meaning |
|---|---|---|
| Issue operation | authorized, unknown, issued, rejected, cancelled | Outcome of one exact original provider request |
| Revoke operation | authorized, unknown, revoked, rejected, cancelled | Outcome of one exact original provider revocation request |
| Issued credential | active, expired, revoked; optional replacement reference | Current provider usability of the original credential |

An issuance that succeeded stays `issued` in history after its credential expires.
Expiry does not turn a successful issue into a failed request. An unknown request
stays unknown when lookup is absent or unavailable; elapsed time, a missing key
or a changed directory cannot prove that issuance never occurred.

The synthetic approval/dispatch window is at most five seconds, further bounded
by original G01/proof freshness. Credential validity is twenty seconds from quote
creation. These short fixture intervals make the two rules observable: delivery
may succeed after its consumed approval expires, and replacement still requires
an authoritative terminal credential state.

## Revocation, replacement and recovery

Revocation has its own quote, independent approval and original operation ID.
Requesting it does not mark the credential revoked. A lost revocation response
must be reconciled before delivery or replacement can continue.

Replacement is a fresh issue naming the exact prior issued operation. It requires
a known original issuance, a current authoritative expired or revoked status,
no unresolved request in the return's credential lineage, and a fresh approval.
Both core and provider independently enforce the lineage rule. The provider
updates predecessor and generation metadata atomically.

Original-ID reconciliation is lookup-only. It never repeats an issue/revoke
command, reauthenticates the customer, refreshes a quote or creates a new identity.
Historical lookup remains available under the appropriate current operation
permissions when current eligibility changes. Retained privacy/recovery lookup
also requires actual human privacy authority and the original resource permission.

Core restoration and merchant import revoke copied issuance/delivery authority
before generic cleanup. Copied unsent operations become uncertain, since the
independent provider journal may be ahead of the core snapshot. Old approvals
cannot authorize replay. Generic dispatch, retry, reconciliation and reauthorization
do not own these operations.

## Payload protection and privacy

The provider fixture stores the payload as AES-256-GCM ciphertext using an injected
keyring kept outside the database/export. Authenticated metadata binds the exact
command, operation, scope, source, credential identity, kind and expiry. Loss of
the wrapping key or failed authentication blocks delivery without changing the
historical issue outcome or permitting replacement.

Core quotes retain exact original terms; immutable provider commands retain only
the necessary opaque lineage and item/term digests. Subject lifecycle retires
personal quote/preview copies and access authority while preserving minimized
original operation evidence and unresolved fences.

A hold preserves required evidence. An erasure request blocked by a hold still
disables credential issuance/delivery and revokes approvals. Creating a hold by
itself does not alter current authority.

Source cleanup is explicit: `not_requested`, `pending` or `forgotten`. Core
revocation/minimization can complete with a detached provider; the status remains
pending until the exact source confirms removal of its encrypted delivery copy.
This local forgetting does not claim provider revocation, deletion of an already
delivered copy or physical-media erasure.

Suppression resolves both the historical resource and the current linked-case
resource. Repeated erasure reuses persisted resource markers after current
ownership rows have been redacted. An exact historical quote can be normalized
only under actual suppression and complete graph validation; ordinary active
record validation remains strict. Restore/import preserve current suppression
even when the historical subject has an evidentiary hold.

Denied gateway receipt reads and approval revocations cannot refresh the original
customer proof. Native transaction rollback covers those rejected calls.

## Verification boundary

The reviewed product is 7e460fcc625d88a0f1b3d14ea771e97e0aa2f033. Its final clean
run passed all fourteen independent credential cases, twelve unchanged G01 cases,
eighteen native approval cases and fourteen exception-queue cases: 58 passes in
37.990 seconds, within the unchanged four-file/sixty-second focused budget.
There were no failures, errors, skips or timeouts. Earlier concrete failures and
their corrections are retained in the work record and native evidence. This
selection does not establish a full regression or connected qualification.

The isolated exact-parent fault 6cb9bdcc1e7a973dd3e7cad625a859398b489efd removes
only the core and provider family guards. Its unchanged fourteen-case run has
eleven passes and three behavioral failures in 22.040 seconds. CASE03 directly
observes two native credential rows where one was required after lost issuance
acknowledgment. The fault is retained separately and never integrated. Assertions
after each first failure are not counted as additional fault coverage.

Later M20 work must connect item acceptance and custody progression through the
existing native warehouse and reverse-hub owners. Actual partner terms, physical
handoff, customer delivery/accessibility and every financial trigger require
their own qualification evidence.
