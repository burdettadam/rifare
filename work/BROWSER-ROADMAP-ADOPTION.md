# M23–M25 browser roadmap adoption

## Assignment and scope

The owner requested the expanded milestones be integrated into the project and
decomposed into worker goals, with project decisions delegated to the maintainer.
[ADR-0044](../docs/decisions/0044-browser-roadmap-adoption.md) records the prior
authority, exact input identities, protected M14 base, permitted changes and
independent review requirements. This is a planning assignment, not an assignment
to implement or qualify a browser model.

Root owns `plan/M23-M25-roadmap`, source integration, planning checks and delivery.
A separate author owns `plan/M23-M25-goals` and the nine canonical JSON paths named
in ADR-0044. The author stopped writing after commit
`2fccb294bb548e56e9e108825c7dafebfea8ee45`; root merged that commit through native
Git. Separate nonauthor authority and regression reviewers inspect the combined
candidate and the actual evidence before local integration.

## Deliverable and worker dispatch

The canonical catalogue contains 26 milestones, 255 worker goals, 26 G99
assessments, 216 requirements and 949 unexecuted test specifications. M23–M25 add
15 workers, three assessments, 15 frozen requirements and 69 specifications.
Existing records, criteria, states, individual cards, accepted capability
objects, product code and actual M14 observations are preserved.

The [browser worker handoff](../docs/BROWSER-WORKER-HANDOFF.md) explains the three
milestones, prerequisites and recommended M23-G01–G05 browser batch. Every new
packet includes goal-specific steps, inspected existing paths, explicitly
proposed future paths, source case IDs, a bounded first verification slice and
handoff evidence. M15-G01 remains the earliest unassigned numerical sequence.
Every new goal remains unassigned, not started and not run; recommendation is
separate from assignment and formal acceptance.

The new [adoption record](../planning/browser-roadmap-adoption.json) binds the
original and revised same-named handoffs, protected source and resulting totals.
The three existing-goal clarifications are additive cross-references in
[browser-goal-crossrefs.json](../planning/browser-goal-crossrefs.json). They do
not rewrite the earlier goals or weaken their gates.

## Planning verification contract

The thirteen new tests in `tests/test_browser_plan_adoption.py` were committed
before changes to the validators. Root retained an actual red run against the
prior validators on candidate `38ddae172b59c48fe10d387d8da2c4bf7b17fe36`:
13 actual cases, eight failures, four errors, one pass. The expected gaps were
the missing frozen browser source/criterion controls and the missing closed
capability-target validator; the complete native output remains in the checkpoint
evidence rather than this source record.

The final focused selection consists of the complete `tests/test_plan_tools.py`
(30 cases) and `tests/test_browser_plan_adoption.py` (13 cases): 43 actual cases,
two whole files, one 60-second invocation deadline. Root also checks canonical
planning, local repository links/metadata, generated-view freshness and Git
whitespace. Independent preservation review covers the old records and cards,
both frozen additions, the exact 69 new source expectations, protected file
objects, runtime/test fixtures, native history and accepted-goal ledger.

The only inherited bookkeeping repairs are the closed 57-target catalogue
(54 preserved plus three proposed browser targets), three previously missing
helper registrations, registration of the 13 new helper cases, and additive
source inventory/count maintenance. The 69 browser specifications do not become
executable registrations or evidence of execution.

## Evidence, review and recovery

The accompanying checkpoint evidence records the actual final candidate/tree,
commands, exits, case totals, retained failures, preservation hashes, independent
reviews and local integration decision. Those candidate-bound records determine
the observed result; this source record does not pre-approve them. Authors and
reviewers execute no product imports, product tests, demos, model downloads or
browser inference for this adoption.

The cumulative project checkpoint retains the exact previous M14 archive, both
roadmap input revisions, source, actual adoption evidence and a native full-history
Git bundle with all retained refs. Its restore guide identifies the current
candidate and the separately remaining formal M14 and browser qualification.
No release, publication, hosted qualification or browser execution is authorized
or claimed by this planning integration.
