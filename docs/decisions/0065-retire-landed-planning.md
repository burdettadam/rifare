# ADR-0065 — Retire landed planning from the active backlog

**Status:** adopted for development documentation and planning maintenance.

**Authority:** the repository owner's instruction to remove goals and milestones
whose code has landed, using architecture and Git history for continuity.

## Context

At `d1fb45b94e14b276f7fa6e04f50173fe8cf39c77`, the catalogue still presented
281 packets and 26 milestone sheets as proposed work. The source had already
reached the bounded local M20-G03 checkpoint. Re-reading and regenerating the
completed implementation plans obscured the work that remained.

Code presence does not establish production readiness. The audit also found
unfinished target-stack and connected-adapter implementation, missing recovered
M15/M16 source, incomplete loyalty attribution, and unresolved provider, model,
physical, independent-user and deployment qualification.

## Decision

1. Keep only unfinished work in `planning/goals.json` and
   `planning/milestones.json`. Remove retired packets from both those inputs and
   the generated directories. Narrow partially landed packets to their remaining
   work without changing their original behavioral criteria or formal dependencies.
   Consolidate missing real source adapters into 27 compact integration entries
   instead of retaining their completed local workflow instructions.
2. Remove the duplicate backlog, roadmap, initial-state and scheduling snapshots.
   Use the active catalogue, current architecture and ordinary Git/work records.
   Do not create a completed-plan archive in the working tree.
3. Retain the 949 behavioral specifications, 216 requirement mappings, frozen
   source criteria, 57 capability targets and all executable tests. These remain
   regression and qualification contracts, not an active implementation queue.
   Their stable owner IDs resolve historical dependencies without storing another
   copy of the retired goal descriptions.
4. Replace registry references to retired generated packets with the retained
   behavioral specification contract. Preserve every capability identity, enabled
   state, test binding, source/oracle contract and qualification flag. Existing
   regression comparison must continue to flag contract changes; this decision
   does not make the candidate its own trusted baseline.
5. Describe the current implementation in `docs/ARCHITECTURE.md`, unfinished work
   in `docs/ROADMAP.md`, and remaining release obligations in
   `docs/QUALIFICATION.md`. Formal dependency IDs remain unchanged. Retirement
   neither accepts a goal nor satisfies a prerequisite.

## Continuity and verification

The complete previous plan is available from Git:

```sh
git show d1fb45b94e14b276f7fa6e04f50173fe8cf39c77:planning/goals.json
git show d1fb45b94e14b276f7fa6e04f50173fe8cf39c77:planning/goals/M20/M20-G03.md
git log --all -- packages/commerce/dropoff-handoffs.mts
```

Historical record links point to the original imported product tree at
`c299065241b3bdf4928a83f9ff4decf749c6afaa`; the commands above also recover the
exact pre-cleanup layout. Current generated views
must match only the active inputs; an obsolete packet is an orphan, not a reason
to restore the old backlog. Verification covers active-plan integrity, unchanged
behavioral and native test inventories, local links, distribution paths, and
independent review. The acceptance ledger, release thresholds and source-system
authority rules remain in force.

The pre-existing release-benchmark/envelope mismatch is separate work. This
cleanup must not rewrite its cohort, thresholds or frozen source hashes to make
the shorter active backlog look qualified.
