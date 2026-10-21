# Commit-bound evidence gate

## Implemented scope

M00-G08 adds capture, verification and read-only acceptance checks for the current
local diagnostic source. It reuses the native regression controller and workflow
policy checker. No agent/model service, compiler, identity provider, daemon,
scheduler, package dependency, automatic merge or release command is introduced.
The original draft manifest/schema remain unchanged historical planning artifacts.
The executable capture uses [evidence-bundle.v1.schema.json](../planning/templates/evidence-bundle.v1.schema.json).

Three different results are deliberately separate:

- `captured`: a fresh native run completed, artifacts were inventoried and an
  external receipt was written last. No reviewers or acceptance are inferred.
- `verified`: source, configuration, receipt, artifacts and native execution
  inventories agree. This is evidence integrity, not goal acceptance.
- `checks_satisfied_not_accepted`: separately supplied review facts satisfy the
  existing workflow policy. The checker never writes an acceptance, merges a
  branch, grants a license, authorizes an external effect or creates a release.

All results keep `goal_accepted: false` and `release_authorized: false`.
The actual M00-G08 acceptance remains blocked by unaccepted M00-G06/M00-G07
prerequisites and missing independent reviews. Synthetic reviewer identities in
unit tests are not real project reviewers. Main and the acceptance ledger remain
unchanged.

## Trust model

The calling maintainer/control workflow must retain the reviewed verifier hash,
regression-baseline hash, request hash, receipt hash and review-index hash outside
the candidate's control. The corresponding files must be outside the candidate;
a receipt or review index inside the evidence bundle is also refused. Merely
copying the current hashes from an untrusted file does not establish trust.

The verifier export includes the seven fixed modules needed for evidence,
regression, native execution and workflow checks. It is read from immutable Git
objects. Export is packaging, not approval. Capture invokes the existing pinned
native controller for a fresh run; there is no import-a-green-report mode. The
controller's own report still calls its suite scope M00-G07. The request and capture
receipt bind that run to the actual work goal without relabeling the runner report.

An independently retained receipt hash prevents the candidate from altering both
an artifact and its expected digest. It is not a signature or identity certificate.
Local same-user files are not a security sandbox against hostile native code that
can modify controller state and restore it between observations. Trusted production
execution requires separately protected controllers, expected hashes, result storage,
review identities and OS-level isolation. These are not established here.

## Export from a reviewed source

Use full immutable commit IDs and fresh external directories. The baseline should
be a separately accepted or retained ancestor, not a candidate-controlled branch.
For this development checkpoint the preserved M00-G07 source supplies the retained
466-test baseline; its unaccepted diagnostic tests remain distinguishable from the
289 accepted-bootstrap tests.

```sh
# Ordinary source export; choose the actual reviewed source and baseline pins.
python3 tools/evidence_gate.py export --root . \
  --source-commit FULL_REVIEWED_COMMIT --output ../Rifare-evidence-control

python3 tools/regression_gate.py export --root . \
  --source-commit FULL_REVIEWED_COMMIT --baseline-commit FULL_RETAINED_BASELINE_COMMIT \
  --output ../Rifare-native-control
```

Retain the returned control and baseline hashes independently before running the
exported code. `Rifare-evidence-control` contains the same native controller modules;
its regression-controller digest must equal the one in the capture request. Use a
trusted Python process/environment; do not allow candidate-controlled import paths
or preload configuration to select the controller's dependencies.

## Prepare the capture request

The request is a strict `rifare-evidence-request-v1` JSON object with these fields:

| Field | Required meaning |
|---|---|
| `schema_version`, `kind` | Integer 1 and `rifare-evidence-request-v1`. |
| `goal_id` | Existing goal at the trusted base, such as M00-G08. |
| `candidate_sha`, `base_sha` | Full candidate commit and prior governing base. Both must exist; base must be an ancestor. |
| `writer_id`, `writer_session_id` | Actual assigned author/session, not fabricated reviewer identities. |
| `issued_at`, `expires_at` | Explicit timezone-bearing validity window chosen before execution. |
| `baseline_commit`, `baseline_sha256` | Independently retained native regression baseline. |
| `regression_controller_sha256` | Independently retained digest of the native controller modules. |
| `pins` | Exactly `skills`, `profiles`, `policies`, `adapters`, `models`, `runtimes`. |
| `supporting_files` | Relative path to SHA-256 map for the actual red/green, demonstration, handoff and supporting files. |
| `retention` | Named owner, `retain_until` timestamp and `cleanup: manual_after_decision_and_retained_references`. |

Each pin category has exactly `files` (relative source path to SHA-256), `settings`
(string-to-string map), and `not_applicable_reason` (null when used, otherwise a
specific reason with empty files/settings). Model and commerce adapters may be
explicitly unused by diagnostic checks. Runtime cannot be declared inapplicable;
policy files must include the governing workflow policy. Present package manifests
and lockfiles must be included in runtime source pins. The complete source tree is
also bound, independently of these more descriptive configuration categories.
Do not place model keys, customer data or credentials in settings.

The supporting directory must contain nonempty `red-green.md`, `demo.md` and
`handoff.md`. Additional files must be declared before capture. They must describe
actual observations, not synthetic claims of reviewers or external qualification.
Capture hashes and preserves these notes, but cannot prove the truth of prose or
that a screenshot depicts the claimed outcome. Review remains necessary.

Keep the request and supporting files outside source control. The request hash is
an external input to the capture. Never modify it afterward to make an old result
fit a new goal or configuration. A changed candidate, configuration or note means
a new request, fresh native run, new bundle and new receipt.

