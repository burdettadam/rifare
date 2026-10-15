# Rifare governance

This file supplies conservative bootstrap working rules. Product scope, numeric release thresholds, licensing, reviewers, repository administration and operational ownership still require explicit decisions in their assigned goals. A starter commit is not those decisions.

## Authority

The project owner authorizes work, scope changes, publishing, paid/production effects and releases. The integration owner assigns branches, collects current candidate evidence and maintains canonical progress. A worker proposes and implements only its assigned bounded change.

Use independent authority/security and regression reviewers. The provisional review baseline is two independently assigned reviewers and no more than three corrective rounds before escalation; acceptance owners may adopt a different policy explicitly. A changed candidate needs refreshed applicable checks/review. A valid blocker is not resolved by majority vote.

Do not self-approve, impersonate reviewers or treat a JSON `approved` flag as trusted identity. Human approval is required before a version-producing merge or public release. Local setup establishes no hosted enforcement or authenticated review integration.

## Controls and regressions

A candidate cannot weaken the rules for its own acceptance. Evaluate policy, baseline, test, oracle and scope changes under the previous accepted controls. Deleted features, hidden capability restrictions, skipped cases, weakened expectations, reduced denominators and discarded original criteria require explicit independent review.

A result must be linked to actual immutable source/configuration and its observed financial or physical stage. Required external qualification cannot be replaced by simulation. Optional features may be explicitly excluded by the owner; exclusion is not implementation.

## Decisions and records

Use `templates/ADR.md`, `templates/GOAL-WORK-RECORD.md`, the worker handoff and milestone-decision templates. Track concise decisions under `docs/decisions/` and `work/records/`. Keep raw evidence ignored and share only authorized minimized records. No assumed legal, contractual or partner authority.

Use [the full development governance proposal](docs/DEVELOPMENT-GOVERNANCE.md) and the assigned milestone criteria for product qualification. Where proposal and accepted controls conflict, stop and obtain a recorded decision; do not silently choose the easier gate.

## Publishing and license

No hosted remote is configured. Keep any separately authorized development remote private unless the owner explicitly approves publication. Product licensing and a public release remain M00-G03 work. Do not infer that upstream MIT notices license all Rifare content.
