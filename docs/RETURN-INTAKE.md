# Item-level returns and controlled native records

M03-G01 through M03-G05 add local diagnostic behavior. M02-G99 remains blocked
for production qualification; ADR-0021 permits bounded implementation and local
integration under delegated authority. There is no new model, service or dependency.

## Start and demonstrate

```sh
npm ci --offline --ignore-scripts
python3 tools/verify.py --runtime --harness
node --experimental-strip-types tools/demo-returns.mts
node --experimental-strip-types tools/demo-returns.mts --serve
```

The headless command uses two stores and two separate in-memory SQLite databases.
It subtracts fulfilled/previously returned quantities, calculates an exact estimate,
requires separate approval, records the local request, deliberately loses the native
fixture response, and confirms the original source record without creating again.
The shorter-window store requires review. No money, message or shipment moves.

The served command prints `/returns` and a private temporary session-file path.
Use `customer` with case `return_case`; `operator` and `reviewer` are separate
server roles. Tokens are not printed or embedded in the page. Ctrl-C stops this
instance and removes its private session file. Default startup enables no scanner
or native transport. A verified diagnostic session is entered manually; a branded
email/magic-link delivery journey is not implemented here.

## G01: immutable item eligibility and fee estimates

`return-eligibility.mts` is a pure structured evaluator. Source line identities,
fulfilled counts and previously returned counts are server input. Available units
subtract committed local reservations until authoritative source synchronization
explicitly incorporates their linked native return IDs. Ordered-but-unfulfilled
units are unavailable. Uncertain native requests continue reserving units.

Policies supply outcomes, exclusions, evidence requirements and an inclusive
elapsed-time cutoff. Comparison uses UTC instants; the configured IANA timezone
is validated and retained. These are elapsed 24-hour days, not an implicit local
midnight or daylight-saving calendar rule. The cutoff tick is eligible; the next
millisecond requires review. Source quantity inconsistencies are rejected.

Estimates use integer minor units, currency exponents, bounded restocking basis
points rounded down, and an explicit shipping estimate. Item value less fees is
not a payment instruction. Taxes, discounted bundle allocations, native checkout
fees, foreign exchange and financial settlement are not qualified. Changed source,
configuration, evidence, reservations or review state invalidates earlier previews.

## G02: evidence and privacy

Only a bounded, metadata-free subset of PNG is accepted: RGB/RGBA, eight-bit,
noninterlaced, maximum 256 KiB and four million pixels. CRC, chunk order, decompressed
length, scanline filters and complete consumption of the compressed stream are
checked. Other types, ancillary chunks, trailing bytes and malformed payloads are
rejected. This intentionally excludes many ordinary phone images and is not a
replacement for a qualified image decoder or malware service.

Uploads begin quarantined. A server-owned scanner must return the exact content
hash before an authorized reviewer can mark them clean; none is configured by
default. The call has a two-second deadline; timeout/unavailability does not clear
the quarantine. An injected scanner is trusted in-process code, not a sandbox.
Tests use a synthetic hash-verdict scanner and do not claim malware detection.

Clean content requires a 60-second signed grant bound to the current customer or
operator session, evidence ID and content hash. It is served as an attachment with
no-sniff/sandbox headers, never as HTML or model input. Expired/erased/revoked access
fails despite an old grant. Notes remain untrusted data. Eight non-erased objects
per case and byte/decompression limits bound storage input.

Retention is owner-configured from one to 90 days. Expiry immediately denies reads.
`ReturnEvidence.purgeExpired(ownerScope)` deletes expired BLOBs and notes in batches
of at most 100, respecting active customer retention holds. Follow `next_cursor`
with `purgeExpired(ownerScope, next_cursor)` when returned; `held` counts retained
objects, not deletions. A zero deletion count is not proof that held records were
erased. Direct deletion also reports held without deleting bytes. Resume a fresh
scan after authorized hold release or expiry. It adds no scheduler. The existing customer-erasure operation also
scrubs linked quotes, requests and evidence. These are logical deletions, not
forensic erasure of journals, exports or backups. Storage inventory includes every
new table before privacy and restore operations are permitted.

