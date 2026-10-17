# Exchange history operations

Scope: M06-G06–G10, local synthetic implementation under ADR-0029. The staff page
is `/exchange-history`; existing approval happens at `/execution`. A source
record, quote, local receipt and settled provider effect are distinct stages.
Only the local synthetic stages described here have been implemented and tested.

## Operator workflow

1. Use a scoped staff session. The page holds the token only in memory and clears
   results whenever its session or relevant inputs change.
2. For a delivered replacement, materialize its original operation ID or read an
   existing lineage node. Read the carried paid value and funding history before
   opening its next return. An unknown transfer requires original-operation
   reconciliation.
3. For a qualified original-money refund, bind/read the allocation. Compare both
   shop and presentment amounts and the original conversion reference. Current
   rates cannot reprice the original paid units.
4. Import fee estimate/final events by native event ID. Final observations retain
   their estimate and exact paired difference. Changed unsent terms need a new
   preview/approval. A difference after authorization, settlement or closure
   remains attached to the original operation for review; it authorizes no new
   charge or refund. Observation remains possible after issuance qualification
   expires, while fresh financial binding/issue stays blocked. A final at or above
   original paid value in either currency remains a visible manual review
   obligation, blocks closure, and cannot create a negative refund.
5. For an instant exchange, prepare an authorization quote using an existing
   source consent tied to the exact exchange and bounded terms. Follow the
   existing separate reviewer approval, then dispatch the approved operation ID.
   Later capture, cancellation or reauthorization also needs its own exact quote
   and approval. A card identifier is not a customer agreement.

The interface summarizes business amounts/stages and retains the complete source
response in expandable details. The browser cases use the actual loopback HTTP
service, compare the displayed values to its response, and exercise changed-input
and late-response reset. Rendering alone is not financial or physical evidence.

## Instant exchange and closure

The native mandate source binds to a real separate fulfillment fixture. It
reserves the exact obligation before stock release, and confirms release only by
reading the committed native replacement and reservation. Merely supplying a
success-shaped result cannot confirm a release or permit nonreturn capture.

After the trial deadline, current native unreturned original units determine a
single bounded capture within an unexpired mandate. Receipt and capture contend
in one native transaction. A receipt first reduces collectible value. A capture
first is retained, and a later receipt creates a bounded compensation obligation;
it does not pretend the earlier effect vanished. Expiry requires fresh source
consent and separately approved reauthorization. A timeout reconciles the original
operation, including after process restart.

Ordinary cancellation and workflow status include retained lineage, fees and
instant history. An active unused mandate must first be canceled through its own
approved operation. Uncertain stock release/capture, late compensation, final-fee
discrepancy or unknown lineage import prevents ordinary closure. Status retains
late obligations even after an earlier closure. Compensation is a visible review
obligation; this batch does not automatically issue a compensating live refund.

## HTTP surface

All routes below use POST and the existing authenticated tenant/store scope.
Their exact input schemas are enforced by the modules. Native fixture seed,
consent, fee creation and physical delivery administration have no HTTP routes.

| Route prefix | Operations |
| --- | --- |
| `/v1/exchange-lineage/` | `materialize`, `node` |
| `/v1/exchange-money/` | `bind`, `currency`, `refresh-fee`, `fees` |
| `/v1/instant-exchanges/` | `configure`, `authorize-quote`, `reauthorize-quote`, `capture-quote`, `cancel-quote`, `binding`, `operation`, `dispatch`, `reconcile` |

Module routes require an explicitly supplied matching source. The server records
sanitized status/error codes, not request bodies, bearer tokens or customer
agreement material. UI uses text nodes, fixed same-origin endpoints, in-memory
requests and stale-result invalidation; it does not persist session credentials.

## Supported boundary

Paired currency support qualifies only synthetic source-bound original-allocation
refunds; it does not qualify paired-money replacements, additional payments or
foreign-currency credit. Instant support is the independently qualified fixture
account and its exact currency/terms/consent. It does not prove reusable mandates
for a real processor, legal agreement, native physical receipt or connected
financial stage. Existing owed additional payment still requires its own settled
operation before replacement release.

M03-G99, M04-G99, M05-G99 and the named financial dependency acceptance remain
unmet. No account, scope, endpoint, budget or merchant/provider attestation is
invented. No G11 scheduling, deployment, release or provider action is included.
See `EXCHANGE-LINEAGE.md`, `exchange-money.md` and `INSTANT-EXCHANGES.md` for
precise contracts and recovery constraints.
