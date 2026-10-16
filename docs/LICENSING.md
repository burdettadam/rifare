# Rifare licensing proposal

Status: proposed for M00-G03; no owner decision, rights holder, public license grant,
external contribution intake or publication is asserted. Read
[ADR-0003](decisions/0003-licensing-and-distribution.md) and
[the machine-readable policy](../planning/licensing-policy.json).

## Proposed component policy

| Surface | Proposed terms | Current status |
| --- | --- | --- |
| Application and in-process business modules | AGPL-3.0-only | No application exists; owner decision required |
| Independently usable SDKs and protocol schemas | Apache-2.0 | No SDK exists; separation and owner decision required |
| Public workflow skills, platform guidance and synthetic templates | Apache-2.0 | Illustrative skills/configurations exist; not licensed by this proposal |
| Original developer helpers, tests and documentation | Apache-2.0 | Present; owner decision and rights review pending |
| Adapted upstream instructions | Preserve the upstream MIT portions and notices | Two instruction files are present; new local portions still need the owner's decision |
| Merchant-specific material | No inferred redistribution grant | Excluded from public source/package inputs |

AGPL-3.0-only is the proposed application option to retain reciprocal source duties
for covered modifications. Section 13 addresses a modified program used through a
network; it is not a promise that every external adapter or user data item becomes
covered source. Boundaries depend on the actual work and integration, not folder
names. Review source-delivery duties before enabling a hosted version. The
[official AGPL page](https://www.gnu.org/licenses/agpl-3.0.pt-br.html) contains the
English license text; the English endpoint timed out during this review.

Apache-2.0 is proposed for separately usable integration material and skills.
Keep applicable licenses, attributions and modification notices; retain a required
upstream NOTICE where one exists. A permissive SDK label cannot relicense copied
copyleft application code. [Apache's text](https://www.apache.org/licenses/LICENSE-2.0.txt)
is the source, not this summary.

A simpler alternative is Apache-2.0 for all original public material. Choose based
on desired reciprocity versus permissive reuse; this document does not select on
the owner's behalf. No extra noncommercial restriction is proposed. Dual licensing,
copyright assignment and commercial relicensing rights are not assumed.

## Inventory, not a fabricated dependency graph

[The component inventory](../planning/component-inventory.json) assigns every current
source file exactly once and separately records future surfaces and external tools.
No application manifest, dependency lockfile, vendored runtime, model weights,
font, image asset, executable initializer or SDK is included. Git and Python are
host requirements. The checkout action is referenced in the manual workflow,
not bundled. Redistributing any runtime/action/container requires a new inventory
and dependency review; the current source-only check cannot qualify that package.

`NOASSERTION` on original material records an unresolved licensing conclusion; it
is not a license or a public-domain dedication. All such material has an explicit
`internal_review_only` disposition and blocks public release. The adapted files
have an identified MIT upstream license plus pending local-change terms. The
source-only review can pass while public-release preflight correctly remains
blocked. [SPDX distinguishes declared and concluded licenses](https://spdx.github.io/spdx-spec/v2.3.1/package-information/).
This project-specific JSON is not an SPDX or CycloneDX SBOM.

New dependency manifests/lockfiles, containers, vendored binaries or undeclared
files require review, not a guessed permissive license. Do not label a dependency
first-party to bypass that work. The helper deliberately has no full package-manager
parser or license-compatibility solver. An unresolved third-party license is rejected.

## Contribution terms proposed for adoption

Use inbound-equals-outbound terms for the affected component and an explicitly
adopted [DCO 1.1](https://developercertificate.org/) provenance attestation.
Contributors retain their rights; this is not an assignment or a new right to
relicense other people's work. Do not retrospectively sign existing assistant
commits, impersonate a human signatory, or infer that generated code is free of
third-party obligations. Review employee/contractor rights and AI-assisted source
provenance as applicable. No external contributions should be solicited until
terms and the actual rights holder are approved.

## Decision still required

The owner must approve the exact component licenses, determine who can grant them,
confirm contribution terms and source-offer expectations, and authorize the actual
candidate and publication destination separately. Install authoritative, unmodified
license texts and scoped file attribution only after that decision. Obtain qualified
legal review where integration or rights questions need it. This is a development
proposal and mechanical audit, not legal advice or clearance.

REUSE may be adopted later for file metadata after licenses are chosen. Its own
[FAQ](https://reuse.software/faq/) explains that metadata checks do not decide
compatibility. Neither our helper nor a passing REUSE check substitutes for review.
