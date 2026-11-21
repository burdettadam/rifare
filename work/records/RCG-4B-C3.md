# RCG-4B-C3 — Native checkout START_USE claims

State: assigned before implementation; formal acceptance not performed.
Protected base: `f4cd7f1d4df569a2bfd22c7540041e0336f72d64`.
Branch: `feat/rcg4b-native-start`; integration owner: root.
Writer: `command_consumer_impl`, separate assigned worktree.
Independent reviews: authority/security `commerce_checkpoint_audit` and
regression `receipt_regression_review`.

The owner requested continued development. [ADR-0077](../../docs/decisions/0077-native-checkout-start-claims.md)
assigns native START construction from the actual checkout owner, an additive
existing-journal method with its final purchase check inside the top-level
transaction, and focused lifecycle/regression evidence. Grant and provider
correlation remain unverified expectations; public transport and execution are
not part of this increment.

The source proposal reuses the actual preview digest and existing C1 codec/C2
retention. It preserves all original stored bodies, native business owners,
privacy handlers, cases, oracles and migration files. The independently identified
legacy nested catalog stale-count issue remains outside this assignment.

Actual candidate commits, executions, source/runtime equivalence and independent
review outcomes will be recorded here after implementation. No result is claimed
by this assignment.
