# Dispatch, ownership and parallel work

Use the existing `work-goal` and worktree conventions after inspecting their installed version. The JSON/Markdown files are a dependency graph and scope definition, not a new orchestration engine. Import IDs into an existing issue tracker only under separate authorization; external issue creation and remote publication require separate authorization. This repository has a local bootstrap commit only.

## Selection rule

Choose the earliest approved goal whose direct dependencies are accepted and whose real prerequisites exist. The static `planning/dependency-waves.json` groups nodes that are dependency-ready after prior waves; it does not predict elapsed time or authorize parallel writes. `planning/goal-state.json` starts with every goal unassigned and not started.

A worker can prepare isolated design/tests while a connected prerequisite is unavailable, but must not report the blocked goal accepted. Changing execution order or splitting a goal is permitted through recorded planning updates that preserve parent requirements, tests and evidence.

## Shared contracts before parallel consumers

M00 establishes worktree/environment isolation and evidence controls. Early M01 identity, capability and read contracts precede most skill/UI/provider consumers. M02 stabilizes money, policy, action authority, approvals and operation identity before real money. Do not assign competing workers to invent incompatible versions of these contracts.

After an interface is accepted, independent UI, adapter, skill and evaluation lanes can work against its versioned contract. Each lane has one writer per worktree and separate database/ports/queues/object storage. A lane label is not sufficient isolation: the integration owner compares actual allowed write paths, migration ownership and shared schema/test changes before dispatch.

Never let two workers independently rewrite the same central policy/action/receipt schema. Create one contract goal, then let consumers depend on its accepted version. Prefer small integration steps over long-lived diverging branches.

## Integration responsibility

The integration owner rebases or merges accepted components into one candidate, checks newly accepted parallel features against the protected baseline and runs combined evidence. Tests from different commits do not establish a passing combined release.

A milestone's `G99` goal depends on every component goal and the original predecessor milestone gates. It closes original requirements only when all mapped in-scope components and original exit criteria pass. It may not silently exclude a failed goal to make the milestone green.

After M07, shipping (M08), marketing/conversion (M09), claims/partners (M10) and ecosystem (M12) can evolve independently if concrete scopes permit. Inventory/procurement (M11) also requires M08. Every branch must preserve the whole current accepted baseline, including siblings outside its static dependency ancestry.

## External and optional goals

`connected_test` goals need authorized real test accounts, current pinned API versions and observable native records. `external_qualification` goals need genuine participants, agreements or observations. `human_decision` goals can be drafted by a worker but accepted only from real authority. `conditional_local` code-mode implementation requires the explicit M12-G08 go decision.

Partner-dependent positives remain blocked without a partner. The platform can still ship an explicit unavailable capability and its negative tests under a reviewed reduced scope. That does not count the missing partner feature as complete. Missing required M07 pilot observations must yield beta/RC or a blocked v1 gate, not fabricated data.
