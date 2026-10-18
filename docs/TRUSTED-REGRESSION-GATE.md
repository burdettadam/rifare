# Trusted regression gate

## Scope and trust boundary

M00-G07 implements a read-only regression controller, not a scheduler or release
service. The retained registration identifies 408 existing runnable checks: 289
accepted bootstrap checks and 119 unaccepted diagnostic checks. It does not claim
that the 676 planned commerce scenarios have executed. Additional M00-G07 checks
are proposed obligations, not accepted product features.

An ordinary candidate-owned script can be edited to return success. The release
or integration controller must instead obtain the verifier and baseline from a
separately trusted source. This implementation exports exact Git blobs at full
commit pins to an external directory. The caller retains the controller digest,
baseline digest and commit identities outside the candidate. Running the gate from
inside the candidate is refused. Branch names are not immutable pins.

A digest proves identity only relative to a trustworthy expected value. Copying
pins from an untrusted candidate's output does not establish trust. This local
repository has no remote protections, signed attestations or separate reviewer
identity system. Same-user filesystem permissions are not a hostile-worker
sandbox. A production controller must protect its executable, pins, result storage
and verification environment from the candidate, and run untrusted native tests
in an appropriately isolated worker with no release credentials. This checkpoint
exercises that interface locally; it does not establish such hosted protections.

## Export and run

Use full reviewed source and baseline commit IDs from the integration owner's
retained records. The initial registration commit is
`101e721784299f7911d950196e961a2b1ea39edc`. It predates controller implementation,
keeps all prior runnable IDs, and does not accept M00-G05 or M00-G06.

```sh
# From the Rifare worktree, substitute the actual reviewed source identity.
python3 tools/regression_gate.py export --root . \
  --source-commit FULL_REVIEWED_SOURCE_COMMIT \
  --baseline-commit 101e721784299f7911d950196e961a2b1ea39edc \
  --output ../Rifare-control
```

`export` writes the four pinned controller modules, `baseline.json`, and
`pins.json`. It reads immutable Git objects, not current working-file contents.
Export is packaging, not approval. Retain independently reviewed hashes before
using the next command; do not derive the expected hashes from files the candidate
can rewrite immediately before each run.

```sh
# Execute the separately retained controller, not tools inside the candidate.
python3 ../Rifare-control/regression_gate.py run --root . \
  --candidate-sha FULL_CANDIDATE_COMMIT \
  --baseline ../Rifare-control/baseline.json \
  --baseline-sha256 RETAINED_BASELINE_SHA256 \
  --controller-sha256 RETAINED_CONTROLLER_SHA256 \
  --output ../Rifare-regression-results
```

Use a fresh output directory. `run` verifies exact source bytes, full source
membership, baseline ancestry, controller and baseline pins, protected files,
retained registrations and native test results. It checks source and trust-input
identities again after execution. It never reads a candidate-authored approval or
uses a preexisting success report. There is no selector, skip, approve, force,
rebaseline-on-success or release option.

Routine iteration uses `python3 tools/dev_tests.py`, the bounded changed-file
profile described in `DEVELOPMENT.md`. The existing offline
`tools/verify.py --runtime --harness` remains available for explicit full local
diagnostics (`make test-full`). Its presence does not substitute for the external
controller or change any retained acceptance obligation.

## Permanent obligations and additions

`planning/regression-registry.json` maps namespace-qualified stable IDs to their
native IDs, source file, capability and qualification class. The controller runs
native Python unittest, Node runtime tests, unit/database harness layers, and the
browser component layer. Existing Node and browser adapters are reused; the new
unittest adapter emits actual native result records including setup errors,
subtest failures, skips and expected failures.

Every retained ID must still be registered with identical mapping and execute
successfully. Every newly registered ID must also execute; failures in additions
are not ignored. Unregistered native tests, duplicate IDs, zero/missing selections,
renaming, skips, expected failures, and failed native exits block the run. Namespace
qualification distinguishes the runtime's DB-01 from the harness's DB-01 without
reidentifying either underlying test.

New test files and capabilities may be registered without shrinking the baseline.
The report lists additions, but does not promote them to accepted status. Editing
an existing protected test file, even just to add a test, requires review because
its accepted assertions share that file. Prefer a new file for an independently
reviewable extension; do not move protected code to evade the check.

## Assertion and fixture changes

All retained test and fixture bytes, selected execution inputs, goal contracts,
policy definitions and acceptance records are protected. A change yields
`review_required_paths` and blocks before execution. Equal counts and IDs cannot
conceal a tautological assertion. This is deliberately conservative: a formatting
change can also require review; no semantic assertion-quality proof is claimed.

The only structural extension is ADR-0008's source-count fixture: its count must
match exact committed membership, every retained source path must remain, and all
other fixture fields must remain identical. The inventory explanation may change
to describe enumerated additions. No financial, authorization, benchmark or other
behavioral oracle uses this extension.

A justified protected change needs an independent regression/authority review,
its behavioral oracle, a specific broken-behavior demonstration, exact candidate
and baseline identities, and a separately retained new baseline adopted by the
integration owner. The candidate cannot authorize this through JSON. Until that
process occurs, the gate remains blocked. Removing a legitimate feature similarly
requires a reviewed retirement, not deletion of its tests from candidate files.

## Output and limitations

Each actual suite produces native XML, stdout/stderr and a structured layer result.
The final report records candidate/source, configuration, controller and baseline
hashes, commands, native result hashes, additions, errors and observed timestamps.
Missing browser dependencies fail rather than skip. The tested diagnostic browser
still uses synthetic responses; no served React/PostgreSQL journey is qualified.

Inherited credentials and preload options are removed for native subprocesses.
Output is scanned/redacted through the existing harness. Native tests are code;
these controls are not OS-level egress isolation or proof against a malicious test
process forging output or modifying and restoring a same-user file during a run.
Use independently protected execution infrastructure for that threat model.

`status: passed` means retained local obligations executed on the named source.
`goal_accepted` and `release_authorized` remain false. Formal goal acceptance,
independent reviews, target-stack qualification and future release approval stay
separate. No existing accepted-goal entry is changed by this goal.
