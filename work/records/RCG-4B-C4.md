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

Actual candidates, verification, corrections, independent reviews and publication
equivalence will be recorded after implementation. No result is claimed here.
