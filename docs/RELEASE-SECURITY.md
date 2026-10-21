# Offline release security and provenance

M07-G13 adds an executable audit for a **regular source directory** and its clean
Git candidate. It produces a machine-readable Rifare SBOM, declared license
inventory, exact source/artifact provenance, local pattern findings and validated
external scan observations. It preserves the existing distribution checker.
`result` remains `blocked`; `release_authorized`, `publication_authorized`,
`legal_clearance` and `vulnerability_clearance` remain false.

`local_checks: pass` means the bounded local checks passed. It does not accept the
goal, authenticate an external scan, resolve the existing license decisions or
authorize publication. Current dependency vulnerability data is neither bundled
nor fetched. The original M05/M06 dependencies and release qualifications remain
open. The test fixtures and reporting-policy example use no live account.

## Prepare and inspect one artifact

Use the supported Node executable and Python 3 standard library. The source
candidate must be committed, clean and exhaustively mapped in the existing source
inventory. Use an owned staging directory **outside** the source checkout and
materialize it with native `git archive` from the retained commit. Do not extract
untrusted archives through this tool. Source Git history and generated audit
evidence are separate from the inspected staging directory.

```sh
node --experimental-strip-types tools/audit-release.mts inventory /absolute/staged-source
node --experimental-strip-types tools/audit-release.mts audit /absolute/release-request.json
```

`inventory` reads the actual directory and prints file paths, sizes, SHA-256 hashes,
normalized executable modes and `artifact_sha256`; it performs no release review.
The digest is SHA-256 of canonical sorted JSON file rows, with object keys sorted
and no insignificant whitespace. Retain and review that digest independently.
It is a directory-content digest, not the checksum of a ZIP, tar or Git bundle.

An audit request has this shape; substitute actually retained pins:

```json
{
  "version": 1,
  "source_root": "/absolute/Rifare",
  "artifact_root": "/absolute/staged-source",
  "expected_source": {"commit": "40-lowercase-hex", "tree": "40-lowercase-hex"},
  "expected_artifact_sha256": "64-lowercase-hex",
  "reviewed_sbom": {"path": "/absolute/reviewed-sbom.json", "sha256": "64-lowercase-hex"},
  "scan_evidence": [{"path": "/absolute/sanitized-scan.json", "sha256": "64-lowercase-hex"}]
}
```

`reviewed_sbom` and `scan_evidence` may be absent for initial preparation; each
missing prerequisite is then reported. Retain the report's complete `sbom` object
before review and supply its separately retained file hash on subsequent audits.
The verifier recomputes the actual artifact SBOM, so a coherently rehashed SBOM
that omits a dependency, asset or obligation still fails. An audit command exits
**1** because release remains blocked; inspect `local_checks`, `findings` and
their scopes to distinguish a detected local fault from missing external rights.

The TypeScript API is `auditRelease(request)` in
`packages/security/release-audit.mts`. It invokes the fixed local Python driver;
the driver imports the executing checkout's unchanged distribution implementation.
It never executes a checker or package lifecycle script from the inspected
artifact. This is an observation tool, not an externally protected verifier.

## What is checked

- Source Git commit/tree, clean status, exact artifact membership, bytes and
  executable modes, retained artifact pin and stability across the observation.
- The unchanged distribution inventory, dependency-input restrictions, notice
  hashes, synthetic-example boundaries, component obligations and license policy.
- All distributed files, component declarations, npm manifests and v3 lock entries,
  including direct, development, optional, peer, nested and installed observations.
  Unlocked declarations remain visible as `NOASSERTION` versions. An installed
  package absent from the lock remains visible and blocks. All actual package
  graphs still require the existing separate dependency intake.
- Private/runtime paths, links, nonregular files, case collisions and a small
  pinned set of private-key, access-key and provider-token patterns. Findings name
  the path, rule and line; matching file content is withheld. No allowlist silently
  removes synthetic-looking matches from the scan.
- Exact reviewed SBOM bytes and content, external scan source/artifact/SBOM pins,
  full file and package coverage, timestamps, scanner/rule identities and findings.

The v1 SBOM is a Rifare JSON schema represented by the report's `sbom` object, not
an SPDX or CycloneDX certification. The artifact has no compilation step;
`build_executed: false` is explicit. Provenance distinguishes observed artifact
dependency materials from corresponding source materials, records driver/API/CLI,
distribution checker and contract hashes, and reports the Python runtime version.
It does not attest to a reproducible binary build or an independent builder.

## External scan evidence

The required kinds are `dependency_vulnerabilities` and `artifact_secrets`. Each
JSON object has exactly: `version: 1`, `kind`, `scanner` (`name`, `version`,
`rules_sha256`), integer Unix-millisecond `scanned_at`, `source_commit`,
`source_tree`, `artifact_sha256`, `sbom_sha256`, sorted exact `artifact_paths`,
sorted exact `package_ids`, `advisory_database` and `findings`.

Dependency evidence requires `advisory_database` with `sha256` and integer
`updated_at`; secret evidence uses null. Scan and advisory timestamps must be
within the fixed current 24-hour window and may not be in the future. Advisory
data may not postdate its scan. These are local evidence-consistency limits, not
an assertion that the claimed scanner or advisory source is truthful.

A finding has `id`, `severity` (`critical`, `high`, `medium`, `low`), `package_id`,
`path`, `state` (`open`, `resolved`, `mitigated`) and `closure_ref`. At least one of
the package/file subjects must exist in the actual inventory; the other may be
null. All critical/high findings block. An author-supplied resolved/mitigated flag
does not authenticate closure and remains blocked. Stale or mismatched reports
cannot establish current coverage, and their high findings are not suppressed.
Use sanitized evidence: free-text labels and reference fields are not a general
private-data redaction service.

## Threat boundaries and remaining work

The checker assumes stable owned filesystem snapshots and an intact running
verifier. It rejects links before reading and bounds the source/artifact to 20,000
files, 16 MiB per file and 128 MiB total; evidence is bounded to 8 MiB per file.
It does not isolate an adversarial concurrent writer, verify a privileged host,
review all source semantics or detect every credential/private-data format.
Filesystem ownership, ACLs, archive metadata, Git history, compiled images, base
OS packages, redistributed runtimes, model weights and live service configuration
need their own actual release review. Unknown inputs block instead of qualifying.

For a release, the existing owner/rights-holder license decisions, contribution
terms, complete corresponding artifact/source and private-history reviews, current
trusted scans, independent authority/regression decisions and a specifically scoped
owner publication decision remain required. No JSON field grants those rights.
Follow [security handling](../.github/SECURITY.md) for private reporting and the retained
[distribution review](DISTRIBUTION-REVIEW.md) for its governing source restrictions.

## Development evidence

`tests/development/release-security.test.mts` contains 12 bounded permanent cases,
including an actual CLI child and a staged vulnerable direct dependency omitted
from a deliberately broken reviewed SBOM. This mutates a temporary artifact and
review object, without altering accepted package inputs or oracle fixtures.
Run it through the focused development profile as part of the assigned four-file
selection. Current reports and independent reviews are supplied by the integration
owner; this document claims no full regression or external qualification.