## Capture, verify and assess

```sh
# Run the separately retained executable, not a modifiable candidate wrapper.
python3 ../Rifare-evidence-control/evidence_gate.py capture --root . \
  --request ../capture-request.json --request-sha256 RETAINED_REQUEST_SHA256 \
  --baseline ../Rifare-native-control/baseline.json \
  --verifier-sha256 RETAINED_EVIDENCE_VERIFIER_SHA256 \
  --supporting ../capture-notes --bundle ../Rifare-evidence-bundle \
  --receipt ../capture-receipt.json

python3 ../Rifare-evidence-control/evidence_gate.py verify --root . \
  --request ../capture-request.json --request-sha256 RETAINED_REQUEST_SHA256 \
  --baseline ../Rifare-native-control/baseline.json \
  --verifier-sha256 RETAINED_EVIDENCE_VERIFIER_SHA256 \
  --bundle ../Rifare-evidence-bundle --receipt ../capture-receipt.json \
  --receipt-sha256 INDEPENDENTLY_RETAINED_RECEIPT_SHA256
```

Both commands reject evidence/control destinations inside the candidate. A failed
or interrupted capture leaves diagnostic output but no valid receipt. No overwrite,
force, approve or repin-on-success option exists. The actual command set and all
native XML/stdout/stderr remain in `run/`. Capture requires the existing browser
host tools when that layer is registered; missing tooling fails rather than skips.

For read-only acceptance assessment, run the same verification arguments with
`assess` instead of `verify`, plus `--attestations` and
`--attestations-sha256`. The index must be obtained from a protected review system
or authenticated maintainer process. This repository does not provide one.
An unavailable index or unresolved dependencies produces a blocked result; it is
not permission to populate synthetic production approvals.

The strict external index has `schema_version: 1`,
`kind: rifare-external-review-index-v1`, `evidence_manifest_sha256`, `request_sha256`,
`receipt_sha256`, `review_round`, `review_refs`, `reviews`, `assignments`, `blockers`,
`release_approval`, `intent`, and `tag`. Reviews use the existing workflow fields
(candidate/base/configuration, goal, reviewer identity/session, role, round, status,
blockers) plus exact evidence-manifest/receipt hashes and created/expiry timestamps.
Every indexed review must be referenced; a blocking review cannot be omitted.
Identities/sessions must be independent of the writer and one another. No bootstrap
exception is available through this evidence checker.

The policy and accepted-dependency ledger are loaded from the prior governing base,
not candidate-supplied flags. Tagged-release checking additionally needs a specifically
scoped human approval bound to the same evidence and timestamps. Even a successful
assessment is a checks result, not an executed release or acceptance decision.

## Source, build and native-run identity

The manifest records full source/base commits, Git tree, SHA-256 of actual tracked
source bytes and modes, configuration pins, capture environment, actual timestamps,
commands/exit codes, discovered/executed stable IDs and every artifact's bytes/hash.
Native reports are reparsed with the existing adapter, not accepted from summary
counts. Skips, missing/duplicate IDs, report/diagnostic changes and failure markers
block verification. Hidden `assume-unchanged` source edits are detected.

For this implementation the executed build is explicitly
`interpreted_source_not_compiled_artifact`, with the actual source SHA-256. No
compiled binary/container or React build is claimed. A compiled-build claim is
rejected until a separately qualified build pipeline establishes its artifact and
execution provenance. This is a deliberate boundary, not a substitute hash offered
as proof of an unperformed build.

The captured environment records Python and host identity; native executable paths
are in the commands. Dependency versions are retained in pinned source manifests
and lockfiles where present. This does not qualify an untested host. Verification
can run on a relocated checkout of the exact source without changing the historical
captured-worktree path; capture itself must use a clean exact root.

## Redaction, retention and recovery

Evidence allows regular single-link files only: no symlinks, hard links, FIFOs,
traversal paths, case-colliding artifact names, oversize files or unlisted content.
Native capture retains the earlier harness's credential suppression/redaction.
The evidence checker additionally rejects known canary/private-key/Bearer and
credential-assignment patterns. These are conservative tripwires, not a universal
PII/secret scanner. Inspect real evidence before sharing. Diagnostics never echo a
matched secret. Redact at the source and recapture; changing sealed bytes invalidates
their hashes and reviews.

Keep raw evidence in ignored storage while review is open. Retention must extend
past capture, and evidence expires when either its request or retention window ends.
There is intentionally no deletion command. Preserve the decision, exact pins and
required minimized raw records before a custodian manually removes owned output.
Expired evidence is historical, not current approval; run a new capture rather
than extending timestamps after the fact.

Git bundles contain source, not these external receipts and run records. For this
checkpoint the separately delivered evidence archive preserves them. No hosted
retention, signature or external backup is claimed. Roll back source using the
preserved prior goal branch; no database migration is added by this goal.

## Tests

```sh
python3 -m unittest discover -s tests -p test_evidence_gate.py -v
python3 tools/verify.py --runtime --harness
```

The tests create an actual temporary Git repository and run a one-assertion native
suite before exercising tampering. CASE-M00-G08-01 proves matching artifacts and
native IDs without automatic acceptance. CASE-M00-G08-02 rejects stale source/run/
configuration and artifact mutations. CASE-M00-G08-03 rejects copied goal identity,
changed receipt provenance and self-authored approval. Other cases cover unsafe
paths, output tampering, request expiry, review independence, missing dependencies,
source changes during inspection, and release-evidence binding. All synthetic
review identities remain explicitly test fixtures.