## G03: customer flow and canonical endpoints

The keyboard-accessible narrow-screen page uses the existing verified order session.
It loads per-item remaining quantities, accepts bounded reasons/notes/photos, shows
server-calculated fees, records explicit review of the estimate and submits one
stable request. Status remains available through another caller. No token is stored
in browser storage. Session or item changes invalidate delayed results. Currency
formatting preserves JPY and three-decimal units without floating-point conversion.

`POST /v1/returns/` routes are `form`, `quote`, `prepare`, `revise`, and `status`.
`configure` requires owner configuration authority. The typed contract is
[return-intake.v1.json](../packages/commerce/contracts/return-intake.v1.json).
These endpoints contain no provider-thread state and can be called by any authorized
client. Existing case/skill/profile pins remain enforced; a new agent is not granted
additional actions. The earlier simple return-draft skill is not silently replaced.

Preparing creates an awaiting-review request and gateway preview, not an approved
native return. Customer callers cannot approve or execute. Revising an unapproved
request preserves its ID, revokes old approvals and requires the exact previous
preview. A repeated original request resolves to its existing record; a conflicting
intent cannot masquerade as a retry. Submitted requests cannot be silently revised.

## G04: evidence requests and bounded reviewer overrides

Reviewers use `review/evidence`, `review/resolve-evidence`, `review/override` and
`review/revoke`. They must hold current permission and differ from the quote author.
An evidence request invalidates old approvals and blocks native submission as well.
Resolving it requires a fresh quote with the requested description or clean photo.
The customer then re-quotes/revises and receives a separately approved preview.

The only exception is a bounded return-window extension (zero to seven days)
with one enumerated reason and an exact quote digest. It cannot waive quantity,
exclusion, evidence, customer identity, permissions or financial controls. Revoked,
expired or demoted reviewer authority invalidates its use. Timeline and original
reasons remain available; arbitrary customer prose cannot manufacture an override.

## G05: native records, not refunds

`ShopifyReturnFixtureAdapter` describes the 2026-10 `returnCreate` and return-query
shapes. It has no default fetch client and rejects live mode. Server-owned injected
fixtures are the only tested transport. It compares order, fulfillment-line identity,
quantity, request-correlation note, complete pagination and reverse-fulfillment IDs.
An incomplete or mismatched response remains unknown, never a presumed refund.

`NativeReturns.create` requires a committed approved local request, current owner/
reviewer authority, fresh source/configuration and enabled execution. It durably
records uncertainty before calling the non-idempotent mutation. Repeated calls and
process restart cannot issue another create. Reconciliation reads an explicitly
identified native return from the same source and checks every line. Read-only
reconciliation can continue after the original customer proof expires; it does not
reuse that proof to authorize a new write. Missing native identity requires manual
source investigation. There is no invented provider idempotency parameter.

No actual Shopify account, development-store result, carrier label, refund, exchange
shipment, fee charge or payment settlement has been qualified. Native creation has
no public HTTP endpoint or default demo-server provider. The simulated action names
`diagnostic.return.submit` and `diagnostic.return.create` do not qualify live actions.

Primary references assessed October 16, 2026:
- Shopify returnCreate: https://shopify.dev/docs/api/admin-graphql/2026-10/mutations/returnCreate
- Shopify ReturnInput: https://shopify.dev/docs/api/admin-graphql/2026-10/input-objects/ReturnInput
- OWASP upload guidance: https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html

## Verification, rollback and remaining qualification

New tests retain the original fifteen CASE IDs across five goals. They use pure
fixtures, actual SQLite stores, real loopback HTTP, concurrent requests, reopened
databases and rendered components with an explicit local API bridge. Component
checks are not direct served-browser, React, accessibility-audit or live-store proof.
PostgreSQL/React and prior milestone gaps remain open. Run the full accumulated
suite, not only these tests. Native error/unknown cases never authorize blind retry.

Keep migration 014 with the accumulated source. To disable the feature, stop the
submission/create actions and stop serving the new entry point; retain records for
read-only investigation. Do not remove the migration, downgrade the schema or
rewrite previous approvals to force an operation. Restoration remains quarantined.
