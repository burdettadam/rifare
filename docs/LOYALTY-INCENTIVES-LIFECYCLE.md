# Rifare local loyalty incentives and lifecycle

## Scope and state

ADR-0061's M19-G04 and M19-G05 bounded local synthetic increment is implemented
at product 10b1f763c3289dfc13f3244dadcdd98a51a5f49d, tree
36674997c3c35239a3707bb46eda7108ed6d441e. The preceding G01 balance/rule, G02
original-unit proposal and G03 durable redemption owners remain canonical.
The work record and exact-candidate evidence record the execution and review.
Both independent nonauthor reviewers approved this exact product for the
assigned local scope, with no remaining material authority/privacy or regression
blocker.
Formal M19, connected/provider qualification and production acceptance remain open.

## Incentive comparison

`LoyaltyIncentiveFixtureSource` combines the exact native marketing, shopping and
redemption source handles. Its customer-free applicability declaration lives in
the separate marketing database. All three source databases are physically
separate from each other and the core, and durable source identities are checked
again whenever configuration is read or changed. Every source receives the
fixture-only preflight before the wrapper can create configuration storage.
A declaration authorizes an
explicit benefit/offer pair and its eligible variant list. Every cart item must
appear in that pair's list; unrelated allowlists cannot authorize combinations.

`LoyaltyIncentives.quote` requires an actual human support owner, current customer
proof, current resource permissions, a committed active native cart, unchanged
cart terms, a scheduled approved campaign, explicit applicability and marketing
consent. It creates one ordinary G03 quote inside the same core transaction as
the comparison. Failure rolls back that terms record. No operation, approval,
reservation, redemption, enrollment, experiment membership or message is created.

The result compares native point cost and benefit with the native approved
discount wording, currency, minor-unit amount and catalog reference. It includes
the unchanged eligible cart items, exact source digests and fixed expiry. The
independent fixture compares a 400-point synthetic reward with a USD 500-minor
discount on a USD 2000-minor cart. No points-to-money conversion, prospective
earning promise, extra discount arithmetic or implied entitlement is supplied.

The comparison retains the original G03 creation time and maximum ten-second
lifetime, shortened by campaign, approval, source offer or applicability expiry.
`validate` reads that original durable quote and uses the existing G03 gateway
validator. It rechecks current capacity and all original terms without creating
a replacement quote or renewing customer-proof activity. Consumed, revoked,
minimized or expired quotes fail, including a quote already used for redemption.
Available and held balances are current validation inputs, not immutable claims
copied into the comparison.

## Recovery and actual send

`bind` attaches a validated comparison to one proposed native cart recovery
before its campaign recipient has any message operation. Exact replay is safe;
a different comparison cannot replace the binding. This is a deliberate local
availability limit: expiry does not silently refresh or replace an offer.

`GrowthCampaigns.approvedOffer` shares its original scoped approval, source and
recipient checks with rendering. It does not render a send or assign experiment
membership. Ordinary campaign output, permissions and source digests remain
unchanged. `CartRecovery.final` requires the exact attached native incentive owner
whenever a loyalty field is present, including a malformed field. The owner
revalidates the persisted comparison before campaign rendering returns its
source digest. Validation is anchored to the selected native recovery row and
its exact case, cart, campaign, resource and customer bindings; changing a body
ID cannot redirect validation to a different valid recovery. Missing
configuration fails closed.

The unchanged `SupportDelivery` final boundary compares the queued source digest
and checks current consent, contact, sender, ownership and controls before the
source send. A changed balance, cart purchase, consent or original proof can
suppress the queued message. There is no alternate loyalty sender. Bound loyalty
sends require an actual human caller in this increment; ordinary campaign worker
behavior is unchanged. Selecting terms is never permission to send or redeem.

## Lifecycle report

`LoyaltyLifecycle.report` composes the exact same-kernel G01/G02/G03 owners and
optional native campaign measurement owner. It requires a current human support
owner, current verified customer proof, support analytics and original-resource
permissions. It produces a transient report without reconciliation or source
effects. Account totals and capacity must share a snapshot digest; the complete
redemption source view is rechecked before return. Changed views are rejected.
Native unsupported-provider errors remain errors rather than zero capacity.

The report keeps these evidence scopes distinct:

