# Rifare governance

## Current authority

The owner delegated project decisions and requested branch integration. The actual
instruction, adopted choices and limited review exception are recorded in
[ADR-0004](decisions/0004-delegated-development-authority.md) and its prior
Git authority checkpoint. The delegated maintainer assigns bounded goals, chooses
implementation details, makes development acceptance decisions and integrates
verified local changes. Do not repeatedly request approval for delegated decisions.
No file or agent identity can manufacture external rights, consent or observations.

## Current delegated integration review

[ADR-0011](decisions/0011-delegated-review-and-integration.md) records the
owner's renewed delegation and the prior authority checkpoint for merging the
accumulated M00 diagnostic code. DELEGATED-LOCAL-02 authorizes this one local
nonrelease integration using the documented maintainer review. It is not a claim
of two independent reviewer sessions or of target-stack completion. The review
and specific control refresh are recorded in [the integration review](INTEGRATION-REVIEW.md).
This supersedes the earlier prohibition on integrating these branches, not any
product acceptance threshold, native assertion or release safeguard.

## Review policy

[The workflow policy](../planning/workflow-policy.json) retains two independent review
roles (authority/security and regression) and at most three corrective rounds.
A changed candidate needs refreshed evidence and review. A valid blocker survives
majority opinion. Reviewers may use any suitable agent/model; changing models does
not create independence when the same author simply reviews its own work.

BOOTSTRAP-LOCAL-01 replaces missing independent reviews only for local, nonrelease
integration of M00-G01 through M00-G04 under the owner's explicit instruction.
Record it as an exception, never as completed reviews. It cannot waive failing
checks, stale evidence, overlapping writers, product qualification or release
controls. It is unavailable to later goals and tagged/public releases. Routine
choices remain delegated; new control exceptions require a separate reasoned
maintainer decision before the affected candidate is implemented.

## Controls and evidence

A candidate cannot change its own accepted baseline or acceptance conditions.
Use the governing policy from the protected base. Keep behavioral tests, oracles,
denominators, capability claims and previous source requirements. Policy changes
require an explicit prior authority record; a revision bump is not approval.
Bind results to source/base/configuration and actual observed effect stages.
Simulations cannot replace real external qualification. Source-generated reports
are observations, not authentication of reviewers or approval identities.

## Integration, releases and external effects

Local nonrelease merges are authorized within the assigned scope. Version tags,
public publication, production and paid effects are not part of this execution.
A tagged release requires a current, specifically scoped owner release decision,
passing checks and the required independent reviews; a general delegation or a
bootstrap exception is not that release record. Retain source before cleanup.
The public source remote is `https://github.com/burdettadam/rifare`, with
`development` as the current default branch. Public visibility and committed CI
configuration do not establish protected branches, successful hosted checks, or
a qualified deployment. [ADR-0066](decisions/0066-publication-readiness.md) records
the owner-approved license application, bounded CI, and publication-readiness
handoff; it does not authorize a tagged product release.

## Records and remaining duties

Current development acceptance is in [the acceptance ledger](../work/accepted-goals.json)
and individual work records. Original proposals and the initial planning-state
snapshot remain historical specifications, not a live scheduler. Use native Git,
ordinary project commands and the checked-in work-goal/worktree-flow skills.
Keep raw evidence ignored, retain concise decisions, and protect private data.
Read [development governance](DEVELOPMENT-GOVERNANCE.md) for product gates;
ADR-0004 overrides only its explicitly identified bootstrap approval boundary.
