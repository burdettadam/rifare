# Rifare agent instructions

## Read before writing

Read `docs/GOVERNANCE.md`, `docs/DEVELOPMENT.md`, `docs/ARCHITECTURE.md`, `docs/PLANS.md`, the assigned goal packet and applicable nested guidance. Use `.agents/skills/work-goal/SKILL.md` and `.agents/skills/worktree-flow/SKILL.md`. The rubrics under `.agents/rubrics/` refine evidence/review; they add no authority or scheduler.

## Current development boundary

This repository contains a substantial local commerce implementation through M20-G03. Read `docs/ARCHITECTURE.md` for existing owners, `docs/ROADMAP.md` for remaining code and `docs/QUALIFICATION.md` for unresolved release evidence. The runnable diagnostic profile uses SQLite and plain browser surfaces; the target PostgreSQL/React application and real integrations remain open. Consult `work/accepted-goals.json` for formal development acceptance. Begin only an assigned scope; roadmap presence is not automatic assignment.

Use Rifare as the sole project identity in code, documentation, generated views, Git metadata and issue text. Do not import external product research archives, vendor-named positioning or obsolete project branding. Distinguish implemented local behavior, missing code and qualified production capabilities accurately.

## Execution

Use one writer per assigned branch/worktree. Discover actual paths through Git; do not assume `.git` is a directory in a linked worktree. Ordinary local commands are in `docs/DEVELOPMENT.md`. Do not introduce a worker scheduler, registry daemon, custom Git wrapper or mandatory model provider.

Scope changes, paid/production operations, remote publication, account administration and release tags need separate authorization. No credentials, customer data, model keys, database dumps or generated evidence in Git.

## Proof and review

Write behavioral tests first or demonstrate the goal's targeted fault. Preserve accepted features, tests, oracle fixtures, denominators and capability claims. A green count is not evidence when relevant tests are skipped, deleted or weakened. Bind actual reports to the exact candidate/configuration and obtain independent authority/security and regression review.

Only the delegated maintainer can record acceptance under the actual owner instruction and named scope; ordinary workers cannot self-accept. Never impersonate a reviewer, fabricate a pilot or infer settlement from a local record. Keep missing prerequisites blocked. Product test results remain specifications until real tests exist and run. A helper-suite pass cannot accept a product goal.

## Canonical records

`planning/goals.json` and `planning/milestones.json` contain remaining work. The compact integration entries identify missing real adapters without duplicating landed workflow instructions. Render cards with `python3 tools/render_plan.py --root .`; do not edit only the generated packet. After implementation, retire completed instructions from the inputs and generated views, retaining concrete gaps concisely. Use architecture and Git history for implementation context; do not create a completed-goal archive.

Before assigning a compact integration entry or formally qualifying a retired gate, follow `planning/README.md` to promote only that bounded original contract into an active packet and commit the assignment. Existing workflow/evidence tools require the packet at their trusted base; do not bypass their missing-goal check.

Behavioral specifications, frozen criteria, requirement coverage and native test registrations remain regression/qualification contracts. Retired IDs still express formal dependencies; retirement does not accept them. Track assignments and outcomes under `work/records/` through the integration owner. Keep raw evidence in ignored `evidence/`; preserve concise decisions, source commits and review links before cleaning owned artifacts. ADR-0065 records the owner-authorized planning retirement.
