# ADR-0011 — Delegated local review and integration

Status: authorized before implementation of review fixes or integration.
Date: 2026-10-16.

## Authority and scope

The owner instructed: “Perform the review and use best judgment, I delegate
 decision making to you. Merge code at will.” This instruction supplements the
prior delegation. The delegated maintainer is authorized to review the accumulated
M00-G05, M00-G06, M00-G07, M00-G08 and M00-G99 development contributions, correct
review findings, and integrate verified code into local `main`.

Review base: `8de9a432671b5a96df948096070cb7128e9e2584`.
Prior main: `4dc8041ca81e75a2557cd5cd40b52e24d43b812f`.
Assigned branch: `review/delegated-integration`.
Writer and integration owner: `rifare-delegated-maintainer`.

## Bounded integration decision

`DELEGATED-LOCAL-02` permits this single local nonrelease integration after an
explicit maintainer review covering security, correctness, regressions and
operability. The reviewer is the same assistant lineage as the implementation;
this is not two independent reviewer sessions and must never be represented as
such. The exception replaces the independent-review prerequisite only for this
merge. It does not change the fixed workflow-policy fixture, approve future goal
completion, or authorize release, production, paid effects or remote publication.

Completed diagnostic contributions may be merged without mislabeling their full
PostgreSQL/React goals as complete. Goal acceptance and source integration are
separate decisions. Retain every original test ID and assertion; add targeted
behavioral regression tests for confirmed defects. Do not lower benchmark gates,
change platform scope or substitute diagnostic evidence for target qualification.

## Review-controlled baseline refresh

A demonstrated defect in a pinned verification helper may be fixed. The old
controller must still report protected changes; do not add an approval bypass.
Record each protected change and its regression proof, then export a new reviewed
local controller/baseline from an exact commit under this authority. Retain the
old refs and comparison evidence. External expected hashes must remain outside
the checkout. This review creates no hosted protection or hostile-code sandbox.

## Delivery and remaining work

Keep source commits and all goal branches. Use a new Git merge commit on `main`
only after fresh checks of the integrated candidate. Record the local review,
findings, actual results and qualified scope. Leave target-stack implementation
and served-browser qualification in their existing owning goals. No additional
acceptance framework is authorized by this assignment.
