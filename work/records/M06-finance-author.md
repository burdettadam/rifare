# M06-G02 through M06-G04 — Finance author assignment

State: ready for independent review, diagnostic implementation only. Authority
base: `be24e98`; G01 interface checkpoint `a9d9bd9` is the direct source base.
Authority: [ADR-0028](../../docs/decisions/0028-exchange-depth-first-five.md).
Writer: `/root/finance_goals`, branch `goal/M06-finance`; integration owner: `/root`.

Read root governance, development, architecture and plans; the existing work-goal
and worktree-flow skills; all three goal packets and M03/M04/M05 blocked milestone
assessments. Those prerequisites and connected qualification remain blocked.

Assigned source: `resolution-ledger.mts`, `refund-quotes.mts`,
`resolution-execution.mts`, `resolution-fixture-source.mts`, new
`exchange-finance.mts`, additive `021_exchange_finance.sql`, and additive finance
tests/oracle fixtures. Existing tests, inventory, planning and protected baseline
are retained unchanged. Root owns catalog, replacement and gift integration.

The implementation reuses the current action gateway and resolution operation
ledger. New amounts and instrument destinations come from pinned original source
facts, never agent amounts. A sent invoice, partial payment or uncertain response
does not authorize a replacement. Fixture financial stages do not claim live
settlement. No external or paid effects are authorized.

Implemented 35 permanent finance cases, a hand-calculated residual/bundle fixture,
lost-response and replay source effect counts, native capture identity, source
instrument routing checks and all six bundle processing permutations. Existing
tests remain byte-for-byte unchanged. Three deliberately broken variants were
detected by actual behavior: invoice treated as settled (one failure), all residual
to one instrument (five failures), and retail bundle refunds (three failures).
No mutant execution skipped a case. Raw logs remain under ignored
`evidence/M06-finance/` and are not a review or an acceptance authority.

The source still supports synthetic fixtures only. The integration owner must
register the new tests/inventory, integrate the replacement and gift hooks, finish
the actual integrated demonstration, refresh the independent reviews and execute
the full protected suite. Formal G02/G03 and prior milestones remain blocked by
connected and target-stack qualification. This author never self-accepts.

## Retained checks and identified integration limits

All 35 finance tests and 14 G01 tests pass. Retained refund quote, ledger, credit,
variant and resolution-review suites total 85 cases and pass; refund execution
(21), replacement orders (19) and order-edit payments (14) also pass. Two further
checks remain explicitly unresolved in this author checkout: the privacy guard
requires root's new catalog/gift storage inventory, and one multi-process stock
test receives empty child stdout under the restricted runner. Neither is skipped
or counted as a pass. Root will verify them on the integrated candidate using the
approved full native runner.

## Recovery

Migration 021 preserves every existing operation row, identity and observation.
Keep it with the source; do not drop new obligations to downgrade. Disable effects
before restoring an earlier environment, retain both local and independent fixture
source state, and reconcile unknown outcomes without issuing a new operation key.
The gift recipient and original instrument seed methods are fixture administration
only, never an agent permission or a live-platform qualification.

## Follow-up integration assignment

After source checkpoint `de559908a336b1caaee30b9ad348b160d34ade69`, root
assigned this author the payment-to-replacement integration in
`return-fulfillment-core.mts`, `replacement-inventory.mts` and
`fulfillment-fixture-source.mts`, plus additive integration tests. Root retains
gift proof, erasure and final source merge. This follow-up must preserve default
equal-price command shapes and persist any nonzero financial requirement in the
independent native reservation before replacement execution.

The follow-up is implemented and ready for independent review. A nonzero native
reservation now binds the original signed balance, original entitlement,
replacement value and independent finance source. Replacement review and dispatch
require the exact settled source receipt; the native replacement call checks its
persisted reservation and actual source capture before committing stock. Removing
payment fields from the command cannot remove that reservation requirement.
Equal-price command bodies retain their original shape.

`exchange-fulfillment.test.mts` adds 12 permanent integration cases. All 12 pass,
as do the 35 finance cases and 19 retained replacement-order cases (66 actual
named Node 22 TAP cases, no skips). The native receipt-guard mutant fails two
cases; the dropped-reservation-requirement mutant fails one. Logs and hashes are
under `evidence/M06-finance/fulfillment-followup/`. The separate source also rejects
overlapping original instrument units under a new allocation identity, and exposes
`assertGiftRecipient` for root's gift replacement integration. That helper checks
both the original account customer and the independently seeded recipient grant.
Root retains the combined gift behavior, test registration, full protected run and
independent acceptance decision; no connected qualification is implied here.

Independent regression review identified that the first dropped-binding mutant
log reached a reconciliation error before the effect-count assertion. That initial
log is retained. The supplemental test now checks native replacements and stock
immediately after dispatch. All 12 candidate cases pass again; the identical
source mutant fails the explicit forbidden-effect assertion (one actual native
replacement versus zero allowed). The corrected raw log is
`reservation-payment-requirement-dropped-behavior.tap`, with source/test hashes in
`targeted-faults-behavior.json`. Only this corrected rerun supports the direct
stock/effect behavioral claim for that mutant.
