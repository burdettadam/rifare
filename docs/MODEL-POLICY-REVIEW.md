# Model, evaluation and policy review

## Authority and scope

This review covers M01-G16, M01-G17, M01-G18, M02-G01 and M02-G02 under
ADR-0015 and the previously delegated local-development authority. The author
also performed the maintainer review; there were no independent reviewer
sessions. A local integration decision is not milestone or production acceptance.
M01 qualification remains explicitly blocked in `work/qualification/M01.json`.

## Findings and corrections

1. **Existing response compatibility.** The new permission layer changed a
   customer's inaccessible resource result from `NOT_FOUND` to `ACCESS_DENIED`.
   The retained native test caught it. The original non-disclosing result is
   preserved before the explicit action check; the original test was unchanged.
2. **Non-JSON evaluation facts.** JavaScript `NaN` values could be supplied on
   both sides of the comparison and count as correct despite serializing as
   `null`. A new test reproduced it. The evaluator now verifies JSON round-trip
   equivalence before accepting the suite or observations. Non-JSON values are
   rejected, not silently normalized.
3. **HTTP input wiring.** The runner's untrusted-input channel was not accepted
   by the existing HTTP assistance route. A real-loopback HTTP test demonstrated
   the mismatch. The route now accepts the optional typed input while retaining
   compatibility with its original one-field request. Unsupported attachments
   produce a handoff before any provider request.
4. **Incomplete permission adoption.** Skill deletion, simulator mutations and
   capability discovery originally retained only broad role checks. Three tests
   demonstrated that narrower permissions could be bypassed. Each operation now
   checks current action authority. Existing role names are not cached grants.
5. **Migration and asynchronous boundaries.** Explicit tests verify migration
   from the prior schema retains valid sessions; restriction of secret invocation
   during a provider operation is rechecked before the response is used.
6. **Exact arithmetic.** Independently specified fixtures and a fixed-seed
   quantity exercise check preservation of residual cents. Fraction residues
   represent signed post-allocation remainders, not pre-allocation fractions.

## Regression obligations

All prior test registrations, executable test sources, dependency manifests,
benchmark thresholds, goal contracts and original source paths are retained.
New test/fixture paths are added to the registry and inventory. The inventory's
source-count fixture is updated only for actual enumerated additions.

The new layer contains 115 tests: 20 local-model protocol tests, 17 hostile-input
tests, 21 evaluation tests, 23 role tests, 26 money tests, and 8 review regressions.
Per-goal totals, including review tests, are 20, 18, 22, 28 and 27 respectively.
No test is reclassified as live model or target-stack qualification.

Raw red/green output, retained-suite results, fault candidates, candidate commit
identity, controller pins and restore results are kept in the separate evidence
package rather than committed as self-authored approval records.

## Executed review proof

The unchanged retained controller from d32342c executed all 945 registered tests
against implementation commit 657b0c8: 502 Python, 415 runtime, 15 unit, 7 database
and 6 browser-component checks. There were no failures or skips. All 830 old
registrations and their 36 executable source files remained unchanged.

Five separate temporary Git worktrees held deliberately broken implementations.
The local model digest check, hostile-data instruction separation, factual scoring,
current action restriction and exact large-money conversion were individually
weakened. Each full corresponding new test file failed with an assertion error.
The faults were removed with their disposable worktrees; no mutated source was
merged. Earlier genuine review failures and the repaired tests are also retained.

## Remaining limitations

- The actual local probe found no installed service at the explicitly requested
  loopback endpoint. Wire fixtures validate adapter behavior, not model ability.
- A local hostname or digest does not prove the server has no external egress.
  Cloud disabling is an operator assertion; host network controls are separate.
- Untrusted text remains data and proposed calls pass server checks. Attachments
  are refused. This is not a universal prompt-injection or malicious-code sandbox.
- Evaluation correctness is relative to a separately reviewed, pinned suite.
  Imported observations are not authenticated proof of model performance.
- These are SQLite diagnostic permissions, not PostgreSQL qualification,
  enterprise identity federation, durable human approvals or a financial ledger.
- Exact money functions do not move funds, infer exchange rates or determine
  legally applicable tax rules. Their prior allocations must come from trusted
  records when integrated into later goals.

## Local integration decision

The reviewed diagnostic implementation is approved for local integration under
DELEGATED-LOCAL-06 on the observed suite and fault evidence above. Refresh the
externally retained baseline to include the 115 new obligations, then verify the
merged commit and restored distributions. Immutable pins and actual restoration
outcomes belong in the separate delivery report, not an invented review identity.
No full M01/M02 acceptance, public release, live payment, message delivery,
model download or hosted publication is authorized by this review.
