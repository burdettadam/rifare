# Delegated integration review — 2026-10-16

## Decision

Integrate the accumulated diagnostic source and the reviewed fixes into local
`main` after a fresh passing candidate run. Preserve original goal branches and
commits. This is a development merge, not a release or completed M00 milestone.

Authority precedes the fixes: `ae8e613de96fa6aba2e501dce370f3ec63712f67` and
[ADR-0011](decisions/0011-delegated-review-and-integration.md). Review base is
`8de9a432671b5a96df948096070cb7128e9e2584`; previous main is
`4dc8041ca81e75a2557cd5cd40b52e24d43b812f`.

The same assistant performed the implementation review under the owner's renewed
delegation. Security/authority and regression rubrics were applied explicitly;
no independent reviewer sessions or authenticated third-party approval are claimed.
The bounded local exception replaces that review-process prerequisite for this
integration only. Tests, protected requirements, release gates and real target
qualification are not waived.

## RF-REVIEW-01 — Source identity could accept replacement commits

**Severity: high for the local evidence-controller integrity claim. Fixed.**

`tools/test_harness.py:source_identity` formerly inherited Git routing settings and
replacement refs, while other controller reads disabled replacements. A synthetic
replacement commit made `git status` and the source checker report clean while
the actual bytes differed from the named original commit. A test demonstrated the
full controller executing a changed assertion under the original commit identity.
This is a concrete local-integrity defect, not a claim of remote exploitation.

The fix centralizes a minimal Git environment, ignores inherited routing/index
settings, disables replacement objects in source reads, and applies that same
environment to the controller's ancestry check. The tests use real temporary Git
repositories, replacement commits and an unrelated repository—not mocked hashes.
Nine permanent cases cover clean and changed trees, replacement-ref rejection,
foreign repository/index inputs and actual pre-execution controller rejection.
Git replacement semantics were checked against the primary documentation:
https://git-scm.com/docs/git-replace .

## RF-REVIEW-02 — Expired owner could terminate retryable jobs

**Severity: medium for diagnostic job reliability. Fixed.**

`SmokeStore.fail` formerly matched a job ID and lease token but did not require a
running state and unexpired lease. If completion failed after lease expiry but
before reclamation, the old worker could turn a recoverable job into terminal
failure. `finish` correctly rejected the expired lease; the error path then
undermined that protection.

Failure now uses one conditional SQL update requiring current running state,
matching lease owner and valid lease time. It returns whether a transition
occurred; the existing worker safely ignores stale no-ops. Eight new native cases
cover expiry, reclamation, late owners, valid failure, replay, completed work,
the existing inclusive expiry boundary and the default clock. No money-moving
application logic or future domain state machine was introduced.

## RF-REVIEW-03 — Operational instructions were stale

**Severity: low. Fixed.**

The README still directed users to the original G05 branch, and later work records
said the reviewed source could not merge. README, PLANS, the integration ledger
and current-disposition banners now distinguish merged diagnostic source from
incomplete target qualification. Historical decisions and branch commits are
preserved. The npm runtime command explicitly includes the new native test file;
its reviewed command digest changes, but the dependency graph and lockfile do not.

## Reviewed boundaries and retained behavior

The source review covered all diagnostic API, worker, UI and persistence modules,
start/stop ownership, local HTTP authorization/origin checks, migrations,
reconciliation on attachment replay, test adapters, controller/evidence identity,
retention and current integration records. Existing tests exercised these paths.
The 565 baseline checks passed before changes. All original native test files,
case IDs, assertions, scenario definitions, model/agent boundaries, benchmark
denominators and full-goal acceptance records are retained unchanged.

The revised suite has 582 distinct cases: 502 Python/helper, 52 native runtime,
15 unit-harness, 7 database-harness and 6 browser-component checks. New cases
must fail with the corresponding old behavior and pass with the fixes. Fresh
candidate runs and restoration evidence are kept outside source, with exact
commit, controller hashes, native reports and exit codes in the delivery report.
No report is made to contain its own commit hash.

## Explicit protected changes

The old baseline is preserved and comparison is required before refresh. Protected
changes are limited to `GOVERNANCE.md` (the owner's prior local review exception),
`tools/test_harness.py` (the demonstrated source-integrity correction), and
`tests/fixtures/development/command-manifests.v1.json` (the npm command includes
all new runtime cases). The source-count oracle changes only its count/reason for
five added files; all its behavioral fields are unchanged. New test entries are
additive. No candidate-supplied approval bypass is added to the controller.

After reviewing this exact delta and the red/green evidence, the delegated
maintainer may export the fixed controller and a new local retained baseline from
the reviewed commit. This is a visible rebaseline decision, not an assertion that
the earlier protected-source comparison passed without review. Expected hashes
and reports are retained outside the candidate. Native code running with the same
OS user remains outside a hostile-process security boundary.

## Deliberately not represented as complete

The target React/PostgreSQL application, actual served target-browser journey,
container/OS egress isolation, production hardening and public distribution remain
unqualified. Local smoke egress denial is an application API control, not an OS
sandbox. Browser-component tests use synthetic responses. Type stripping is not
static TypeScript compilation. None of these limitations prevents integrating the
explicit diagnostic code as development work; none disappears because it merges.

The next engineering task is M00-G05 target-stack repair from current `main`, then
M00-G06 target tests. No further approval request or new governance framework is
needed to begin the already delegated engineering work. Keep missing external
observations explicit and do not mark the whole M00 milestone complete prematurely.
