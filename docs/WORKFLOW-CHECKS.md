# Read-only workflow completion checks

## Default inspection

```sh
python3 tools/check_workflow.py --root .
python3 -m unittest discover -s tests -p test_workflow.py -v
```

The first command checks the declared instruction identities, goal mapping and
local workflow configuration. It is not acceptance and never executes an action.
`tools/verify.py` runs it alongside all existing checks and the permanent suite.

## Candidate-bound review

Copy [the checkpoint template](../templates/WORKFLOW-CHECKPOINT.json) into ignored
evidence and fill in actual source/base/configuration, author, command, run counts,
report digest and review references. The template deliberately fails. A separate
attestation index supplies the assignment snapshot, independently retained report
digest, review records, and any candidate-specific release approval.

Use a policy commit and policy digest supplied by the integration owner from the
accepted base, not a current candidate's claim about its own authority. A trusted
caller must also supply the attestation digest through a separate trustworthy
channel. Do not take both an approval file and its checksum from the author and
call that independent authentication.

```sh
python3 tools/check_workflow.py --root . \
  --checkpoint evidence/M00-G04/checkpoint.json \
  --policy-commit 39aa37cb38df3aec27131baa8e1a4263b187d067 \
  --policy-sha256 aac647c6c0b622a8864a31eebbc9abf1af8b111d9d3251609dbdc82830e50988 \
  --attestations evidence/M00-G04/attestations.json \
  --attestations-sha256 "$ATTESTATIONS_SHA256"
```

The CLI reads the policy from the exact Git commit, checks that it is an ancestor,
compares current policy bytes, verifies every source file against committed blobs,
resolves dependencies from that baseline's acceptance ledger, and computes the
current configuration digest. `ATTESTATIONS_SHA256` is a required external input,
not a value invented in the template. Missing inputs exit nonzero.

Each review and test result must bind candidate, base and configuration. Different
reviewer names sharing the author's session or a single review session do not
count. A removed role, stale candidate, changed configuration, missing/duplicate
writer, skipped/empty tests, known blocker or exhausted round limit blocks the
check. A public/tagged release additionally needs its exact tag/action/identity
binding; the bootstrap exception can never replace that approval.

## Delegation is not fabricated independence

Under ADR-0004, the current maintainer may use BOOTSTRAP-LOCAL-01 for the explicitly
listed planning/devex goals, solely for local integration. It replaces missing
independent reviews and nothing else. M00-G04 paths are allowlisted in the policy
**before** implementation. Unknown paths, later goals, product changes, stale
review records and failing checks remain blocked. An exception result reports
its basis and the number of actual review records, which may be zero.

The checker always reports `execution_authorized: false` and
`identity_authentication_performed: false`. A caller's trusted inputs are an
assumption, not something a local hash can prove. An author with write access to
Git/OS can bypass a local command; hosted protections, process isolation and
identity-backed attestations need separate adoption. This tool is a verifier,
not an agent orchestrator, semaphore, deployment system or authorization service.

## Permanent cases and honest limits

The executable `tests/test_workflow.py` binds CASE-M00-G04-01/-02/-03, exercises
native Git worktrees and synthetic loopback services, and tests release/review
faults. `scenarios.SYNTHETIC.json` contains fictitious identities and expected
bindings. No synthetic reviewer represents an actual independent review.

Fault injection must produce assertion failures for the relevant obligation.
Removing a regression review, reusing old approval, allowing two writers, or
turning a bootstrap exception into release authority must fail the corresponding
test. Imports, syntax errors and zero-case runs are not meaningful proof.
