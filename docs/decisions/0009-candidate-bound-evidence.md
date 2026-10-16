# ADR-0009 — Candidate-bound evidence preparation

Status: delegated preparatory assignment, recorded before implementation.

The owner requested the next goal and retains delegated development decisions.
Assign M00-G08 on the preserved M00-G07 source at `c625daf`. M00-G05 through
M00-G07 remain unaccepted. This authorizes a bounded preparatory evidence checker,
not prerequisite acceptance, a new review exception, main integration or release.

Reuse the pinned native regression controller and existing workflow policy checker.
Capture a fresh native run under an externally pinned request; seal the resulting
files and candidate/configuration identity with a receipt held outside the candidate
and bundle. Check actual bytes and native inventories; a candidate-authored green
report or approval flag must never authenticate a run, reviewer or decision.
Independent expected hashes and identity provenance remain caller responsibilities.
No hosted identity service, signature authority or OS sandbox is implied.

Keep all original tests, goal criteria, fixture oracles, workflow policy, accepted
goal entries and prior source paths. Add registration for this goal's executable
checks. Extend the exact source-count fixture only for enumerated new paths, with
all its other fields unchanged, as already allowed in ADR-0008.

Own tools/evidence_gate.py, tests/test_evidence_gate.py, the new versioned evidence
schema, this decision and work record, documentation, and explicitly enumerated
inventory/registration additions. Existing draft templates remain historical.
No new model provider, package dependency, scheduler, commerce implementation,
external service, paid effect, production effect, hosted publication or M00-G99
execution. Actual missing reviews and qualifications remain blocked.
