# Rifare workflow adoption

## Adopted source and actual installation

The retained instructions are adaptations of ElevenID/git-agent v0.2.1,
commit `2ead37bfe9bf28489816bfdd4deeea137e23fa37`. The connected upstream commit
was checked again for this goal. Its source declares the same version and a
single initializer rather than a worker scheduler. The local instruction bytes
are pinned individually in [workflow-adoption.json](../planning/workflow-adoption.json).
The original MIT notice remains unchanged.

The files actually available to workers are `.agents/skills/work-goal/SKILL.md`
and `.agents/skills/worktree-flow/SKILL.md`. They are not byte-for-byte copies of
the initializer output. The global `git-agent` executable and a specific agent
client are absent on this host. **The initializer was not run.** A public-source
binary download was unavailable; no replacement executable was invented.
Existing adopted instructions and native Git/Python commands do not require it.

Observed host: Linux, Git 2.47.3, Python 3.13.5, Bash 5.2.37. Native operations
were tested here only. macOS, Git Bash/Windows, client instruction discovery and
client permissions still need host-specific checks; no client qualification is
inferred from file presence. No model/provider is selected or required.

## Goal mapping and responsibilities

| Responsibility | Rifare convention |
|---|---|
| Contract | `goals/<milestone>/<goal-id>.md` |
| Writer branch | `goal/<goal-id>` from a recorded accepted base |
| Progress | `work/records/<goal-id>.md` |
| Evidence | ignored `evidence/<goal-id>/<candidate-sha>/` |
| Integration/admin | Delegated maintainer acting under ADR-0004 |
| Author | One named writer and session per worktree |
| Reviews | Separate authority/security and regression assignments |
| Review policy | Two independent identities/sessions, up to three rounds |
| Release | Current explicit owner approval and independent reviews |

The independent-review slots are roles, not invented people. The current
bootstrap exception records **zero independent reviews**. Tests use labeled
synthetic reviewer identities to exercise controls, not to fill those slots.
Models and clients may vary; review independence is not established just by
switching a provider inside the author's own context.

## Existing commands only

```sh
git status --short
git worktree list --porcelain
git worktree add ../Rifare-M00-G05 -b goal/M00-G05 main
python3 tools/verify.py
python3 tools/check_workflow.py --root .
git diff --check
```

The example next worktree is created only when M00-G05 is assigned. Native Git
retains its same-branch worktree protection. The read-only checker reports contract
violations; it does not allocate work, maintain a lock service, run agents, merge,
publish, create tags, authenticate identities or block arbitrary OS writes.

## Isolation and recovery actually demonstrated

Permanent tests create a disposable repository and two **real linked worktrees**.
They commit a synthetic goal on one branch, prove the other branch/data are
unchanged, exercise Git's rejection of the same branch in another worktree, and
bind goal, branch, source/base, test report and reviewer records.

Two loopback-only Python fixture HTTP servers use separate dynamically assigned
ports and worktree-specific content. A change in one is invisible in the other;
both servers are shut down and their threads joined. This is a synthetic workflow
rehearsal, **not** database, queue, callback or commerce-runtime isolation. Those
remain M00-G05/M00-G06 work with real product commands.

Use Git-discovered paths; `.git` may be a file. Keep source checkpoints and concise
decisions, and preserve evidence separately while required. The repository and
bundle are local retention only; no hosted remote/protection was configured.

## Governing baseline

M00-G04's preimplementation policy is at `39aa37cb38df3aec27131baa8e1a4263b187d067`. Its SHA-256 is
`aac647c6c0b622a8864a31eebbc9abf1af8b111d9d3251609dbdc82830e50988`. These identify a retained base, not an authenticated review system.
No change to the policy is permitted from the checkpoint being assessed.
See [workflow checks](WORKFLOW-CHECKS.md) and [ADR-0005](decisions/0005-workflow-adoption.md).
