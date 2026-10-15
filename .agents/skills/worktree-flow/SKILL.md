---
name: worktree-flow
description: Create, resume, verify, checkpoint or clean an assigned Rifare Git worktree using native Git and documented local commands. Distinguish checkout isolation from runtime isolation.
---

# Run an assigned worktree

Adapted from the pinned workflow in `docs/WORKFLOW-ADOPTION.md`. Read `DEVELOPMENT.md`, `GOVERNANCE.md` and the assigned work record.

1. Discover repository/worktree with Git. Inspect status, branch, worktree listing, owner and base. A `.git` file is valid. Do not construct shared administration paths or disable Git's same-branch guard.
2. Reconcile interrupted writers, uncommitted/staged changes and owned processes before takeover. Shared repository configuration/ref changes need the administration owner. Worktree locks are not agent semaphores.
3. Create/resume the assigned branch with native `git worktree add` from its recorded base. Preserve other branches and verify the resulting checkout. Use a clean separate verification worktree when necessary.
4. Restore documented toolchain, fixtures and configuration. Current starter checks require only Git/Python; no product runtime exists. Missing isolation or startup behavior is future goal work, not a passing assumption.
5. For future product instances, verify independent ports, data, queues, storage, callback destinations and external development effects. Prove independence with two actual instances before claiming it.
6. Run local checks for feedback. Acceptance uses fixed source/build inputs with exact commands, assertions and outcomes. Dirty/live-edit observations are exploratory.
7. Update only the assigned branch's work record. Checkpoint source and decisions before handoff, provide exact revisions and preserve durable review links. Publication requires an authorized remote and actual verification.
8. Stop and clean only owned processes/resources. Preserve necessary source refs and outcome records first. Report partial cleanup, local-only recovery and remaining work without declaring acceptance.

Use native Git, the operating system and maintained project commands. Do not add a daemon, global lock database, custom worktree CLI or worker scheduler.
