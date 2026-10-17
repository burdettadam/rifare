# ADR-0025 — Execution budget for the cumulative diagnostic suite

The owner delegates maintainer decisions and local merges. Before changing the
runner, the expanded sequential native suite reached its unchanged 240-second
process timeout. An exploratory unbounded observation completed 1,303 native
cases in 263.94 seconds and exposed one genuine UI-ordering assertion failure;
that run is not counted as passing. The UI defect was fixed, not excluded.

Approve only these harness process-budget changes: `tools/test_runtime.py` and
`tools/regression_gate.py` native process limit 240 to 480 seconds;
`tools/verify.py` per-command limit 300 to 600 seconds. Existing per-operation
and browser/test deadlines, evidence validation, test count/identity, zero-skip
rules and product latency/load/quality benchmarks remain unchanged. No retry-until-
green or test exclusion is introduced. A timed-out run remains failed evidence.

The previous external controller must be retained and must flag these protected
path changes. After same-assistant delegated maintainer review and fault proof,
export a fresh controller and baseline pinned to the reviewed candidate and run
the entire old and new inventory. This is an explicit local control adoption,
not an independent reviewer attestation or milestone/public-release acceptance.

## Subsequent correction

[ADR-0026](0026-preserve-default-runtime-budget.md) supersedes only the standalone
default change after an unchanged regression test rejected it. Cumulative runs
use an explicit larger budget; standalone execution preserves 240 seconds.
