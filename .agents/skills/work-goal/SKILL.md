---
name: work-goal
description: Execute or resume one authorized Rifare goal using tracked source, isolated worktrees, behavioral evidence and independent review. Use for bounded implementation and actual-state reporting, never to infer acceptance authority.
---

# Work one authorized goal

Adapted from the pinned git-agent workflow identified in `docs/WORKFLOW-ADOPTION.md`; retained notice is in `THIRD-PARTY-NOTICES.md`.

1. Read `docs/GOVERNANCE.md`, `docs/DEVELOPMENT.md`, `docs/ARCHITECTURE.md`, `docs/PLANS.md`, the assigned `planning/goals/<milestone>/<id>.md` and its accepted dependency evidence. Check nested guidance, actual permissions and previous accepted controls.
2. Confirm the integration owner, writer, branch/base, allowed paths, risk and reviewers. Resolve uncertain previous writers. No assignment, no automatic execution of the ready queue.
3. Use the worktree-flow skill and documented commands. Search existing behavior before adding alternatives. Keep one canonical implementation; no unrelated refactors or customer-specific core forks.
4. Copy the work-record template into the assigned branch when authorized. Bind stable test IDs to real executable cases and independent expected outcomes. Demonstrate a meaningful behavioral failure or the goal's targeted fault.
5. Implement the minimum bounded outcome. Run new and applicable accepted regression tests. Obtain required external qualification only with explicit authorization; otherwise report the blocked boundary.
6. Fix the exact candidate/base/configuration during review. Mutable local previews are exploratory, not immutable evidence. Preserve actual source-system records and name the observed effect stage.
7. Use the independent authority and regression rubrics in `.agents/rubrics/`. Collect findings independently. Renew verification/reviews after relevant candidate changes; escalate unresolved blockers at the accepted round limit.
8. Checkpoint source/progress and durable review links. Push only to an explicitly authorized remote. Keep raw evidence under ignored `evidence/`; no report-only commits or invented remote retention.
9. Submit `ready_for_review`, `blocked` or `needs_changes`. Only the authorized acceptance owner decides accepted status. Releases, publication, paid effects and production require separate human authority.
10. After terminal closure, preserve decisions/source/review links and remove only owned temporary evidence or runtime resources. Record local-only recovery gaps.

The detailed worker/evidence/regression contracts under `docs/` apply. Do not create another scheduler, runtime registry, state database, execution adapter or mandatory model provider to perform this loop.
