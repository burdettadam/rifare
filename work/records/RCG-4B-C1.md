# RCG-4B-C1 — Delegated-use command consumer

State: assigned; implementation and verification pending.
Integration owner: root delegated maintainer.
Implementation writer: `command_consumer_impl`, separate assigned worktree.
Independent reviewers: `commerce_checkpoint_audit` (authority/security),
`receipt_regression_review` (regression).
Protected source: `ddc35b7905ce98b0ea1f172e855700eccf62bc5e`.
Integration branch: `feat/rcg4b-command-consumer`.
Assignment: [ADR-0075](../../docs/decisions/0075-delegated-command-consumer.md).

## Outcome

Consume the pinned optional P03 START_USE, FINALIZE_USE and original-result
recovery wire contract with strict validation, original identity/digest binding,
immutable historical recovery and exact receipt-byte correlation. Reuse the
existing native JSON, digest and receipt helpers. This codec sends nothing and
grants no authority. No provider route, context source, durable claim store or
merchant operation is introduced.

## Provider observation

Protocol remains at `6126da7619e057be2ff58dd38a5d50f49891d1b3`.
Provider draft PR #1994 has advanced to `c44579ab81b46c4b5a55be1fd0308f0464824045`,
adding concrete machine/MAP, credential-authority and policy-source owners.
It still installs no public use route or executable. The independent Rifare
consumer is useful preparation for the later public adapter; it does not close
those external serving and qualification gates.

## Verification record

Candidate: pending.
Targeted binding-fault observation: pending.
Codec and native composition cases: pending.
Applicable unchanged receipt regression: pending.
Independent authority/security review: pending.
Independent regression review: pending.
Formal milestone acceptance: not performed.
