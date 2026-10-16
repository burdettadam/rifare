# Rifare agent instructions

## Read before writing

Read `GOVERNANCE.md`, `DEVELOPMENT.md`, `ARCHITECTURE.md`, `PLANS.md`, the assigned goal packet and applicable nested guidance. Use `.agents/skills/work-goal/SKILL.md` and `.agents/skills/worktree-flow/SKILL.md`. The rubrics under `skills/` refine evidence/review; they add no authority or scheduler.

## Bootstrap boundary

This repository contains planning and developer helpers, not a commerce application. Initial planning snapshots remain unchanged; consult `work/accepted-goals.json` and ADR-0004 for current delegated development acceptance. Begin only an assigned goal. Do not implement subsequent milestones merely because their files exist.

Use Rifare as the sole project identity in code, documentation, generated views, Git metadata and issue text. Do not import external product research archives, vendor-named positioning or obsolete project branding. Keep requirements stated as Rifare targets rather than assertions that features already exist.

## Execution

Use one writer per assigned branch/worktree. Discover actual paths through Git; do not assume `.git` is a directory in a linked worktree. Ordinary local commands are in `DEVELOPMENT.md`. Do not introduce a worker scheduler, registry daemon, custom Git wrapper or mandatory model provider.

Scope changes, paid/production operations, remote publication, account administration and release tags need separate authorization. No credentials, customer data, model keys, database dumps or generated evidence in Git.

## Proof and review

Write behavioral tests first or demonstrate the goal's targeted fault. Preserve accepted features, tests, oracle fixtures, denominators and capability claims. A green count is not evidence when relevant tests are skipped, deleted or weakened. Bind actual reports to the exact candidate/configuration and obtain independent authority/security and regression review.

Only the delegated maintainer can record acceptance under the actual owner instruction and named scope; ordinary workers cannot self-accept. Never impersonate a reviewer, fabricate a pilot or infer settlement from a local record. Keep missing prerequisites blocked. Product test results remain specifications until real tests exist and run. A helper-suite pass cannot accept a product goal.

## Canonical records

`planning/goals.json`, test specifications, coverage and milestones define the planning baseline. Render cards with `python3 tools/render_plan.py --root .`; do not edit only the generated packet. Track assignments and outcomes under `work/records/` through the integration owner. Keep raw evidence in ignored `evidence/`; preserve concise decisions, source commits and review links before cleaning owned artifacts.
