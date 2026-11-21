# RCG-4B-C2 — Durable original delegated-command claims

State: implemented; integrated verification and independent reviews pending.
Integration owner: root delegated maintainer.
Implementation writer: `command_consumer_impl`, separate assigned worktree.
Independent reviewers: `commerce_checkpoint_audit` (authority/security),
`receipt_regression_review` (regression).
Protected source: `031bd324ec270c4b75268928587f1bfbcba5a454`.
Integration branch: `feat/rcg4b-command-claims`.
Assignment: [ADR-0076](../../docs/decisions/0076-durable-delegated-command-claims.md).

## Assigned outcome

Retain complete original P03 mutations and immutable unverified observations
under current native customer access. Reuse the C1 codec, existing document
storage and privacy/restore owners. Preserve command and FINALIZE challenge
refusal identities through cancellation, erasure, uninstall and restore. No
transport, new checkout lifecycle or business operation is assigned.

Correct the prior codec's missing additive adapter-catalog registration while
preserving every existing coverage row. The targeted protected-source validator
failure was reproduced directly as `ADAPTER_CATALOG_UNDECLARED_ADAPTER_SOURCE`;
this is an actual prior omission, not a missing-new-module test failure.

## Evidence and remaining boundary

The writer implementation is integrated from native 247dc15 and its recovery-fence
correction 5cafb07. Both exploratory writer runs passed twenty cases; only the
second includes quarantine introduced by the final native guard. Root added typed
privacy/restore hooks, nineteen lifecycle cases, four real process cases and four
bounded catalog cases. Integrated fixed-candidate verification and independent
reviews are pending. Current provider head remains 1063f32b and
Protocol remains 6126da7. Public serving and authentication, independent purchase
binding, full connected execution and formal qualification remain open.
