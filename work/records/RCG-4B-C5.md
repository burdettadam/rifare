# RCG-4B-C5 — Internal delegated-command transport

Status: assigned; implementation, focused evidence and independent review pending.

Protected public base: `9c61f309398842cf49d7fdcde6cef788acdac3b7`, tree
`9755b4ee47b53d4eac27f90e16398ca76ba670df`.
Assignment: [ADR-0079](../../docs/decisions/0079-internal-delegated-command-transport.md).

Root owns feature branch `feat/rcg4b-internal-use` and integration.
`command_consumer_impl` owns its separate implementation branch/worktree.
Independent roles are `c4_authority_review` (authority/security) and
`receipt_regression_review` (regression). No reviewer authors candidate code,
tests or expected outcomes. At most three corrective rounds apply.

The selected increment composes the documented internal mTLS START and explicit
original-result recovery endpoint with C1/C2/C3. Atomic new-original admission
prevents repeat sends after uncertainty; a separate retained-only currentness
method prevents a missing row from being reconstructed before transmission. Existing originals, including
pre-network failures and C4 preparations, remain recovery-only. There is no new
durable attempt state or provider-authority claim.

Fresh source inspection found provider PR1994 unchanged at
`37b7fdc3d3f1c223613ad98fe601d7d86e6a3600` and Protocol PR38 unchanged at
`6126da7619e057be2ff58dd38a5d50f49891d1b3`, both open draft and unmerged.
No provider test, account, storage or deployed endpoint is accessed by this slice.

Implementation and exact evidence will be recorded here after the fixed candidate
and independent reviews. No completion, acceptance or publication is claimed by
this assignment record.
