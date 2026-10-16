# Source inventory and distribution review

The checker has no publishing, installation or license-grant operation. Commands
use Python 3.10+ standard library and Git, without provider calls or dependencies.
Run from the repository root. On Windows, use `py -3` or Python in Git Bash.

## Inventory and decision gate

```sh
python3 tools/check_distribution.py --root .
python3 tools/check_distribution.py --root . --public-release
python3 -m unittest discover -s tests -p test_distribution.py -v
```

The first command can pass a complete local review inventory. The second must exit
1 with `result: blocked` while the owner, licenses, contribution terms and required
reviews remain unresolved. `publication_authorized` and `legal_clearance` are always
false. A JSON approved flag, version bump or a passing test cannot supply authority.

The source inventory includes tracked files plus nonignored untracked files. It
rejects omissions, duplicate ownership, unknown components, unresolved third-party
licensing, missing/altered notices, dependency inputs not yet reviewed and changed
synthetic profiles. Adding source requires an explicit inventory mapping; no catch-all
rule automatically declares ownership or assigns an open-source license.

## Verify an exact clean source snapshot

Commit the candidate before creating the manifest. The following is an illustrative
local review sequence, not authorization to distribute or publish. Use an empty
owned staging directory and keep all generated outputs under ignored evidence.

```sh
mkdir -p evidence/M00-G03/source-stage
python3 tools/check_distribution.py --root . --emit-manifest > evidence/M00-G03/source-manifest.json
git archive --format=tar HEAD -o evidence/M00-G03/source.tar
tar -xf evidence/M00-G03/source.tar -C evidence/M00-G03/source-stage
python3 -c "from pathlib import Path; import hashlib; print(hashlib.sha256(Path('evidence/M00-G03/source-manifest.json').read_bytes()).hexdigest())"
# Record the printed digest in the review handoff; pass that retained value below.
python3 tools/check_distribution.py --root . --stage evidence/M00-G03/source-stage --manifest evidence/M00-G03/source-manifest.json --manifest-sha256 <retained-digest>
```

The checker requires exact membership and bytes, including notices, and rebuilds the
expected manifest from the clean source candidate. It rejects added hidden files,
path traversal, symlinks/hardlinks, different source revisions, changed bytes and
forged manifests that omit required members. It does not extract untrusted archives.
Inspect archive entry paths before extraction when the archive is not created from
your own reviewed Git tree. Never use a mutable served tree as acceptance evidence.

This source-only staging mode excludes `.git`, generated review evidence, binaries,
containers and downloaded packages. A local recovery ZIP/bundle that contains Git
history is a different artifact; it is not qualified for public distribution by this
command. Such a release needs history and independent privacy review. All source
checks operate on a stable, owned filesystem snapshot, not adversarial concurrent
writers; bind and retain the final artifact digest separately.

## Retained inventory comparison

Pass a previous inventory from an independently protected baseline and its retained
SHA-256. Missing hashes, changed bytes or any component/license/membership/notice
change are blocking review findings, including additions. A candidate-controlled
copy plus a freshly computed hash is not independent acceptance evidence.

```sh
python3 tools/check_distribution.py --root . --baseline <retained-inventory.json> --baseline-sha256 <retained-digest>
```

A legitimate update needs a reviewed inventory revision; do not teach the test to
accept weaker licensing or privacy rules merely to make a branch green. Frozen
policy/obligation fixtures are regression oracles, not authenticated owner decisions.
The previous accepted governance and independent review still govern their changes.

## Release checklist

The current proposal records nine unresolved requirements: accepted scope; owner and
rights-holder license decision; installed applicable texts/attribution; resolved
dependency/asset duties; exact artifact and source review; private-data/full-history
review; contribution terms; independent reviews; and separately authorized publication.
A metadata pass cannot verify all of these. No remote, tag or external intake is added.

When actual packages appear, inventory direct/transitive and optional dependencies,
vendored files, build outputs, base-image/OS packages, fonts, documentation assets,
model weights and protocol assets for each shipping artifact. Inspect actual licenses
and notices rather than registry strings alone. Preserve modified-file notices and
source offers where required. Pin revisions, record provenance and qualify the exact
built artifact. That work is blocked rather than silently skipped in this checkpoint.

## Test bindings

`CASE-M00-G03-01` binds to the exhaustive source inventory and a staged-source fixture;
first-party grant selection remains an owner prerequisite to final public qualification.
`CASE-M00-G03-02` binds to unknown-license and private-profile injection rejection.
`CASE-M00-G03-03` binds to removed notices and blocking retained-inventory diffs.
The helper tests do not replace the actual human license decision in the goal packet.
