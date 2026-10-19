# Extension qualification preparation

M12-G07 has an external qualification requirement. This implementation prepares
and checks a local submission packet; it does not qualify a contributor or an
extension. The current licensing decision, rights holder, contribution intake
and public SDK publication remain unresolved. No outside contribution is
solicited and no new license grant, signoff or external review is recorded.

The assigned implementation is
`packages/security/extension-qualification.mts`, governed by
`packages/security/contracts/extension-qualification.v1.json`. Its output always
retains `independently_qualified: false`, `execution_authorized: false`,
`contribution_solicitation_authorized: false` and `publication_authorized: false`.

## Packet and current source checks

`assessExtensionQualification(packet, context)` accepts a bounded JSON packet
and separately supplied expected protocol and artifact digests. The artifact
digest is the SHA-256 of canonical JSON, as used by the extension inspector;
ordinary mirror installation separately binds the original encoded bytes.
The context root identifies a local source checkout. Submitted packet values
cannot select arbitrary SDK files.

The packet contains the artifact, exact SDK source pins, contributor attribution
reference, declared core changes and added privileges, tooling classification,
requested claim and review references. It calls the existing
`inspectExtensionArtifact` validator. Instruction packages therefore undergo
the real skill manifest, resource, action-contract, origin and artifact checks.
Host adapters remain descriptions of already present, source-pinned code.

The protocol requires these actual source surfaces: the skill loader,
instruction installer, manifest contract, adapter fixture engine, adapter
catalog, skill architecture, conformance documentation and current licensing
policy. Missing, reordered, duplicated or changed pins fail. An expected hash
must match actual local bytes. Updating a manifest hash does not create a
qualification result.

The inspector also checks actual fixture and source/test pin bytes. These pins
show the exact retained implementation and test requirements. **They are not
native execution reports.** This preparation function runs no nested test runner
and reports `native_conformance_observed: false`. The local instruction result
is `instruction_contract_only`; it establishes neither model quality nor a real
participant's ability to use the SDK.

## Independence and review

The following inputs add explicit blockers:

| Submitted condition | Blocker |
| --- | --- |
| Maintainer contribution presented for independent qualification | `MAINTAINER_CONTRIBUTION_NOT_INDEPENDENT` |
| An unsupported claim of independent external contribution | `INDEPENDENCE_CLAIM_UNVERIFIED` |
| Declared core changes | `PRIVATE_CORE_CHANGES` |
| Added privileges | `PRIVILEGE_WIDENING` |
| Private maintainer infrastructure | `PRIVATE_INFRASTRUCTURE` |

Empty declarations do not authenticate the complete core tree or contributor.
Contributor attribution digests and review references remain unverified
metadata. No submitted `approved` Boolean or reviewer object is an accepted
packet field. Even a structurally complete packet remains
`blocked_external_qualification`.

The output retains the required attributable external execution, separate native
conformance, independent security and regression review, and compatible-core
external rerun obligations. It also reads the actual current licensing policy
and records the missing rights/license, intake and publication decisions. The
module cannot adopt that policy or authorize contact with a contributor.

## Focused behavioral evidence

The three new cases in `tests/development/ecosystem-assurance.test.mts` have
distinct M12-G07 PREP identifiers. They cover valid local artifact inspection
without external qualification, rejected independence/privilege claims, changed
SDK/artifact bindings and retained test membership. Fixed expected results and
SDK pins were committed before this implementation under
`tests/fixtures/ecosystem-assurance/`.

The source contains test specifications until root runs the coherent integrated
candidate. Authors and reviewers run no duplicate product tests or imports.
The integration record supplies actual native results and two independent
review decisions; this document is not a pass report.

All original `CASE-M12-G07-01` through `CASE-M12-G07-03` remain unperformed.
M12-G06 and M07-G99 formal prerequisites remain blocked. A maintainer-authored
fixture or another authoring agent is not an independent external contribution.

## Storage and recovery

The assessor adds no tables, sessions, approvals, execution grants or network
operations. It reads only fixed local source paths and the explicit packet.
Reports contain hashes, classifications and blocker codes, not artifact content
or customer records. Caller-owned packets and reports remain caller-owned files;
they do not enter merchant backups, customer exports or approval restoration.
Repeating the assessment rechecks current bytes. There is no cached qualification
to revive after revocation, upgrade or restoration.
