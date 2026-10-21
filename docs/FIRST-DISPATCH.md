# Start the next development task

Read [the current plan](PLANS.md), [architecture](ARCHITECTURE.md) and
[active catalogue](../planning/WORKER-GOALS.md). The initial M00 bootstrap is in
Git history; do not restart it from the beginning.

The next recorded commerce direction is M20-G04, followed by M20-G05. Target-stack,
loyalty and real-adapter work are also open. Choose a bounded scope with the owner,
then inspect the source and current dependencies before creating a worktree.

## Worker instruction

```text
Assigned remaining scope: <one goal ID or integration entry>
Candidate base and owned paths: <exact commit and concrete paths>

Read AGENTS.md, docs/PLANS.md, docs/ARCHITECTURE.md and docs/DEVELOPMENT.md.
Inspect the active packet or compact integration entry and current source.
Use the existing work-goal/worktree-flow skills and ordinary project commands.
Reuse landed owners, native contracts and regression tests.

Implement only the remaining bounded outcome. Keep historical formal dependencies
and qualification obligations separate from local development readiness.
Run the smallest meaningful verification for the changed behavior and collect
independent authority/security and regression review.
Report actual source changes, evidence, remaining gaps and the next useful step.
```

Use [dispatch and parallelism](DISPATCH-AND-PARALLELISM.md) for ownership and
integration. [Qualification](QUALIFICATION.md) records external evidence that a
local implementation cannot supply.
