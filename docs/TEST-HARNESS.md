# Rifare deterministic diagnostic test harness

M00-G06 implements ordinary native test execution for the existing diagnostic
profile. It does not qualify PostgreSQL, React, real merchant tenancy, payment
providers, a served browser journey, or a production network sandbox. Full
M00-G05 acceptance and independent review remain prerequisites for full M00-G06
acceptance. ADR-0007 authorizes preparatory implementation only.

## Actual commands

From a source checkout with Git, Python 3.10+ and the Node runtime documented in
`LOCAL-ENVIRONMENT.md`:

```sh
python3 tools/test_harness.py --layer unit
python3 tools/test_harness.py --layer database
python3 tools/test_harness.py --layer browser
python3 tools/test_harness.py --layer all --reverse
python3 tools/verify.py --runtime --harness
```

Unit/database execution uses Node's built-in runner and SQLite. No npm packages
were added; the original package, lock, command pins and scripts are unchanged.
Browser execution uses Python unittest plus the **host-installed Playwright
1.57.0** and Chromium. It fails rather than skips when these are unavailable.
An explicit browser can be selected with `--browser-executable /path/to/chromium`.
The observed browser was Chromium 144.0.7559.96 on Linux; no other host has been
qualified. Neither Playwright, its transitive packages, nor browser binaries are
bundled. Clean installation of that external toolchain is not established here.

Browser cases mount the repository's HTML and JavaScript in a fresh browser
context, load the repository CSS, and substitute a synthetic fetch boundary.
They do not navigate to a served application, relax managed browser policy, or
claim real API/worker success. Every other browser request is aborted and causes
test failure. Service workers are blocked, and unexpected WebSockets are rejected.
The stored screenshot is diagnostic visual evidence, not a screenshot baseline.

For fixed-candidate evidence, commit the intended changes first and use:

```sh
python3 tools/test_harness.py --layer all --require-clean \
  --output evidence/M00-G06/my-candidate-run
```

Output directories must be new, beneath ignored `evidence/` or `test-results/`.
An existing directory is never overwritten. The source checker compares actual
file bytes with Git objects, including files hidden by Git status flags. It also
checks for source changes during execution. Local dirty runs are explicitly
exploratory unless `--require-clean` rejects them.

## Deterministic inputs

`tests/fixtures/harness/seed.v1.json` defines a fixed epoch, two synthetic merchants,
and colliding record/job IDs with different values. Every use gets a fresh frozen
copy. `expected.v1.json` holds independent named facts and a precomputed seed-7
unsigned-integer vector. The fixture and oracle byte hashes are in the test
manifest. Changed or missing pins fail before executing the tests.

Seeded randomness is only for reproducible test inputs, never credentials. Unit
and database cases use native Date mocking; the browser uses its fixed-time API.
Resource identities, lease UUIDs, process IDs, execution timestamps and temporary
paths intentionally differ. Tests assert the explicit stable projection of the
facts, not byte equality of those intentionally unique execution fields.

Each SQLite fixture has its own temporary database, migrations, instance identity
and attachment directory. Cleanup removes only that fixture. Two synthetic
merchants are **test data**, not an implemented commerce multi-tenant boundary.
Reversing declarations uses Node's native test runner, not another scheduler.
The reverse option also reverses layer and browser-case order.

The in-memory fake provider supports success, rejection, failure before acceptance,
and acceptance followed by response loss. Its accepted ledger is independent of
what the caller receives. Reusing the same key/payload is idempotent, another
merchant can use the same key, and changing the payload is rejected. All effects
are synthetic; an accepted fake receipt is not a financial settlement.

## Failing rather than appearing green

The thin adapter executes native runners; it does not schedule goals or replace
those runners. It compares native executed IDs with the declared nonempty layer
inventory. Missing/extra/duplicate IDs, errors, skipped/todo cases, inconsistent
counts, failed exits and incomplete XML all fail. A narrowed test selection cannot
be passed off as the whole layer.

```sh
# Expected failure: no required cases match; this is not a passing smoke test.
python3 tools/test_harness.py --layer unit --test-name-pattern NO_MATCH_AT_ALL
```

Both JUnit and TAP are captured for Node. JUnit alone drops console diagnostics,
so it would be insufficient for output-leak detection. The adapter scans both
channels before retaining redacted copies. Leaking the injected synthetic secret
canary, or an exact inherited sensitive-environment value known to the adapter,
fails even when assertions pass. This is not universal data-loss prevention.

Test subprocesses receive an allowlisted environment and fresh home/temp paths.
Provider keys, database URLs, proxy variables, Python paths and Node preload
options are not forwarded. A synthetic canary is deliberately injected for
negative tests, not a real credential. Node's fetch, HTTP/TLS/TCP, DNS and datagram
paths are denied by a preload guard; a caught attempt still makes the process
fail. Arbitrary native code or a deliberately replaced guard is **not** contained
by these application-level controls. Container/OS network isolation is still
unqualified. The owner-scoped timeout cleanup is exercised on Linux; Windows
process-tree cleanup is not qualified.

## Native evidence and regression scope

Each run keeps sanitized JUnit, TAP/diagnostics, hashes, case IDs, candidate/source
identity, seed/oracle pins, start/end times and actual exit status. Browser reports
name the observed browser version and the component-only qualification. Repeated
runs compare stable case IDs and fixed facts; durations are not expected equal.

These are proposed executable contracts, not an authenticated accepted baseline.
A worker can edit its own source, so a local report alone cannot authenticate a
review, authorize a release, or prevent malicious replacement of both a test and
its expectation. The protected accepted-baseline integration is a separate goal;
retain these tests and obtain the required reviews before promoting their status.

## Case mapping

| Original obligation | Executable evidence |
| --- | --- |
| CASE-M00-G06-01 | Native unit clock/seed case, SQLite clean-seed case, and Chromium source-render case; repeat all layers. |
| CASE-M00-G06-02 | Native-process probe tests for zero matches, caught network attempts, inherited environment stripping and leaked canaries; browser failures are visible. |
| CASE-M00-G06-03 | Reversed declaration/layer/browser order, reversed merchant seeding, isolated fixture cleanup, and two actual linked-worktree runs. |

Meta-tests live in `tests/test_native_harness.py`. Unit and database contracts live
under `tests/harness/`; browser tests live in `tests/browser/component.py`. The
existing 44 runtime cases and all prior helper assertions are retained unchanged.
The 676 planned commerce scenarios remain specifications.

## Primary implementation references

- [Node native test runner and reporters](https://nodejs.org/api/test.html)
- [Playwright request handling and aborts](https://playwright.dev/python/docs/network)
- [Playwright page content API](https://playwright.dev/python/docs/api/class-page#page-set-content)

These references describe the tools. Only the delivered candidate's actual test
results establish what was observed here.
