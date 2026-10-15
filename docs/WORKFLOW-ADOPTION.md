# Workflow adoption record

## Source actually inspected

ElevenID/git-agent v0.2.1, commit `2ead37bfe9bf28489816bfdd4deeea137e23fa37`. Its README, repository metadata, two workflow skill templates and MIT license were read through the connected repository. The two skill templates have upstream Git blob IDs `6d6b9221d4f18df3f5f38e4872d6901d3091d478` and `65e0020d4cb796f7db752ffc571f114c2a90b69e`.

The starter includes explicit adaptations of those instructions and retains the upstream notice. Paths and evidence references point to Rifare's goal package. No global command, client configuration, permission, model selection, repository remote or credential was installed or changed. `git agent init` itself was **not executed**; this is not a byte-for-byte initializer output.

## Adopted working shape

Use native Git worktrees, one writer per assigned branch, existing local commands, bounded goals, independent review, candidate-bound evidence and explicit human release authority. Generated evidence stays ignored. No scheduler, custom Git subcommand, task database or service is added.

The four rubrics under `skills/` sit inside the work-goal review loop. They do not assign work, bypass authority or require a particular model/runtime. Product skill examples live separately under `examples/skills/`.

## Remaining M00-G04 qualification

Verify instruction discovery and permissions in the actual client; assign integration/admin/review owners; adopt review limits and exceptions; configure any authorized private remote and hosted protections; reconcile local/hosted test behavior; prove source recovery and evidence retention. None of these are inferred from the presence of files.

The standard-library Python helpers belong to the Rifare planning pack. They are not dependencies of the upstream Bash initializer and are not an agent orchestrator.
