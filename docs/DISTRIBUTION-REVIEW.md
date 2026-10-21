# Source inventory and distribution review

The checker has no publishing, installation or license-grant operation. Commands
use Python 3.10+ standard library and Git, without provider calls or dependencies.
Run from the repository root. On Windows, use `py -3` or Python in Git Bash.

## Inventory and decision gate

```sh
python3 tools/check_distribution.py --root . --licenses  # current applied license scope
python3 tools/check_distribution.py --root .
python3 tools/check_distribution.py --root . --public-release
python3 -m unittest discover -s tests -p test_distribution.py -v
```

The `--licenses` command verifies the current owner-authorized license application,
installed texts, scope notice, DCO text, and retained upstream notice. It is also
included in the normal source-inventory check. Its output keeps original-material
scope and the limits of mechanical verification explicit.

`--public-release` still exits 1 with `result: blocked`: applying source licenses
does not accept a product release. `publication_authorized` and `legal_clearance`
remain false. The `public_release_blockers` field preserves the original M00
release contract, with an explicit historical basis; it is not a claim that the
owner has yet to select or apply these license terms. See `current_license_application`
for the current grant status. No JSON flag or version bump authenticates authority.

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

## Development dependencies and release duties

The root npm package remains dependency-free. The optional formatter in
`tools/formatting/` has its own pinned package/lock, with Prettier as the sole
development dependency. Its installed package, license, and bundled notices stay
outside this source archive. Changing either manifest requires another review.
The development-preview workflow references pinned checkout/setup-node Actions;
they are not copied into Rifare. The checker accepts only these reviewed paths
and exact references in addition to the original manual workflow.

The frozen proposal retains nine original release requirements. The owner has
now applied source licenses and contribution terms through ADR-0066, while exact
artifact/source review, private-data/full-history review, dependency/asset duties,
independent review, separate release authorization, and product qualification
remain requirements for the actual release being assessed. This task does not
turn a public source preview into a production release.

For future shipping packages, inventory direct/transitive and optional
dependencies, vendored files, build outputs, base images, fonts, model weights,
and media in the actual artifact. Preserve their applicable licenses, notices,
and source obligations. The source-only checker cannot qualify a new container,
installer, or hosted service through a metadata change.

## Test bindings

`CASE-M00-G03-01` binds to the exhaustive source inventory and a staged-source fixture;
the original owner-decision requirement remains in the historical release contract.
Current applied terms are verified separately under ADR-0066.
`CASE-M00-G03-02` binds to unknown-license and private-profile injection rejection.
`CASE-M00-G03-03` binds to removed notices and blocking retained-inventory diffs.
The helper tests do not authenticate the actual human instruction or replace
independent review. Scope/text/DCO mutation tests ensure that an arbitrary new
grant cannot be substituted for the reviewed application.
