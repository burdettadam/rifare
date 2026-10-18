# ADR-0032: Focused tests during development

## Decision and authority

The owner directed: "Progressed has stopped. We need to run fewer regression
tests. Update environment to run fewer tests during development."
This subsequent environment change starts from the completed M07-G01–G05 local
checkpoint, commit `008834bbfecbc5103f16c3d6ed254104def13a41`.
The delegated maintainer applies that instruction to ordinary local feedback.
It changes development defaults and the frequency of broad checks; it grants
no new product acceptance, external effect or release authority.

## Implementation

`make`, `make test` and the editor's default test task select affected native
test files. The default plan is at most 60 cases across four whole files, with
one 60-second process deadline for the invocation. Explicit smoke runs the
54 retained money, skill-contract and dependency-intake cases. Selection uses
staged, unstaged and untracked paths, local imports and declared path mappings;
`--since` adds committed branch changes. Clean or unmatched work uses a clearly
labeled smoke fallback. Broad affected scope is recorded as deferred.

Browser wrappers, the adapter catalog and controller/harness tests that launch
nested runs need explicit selection. A full local diagnostic is available as
`make test-full`; the separately pinned acceptance controller remains governed
by its original requirements. Local development batches use focused tests and
focused review. Full regression, repeated fault campaigns and recovery audits
are explicit checkpoint activities, not automatic steps after every edit.

## Evidence and limits

The selector checks actual native results, required registered IDs, failures,
skips, duplicates and timeout propagation. Fresh logs remain under ignored
`evidence/development/`. New unregistered IDs are exploratory; static selection
cannot prove complete impact coverage. Dynamic case expansion is checked against
the budget and cannot produce a passing report above the selected limit.
Windows timeout cleanup is implemented but only the observed host is verified.

Six additive helper cases cover selection, whole-file budgets, smoke fallback,
native result rejection and actual child failure/timeout cleanup. The existing
2,538 registrations and all capability objects remain intact. The four new
source paths are assigned to the inventory and its count is advanced to 1,173.
The recorded tests for this environment change are focused development evidence;
the already completed M07 gate and its immutable handoff retain their own exact
source identity. No full regression rerun is required merely to adopt this
owner-requested development workflow.
