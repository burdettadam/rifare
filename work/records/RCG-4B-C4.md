# RCG-4B-C4 — Local checkout command access

State: assigned before implementation; formal acceptance not performed.
Protected base: `e8a0152825711bea81df29b8d9b035fea01ea035`.
Integration branch: `feat/rcg4b-command-http`; owner: root.
Implementation writer: `command_consumer_impl`, separate assigned worktree.
Independent reviews: `commerce_checkpoint_audit` (authority/security) and
`receipt_regression_review` (regression).

The owner requested continued development after the published C3 checkpoint.
[ADR-0078](../../docs/decisions/0078-local-checkout-command-access.md) assigns
separate local customer command routes through the existing API/server/Python
client, using C3 native START and C2 original history/recovery/cancel. The same
assignment corrects four explicitly identified native composition boundaries
that currently dispatch through overridable instance methods.

Provider `37b7fdc3d3f1c223613ad98fe601d7d86e6a3600` now documents an actual
internal managed network lifecycle; Protocol remains `6126da7`. Public
consumer/wallet selection remains open. This is source inspection; no provider
test or external call is authorized by the local command route.

Preserve all existing checkout/recovery routes, stored records, native business
and privacy owners, tests, fixtures and migrations except assigned source-count
and actual pin refreshes. Raw/observe/FINALIZE/send routes, new context authority
and default-branch/release/deployment actions are outside this scope.

## Assignment and independent assertions

Native assignment `61f0dfac6b769d7829f95ea0b669b012f4ca2cf4`, tree
`5230fb013b5f6bd140b572f240aac90ba678dfad`, was published before product changes
as exact-tree `8f38faff84824d3ca01e8c2b3c5349af131659a2` on the new feature branch.
Both independent reviewers read the full ADR and found no assignment blocker.

Root wrote twelve owner-binding cases before integration, committed at
`cc0cbcd081a427325e8a7572d143c076b3d147f4`. Against the unchanged protected
product, all twelve reached their intended behavioral assertions and failed:
forged owners accepted, instance shadows called, API authorization bypassed,
closed receipt availability bypassed and accessor containers accepted. There
were no import, setup, syntax or skipped-case failures. The actual negative
execution took 1.942 seconds; native XML records 12 executed, 0 passed, 12 failed.
The failed-wrapper `actual_tests: 0` is bookkeeping and is not its denominator.

Raw report: `evidence/development/20261121T234210.227298Z-5098b9/report.json`.
SHA-256: `912e25366fb1f19a1be4802fab115e201c30f99f843f571ee299d6bc9cee863f`.
The assertions remain unchanged for final candidate qualification. Root separately
committed twelve independent copied-client cases at
`1deda2086808702a959b486e08d45faff7485f68`. The implementation writer owns the
separate twenty-case HTTP file and writes it before implementation.

Final product candidates, executions, corrections, independent reviews and
publication equivalence will be recorded after integration. No final pass is
claimed here.
