# M04 implementation review

## Authority and scope

The project owner delegated decisions and local merges. [ADR-0025](decisions/0025-safe-order-edit-milestone.md) recorded the bounded authority before implementation. This review is by the same assistant as implementation, not invented independent reviewer sessions. It supports local integration only; full milestone and live qualification stay blocked.

## Findings corrected

1. Native edits initially left the canonical order-status interface showing old totals. A real regression assertion observed 12500 instead of 3000. Source refresh/commit now projects verified facts into the existing read contract and preserves compatible processing/shipped/cancelled status values; native partial detail remains separate.
2. The synthetic source initially initialized shipped warehouse lines as pickable. A behavioral assertion observed true instead of false. Initialization now derives the warehouse stage and cancellation flag from its actual line states. The qualification probe uses its own temporary canary and never changes the original order.
3. A status response arriving after UI sign-out could repaint private records. The rendered-component assertion detected the leak. The UI now checks the session generation after that final asynchronous response; sign-out clears records, summaries, stage cards and credentials. Late intent results cannot enable approval.

4. Source responses with a negative hold acknowledgement or a different warehouse identifier could advance local stages despite correct common operation identifiers. Two behavioral failures exposed the gap. Stage-specific receipt checks now require the expected acknowledgement, warehouse, reason, calculated session and version before progressing.

## Review checks and retained obligations

Original executable tests and registrations are retained byte-for-byte. The controller remains exported from the pre-change commit for the first integrated run. New test files cover action-specific windows, shipped/subscription limits, hold ownership, current permissions, native edit CAS, independent finance, unknown outcomes, two-source process boundaries, privacy, REST and portable workflow contracts.

Two actual Node processes contend for a native commit; another exits immediately after source commit. Native effect and inventory assertions establish one committed edit in these synthetic scenarios. A later local process reconciles rather than resending.

The manual interface shows readable stage cards with expandable source history. Tokens remain in memory. It has no source-configuration field, settlement override, release-all, direct platform write, or automatic unknown retry route.

The separate evidence delivery records the exact candidate, actual test counts, red/green reproductions, deliberate broken variants, prior source preservation, integration decisions and archive restoration. Any failure, missing execution or unavailable external qualification remains explicit rather than converted into a passing test.

## Remaining limitations

Connected platform, warehouse, payment, PostgreSQL/React, real agent/model and direct served-browser qualification have not been performed. The source is an independently persisted synthetic ledger with tested transactions and idempotency, not a universal exactly-once guarantee. Expired/unknown operations stay held; automatic compensation is not enabled. Logical local erasure does not erase external source databases or backup history.
