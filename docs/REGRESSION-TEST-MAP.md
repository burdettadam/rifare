# M00-G07 tests and evidence map

| Contract | Executable evidence |
| --- | --- |
| CASE-M00-G07-01 | `PinnedExecutionTests.test_CASE_M00_G07_01_retained_tests_and_addition_execute`: one retained native assertion plus one newly registered assertion, exact two-result inventory. |
| CASE-M00-G07-02 | `BaselineRetentionTests.test_CASE_M00_G07_02_candidate_cannot_drop_registration`, pinned-source/control cases, and `NativeAdapterTests`: removal, renaming, empty runs, skips, expected failures, stale/dirty identities and untrusted baseline attempts fail. |
| CASE-M00-G07-03 | `BaselineRetentionTests.test_CASE_M00_G07_03_same_count_tautological_assertion_requires_review`: same test ID/count but changed assertion bytes blocks before the candidate runs. Companion fixture-change and approval-text cases preserve this boundary. |
| INV-13 | External expected hashes, preserved test/capability mappings, no candidate approval override, exact native inventories and real source-identity checks. |

Run the goal's local tests with the native runner:

```sh
python3 -m unittest discover -s tests -p test_regression_gate.py -v
```

See [the gate guide](TRUSTED-REGRESSION-GATE.md) for the separately exported
controller. A successful local helper test is not a substitute for executing the
retained suites against the complete candidate. Raw results belong in ignored
or separately delivered evidence, never in source. Mutant runs must show the
expected behavioral assertion failure, not a broken import or absent tool.

The initial registration preserves native identity using suite namespaces. No
planned case is represented by a permanently skipped placeholder. Both the old
inventory helper and all prior native/harness test files remain unchanged.