| Section | Evidence and meaning |
| --- | --- |
| Account | Current provider-account balances and G03 effective capacity, including unresolved local holds. |
| Projection | Unchanged G02 original-order/unit accrual and reversal targets with their native financial IDs. |
| Redemptions | Strict original-resource/account operation projections and exact original-ID source observations, including a booking whose core state is still unknown. |
| Exceptions | Missing attributed award and reversal evidence, non-ready projection reasons, and outstanding reserved/unknown operations. |
| Economics | Point targets and observed redemption quantities; unproved issuance, reversal attribution, reward cost, monetary liability and loyalty-inclusive margin remain null. |
| Recovery | Unchanged native campaign summary and measurement report, preserving denominators, coverage, cost distinctions and attribution qualifications. |
| Exception queue | Existing filtered operation items with its original scan/truncation flags; this is not a complete ledger or proof of absence. |

A USD 3000-minor original purchase and a settled USD 1000-minor unit refund can
produce G02 targets of 300 earned, 100 reversal and 200 net points. Those targets
are separate from the fixture account's 1000 earned points and a native
400-point redemption. A financial refund never proves that the loyalty provider
issued or reversed this purchase's points. This source protocol has no attributed
award/reversal journal, so the report remains `needs_reconciliation` and
`reconciled=false` with both evidence gaps visible.

Requested campaign and experiment IDs must match the current case's native
recipient, the campaign's declared experiment and the exact existing assignment.
Missing measurement configuration is an error when measurement was requested.
The report does not create membership or recompute existing measurement metrics.
Original unknown redemption correction remains `ExceptionQueue.reconcile` or the
native G03 original-ID lookup, never a report side effect or repeated command.

Strict G03 records retain the existing 1000-record bound. The final canonical
report also has the existing 131072-byte JSON bound; oversized output is rejected
rather than silently truncated or reported complete. There is no report cache.

## Privacy and retained evidence

The original G03 quote is the sole durable proof-bearing loyalty record. The
recovery stores only the public comparison and digest, without raw tokens,
session hashes, customer proof hashes or copied customer identity. Existing
marketing minimization removes the binding; restore cancels recoveries and
revokes campaign approvals while G03 independently revokes its quote. Current
suppression prevents an old copied binding from returning to active authority.

`retained` accepts one to 100 distinct IDs of already-minimized G03 operations.
It requires actual human analytics, privacy and original-resource permissions
and returns only the unchanged retained operation projections. Live rows fail
`LOYALTY_RETAINED_EVIDENCE_REQUIRED`. It performs no current customer, G01, G02
or provider lookup. Account, projection and recovery are null; reconciliation and
execution remain false. Its analytics permission can deny during recovery
quarantine even where direct G03 retained reads remain permitted.

Provider databases, caller-held results and old exports/backups are separate
retention boundaries. The source anchor still refuses unexplained later balance
publications for new spending. The existing no-source privacy cleanup can retain
a revoked unsent reservation without an administrative release route. This
increment does not remove either conservative limitation.

## Optional support routes and evidence

SupportService accepts optional native `loyaltyIncentives` and `loyaltyLifecycle`
owners. Quote/report routes use the existing `{customer_token,input}` wrapper;
bind, validate and retained routes pass their strict native inputs. No route
configures a source or grants permissions implicitly.

The exact clean product passed all 38 selected native cases in 16.494 seconds:
14 new independent cases and all 24 unchanged marketing cases. One earlier
candidate failed an old mutation helper's exact source marker. The product was
restructured to preserve that marker and its assertion; the old test was not
changed. Independent review also produced the selected-row binding and
pre-write source-preflight corrections, with strengthened independent cases.

One isolated fault on immediate parent 10b1f763 ran the same 14 new cases in
9.936 seconds: eight passed and six failed behaviorally. G04-03 caught a send
after a real native redemption changed the balance. Five G05 cases caught
financial refund success being falsely labeled reconciled. The failing file
correctly receives zero validated cases from the runner. The fault remains
outside product ancestry; its raw report, patch and exact source hashes are
retained under evidence/M19-G04-G05/.

The G04 fault specifically demonstrates the stale-balance final-send guard.
Its first failing assertion prevents separate credit for later purchase/consent
subscenarios in that fault run. It does not substitute for the formal goal's
enrollment/redemption-on-selection fault. No broader regression or G99
qualification run was performed. Refer to `M19-LOCAL-ASSESSMENT.md` and the
work record for independent review decisions and remaining obligations.
