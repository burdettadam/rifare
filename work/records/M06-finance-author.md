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
