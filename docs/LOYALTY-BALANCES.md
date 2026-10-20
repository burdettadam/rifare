# Current loyalty balances and rules

M19-G01 adds a scoped read and quotation foundation for later loyalty work.
The source implementation is a disposable synthetic provider fixture. Actual
provider integration, accrual, reservation, redemption and reversal execution
remain separate goals and qualification obligations.

## What a caller can inspect

`LoyaltyBalances.context(scope, customerProof, input)` returns the current
customer's source snapshot through an existing support case and verified link.
The input contains `case_id`, `link_id` and `expected_generation`. A customer
supplies their current verified proof; a staff or agent caller additionally
must own the current support generation and retain existing read permissions.

Available snapshots identify merchant/store, provider connection account,
customer, source identity/contract/revision, observation and expiry, rules version,
and explicit provider capabilities. Pending, earned, reserved, redeemed, reversed
and available points retain separate fields. Pending points cannot be spent.
Integer arithmetic verifies that available equals earned minus reservations,
redemptions and reversals. Points never become a monetary or store-credit balance.

| State | Meaning |
| --- | --- |
| `available` | A complete, structurally valid, current synthetic source snapshot. |
| `needs_configuration` | No source is attached to this service. |
| `unavailable` | The source has no snapshot for this customer. |
| `incomplete` | The source explicitly reports incomplete information. |
| `stale` | Observation time, snapshot expiry or rules expiry prevents use. |
| `unverified` | The returned source content fails integrity or semantic validation. |

Only available context includes a snapshot and snapshot digest. Current caller,
proof, customer, source-scope or ownership violations reject the request. The
service never turns those authorization failures into a permitted empty read.
Reads preserve the source's observation time. A refreshed UI is not new evidence.

## Quote points without spending them

`quote(scope, customerProof, input)` adds `points`, `unit: "points"` and the exact
`snapshot_digest` to the context fields. The service rereads current facts and
checks the digest, provider capabilities, available amount and versioned minimum,
maximum and increment rules. A stale or changed snapshot produces an ineligible
quote with a reason and no usable terms.

An eligible result contains the precise account/source/rules versions, points
and expiry used for the comparison. Its flags explicitly retain
`execution_authorized: false`, `enrollment_authorized: false`,
`send_authorized: false` and `monetary_conversion_supported: false`.
Eligibility is information for a later approved workflow. This service has no
reservation, redemption, enrollment, discount, checkout or send method.

The `full` fixture declares read, accrue, reserve, redeem, reverse and lookup
capabilities. The `limited` fixture lacks reservation and reversal. Its missing
reservation prevents an eligible redemption quote; both limitations stay visible.
These declarations describe synthetic source semantics. They do not claim that
a corresponding commerce effect handler or external provider is qualified.

## Existing support dispatcher

`SupportService` accepts an optional native `LoyaltyBalances` owner from the same
kernel. Without one, its loyalty owner reports a configuration requirement.
The additive `loyalty-context` and `loyalty-quote` actions accept exactly
`{ customer_token, input }` and authenticate the token before invoking the same
service. Existing support actions retain their owners and behavior. No worker
grant, permission list or HTTP route is expanded.

## Fixture source and isolation

`LoyaltyFixtureSource` accepts a separate SQLite database and exact configuration
`{ tenant_id, store_id, account_id, provider }`. `account_id` identifies the
provider connection; each snapshot separately binds its customer.

The constructor rejects a commerce database before creating any fixture table.
Service attachment additionally checks physical database identity, including
different handles and filesystem aliases. Source identity is retained durably and
checked during reads and fixture publication. A reopened database cannot be
silently relabeled as another tenant, store, account or provider.

Fixture-only `publish` stores immutable versioned snapshots in an atomic
transaction. Identical publication of the current version is idempotent.
Conflicting/decreasing revisions and changed rules under an unchanged rules
revision are rejected. `observe` reads the latest version without inventing a
new timestamp. Every service access revalidates the returned envelope.

## Privacy, recovery and limits

The core stores no new customer-linked loyalty record, snapshot, quote or cache.
Context exists only in the current response. Native session activity and security
denial records keep their existing behavior. Current erasure, uninstall, support
takeover, revoked proofs and restored-database quarantine prevent renewed access.
Older returned digests cannot authorize a new read or effect.

The separate fixture contains invented development data and is disposed by its
test owner. Rifare erasure does not claim provider-side deletion or revocation of
bytes already returned to a caller. Adding persistent customer mappings or points
operations later requires explicit export, erasure, hold, uninstall and restore
coverage from the first implementation.

The original M19 goals remain the formal specification. M07/M09 qualification,
actual merchant/provider observations and target-host qualification are open.
The current work record records actual local verification and reviewer decisions;
this guide is not an acceptance ledger.

## Continue development

G02 should derive accrual and reversal proposals from the existing original paid
unit allocations, settled financial observations and funded exchange lineage.
G03 needs a separately designed durable points operation/reservation journal:
unknown outcomes must keep their original identity and encumbered points until
authoritative reconciliation. G04 can then compare current loyalty terms with
existing approved offers and reuse the final-send checks. Existing financial,
consent and messaging owners remain authoritative throughout.
