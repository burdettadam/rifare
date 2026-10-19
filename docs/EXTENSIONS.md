# Pinned local extensions and explicit version transitions

ADR-0041 assigns M12-G04/G05 local development and G06 governance preparation.
The extension facade uses the original Skills, SkillInstaller, Profiles,
SkillReleases and CaseConfigurations contracts. It does not install executable
packages, resolve a registry at runtime, start a scheduler, or grant action
permissions. M07-G99 and formal M12 qualification remain blocked.

## Artifact identity and inspection

`inspectExtensionArtifact` in `packages/commerce/extension-artifacts.mts` checks
the exact bounded JSON envelope, current SDK/engine/action requirements, declared
immutable source revision, content hash, ownership/support identifiers, known
license declaration, mirrored notice bytes and retained source/test/fixture pins.
`inspectPinnedExtensionArtifact` additionally checks the raw mirrored bytes against
the separately supplied SHA256 before parsing. `Extensions.stage` uses that path.

Instruction payloads are the original `rifare-instruction-bundle-v1` package and
manifest v2. Scripts, egress, extra files, changed resources, incompatible actions,
unsafe paths and package formats remain refused by the existing loader. A mirror
may be copied from ordinary Git releases or a package registry. No service needs
to be online while approved archived bytes are used. A mutable tag is never
resolved or substituted for the installed digest.

Host adapter artifacts are inert descriptors of already present catalog adapters.
Their source files, API version, selected operations and retained native case
membership must match the host. They cannot install arbitrary code or enable an
adapter/account. Unknown or unsupported host adapters remain unavailable.

The result distinguishes `instruction_contract_only` from
`retained_host_source_and_test_pins`. Test source hashes do not mean tests ran.
The inspector does not attest legal ownership, contributor independence, external
account conformance, model quality or production qualification. The source commit
is a declared immutable provenance reference bound to exact content; obtaining
and authenticating an external contributor's release remains G07 qualification.

## Store review and installation

Stage a mirror under current `skill.stage`. An independent current store actor
with `skill.approve` reviews the exact artifact; for instructions this creates an
actual original SkillInstaller approval bound to origin, bundle, version and
expiry. Operators cannot self-approve. An artifact review cannot widen the
manifest's required actions or the caller's permissions.

Initial installation requires current `skill.install` and `profile.write`, the
exact reviewed artifact, and the current profile revision. It installs through
SkillInstaller and writes one increasing profile revision using Profiles.put.
The only changed initial profile value is its approved skill digest. All actions,
data scope, tenant, store and profile identity remain unchanged. A second version
requires an explicit transition rather than another initial install.

`Extensions.get` and `installed` expose scoped metadata to operators/reviewers.
`exportArtifact` returns the inert, retained portable artifact even after local
revocation. Customer exports receive none of these merchant configuration or
review records.

## Compatibility and migration

`planTransition` binds the exact from/to artifacts, artifact approval, old profile,
expected revision, presentation changes and named strategy. Unchanged action,
engine, input, output and configuration contracts are compatible. Contract/schema
changes require a major version and `retain_pins_and_repreview`. Arbitrary
executable migrations, amounts, actions, permission fields or data-scope edits are
refused. Profile transitions allow only tone and locale plus the separately
reviewed skill digest.

An independent current `skill.review` actor reviews the stored plan. `activate`
rechecks that reviewer and the original artifact approval, current artifact/source
pins, current profile digest and revision inside one transaction. It installs
the new approved bundle and writes the next profile revision. Existing cases,
previews, approvals, operation IDs and native source state are never rewritten.

Existing cases continue using their archived skill/policy/adapter captures.
Explicitly moving a case uses the original `CaseConfigurations.migrate`, which
adds a new case revision and requires a new preview and approval. Existing
read-context tasks retain `TASK_CONTEXT_CHANGED` after a current profile update.

SkillReleases remains the release authority. After installation, stage, evaluate,
independently review and publish using its existing API to canary the version.
An existing release selection takes precedence over the profile's default skill
pin. Installing a version is not a claim that it was published or selected for a
particular case. The integration fixture provides `publishExtension` to exercise
those actual existing calls without replacing their checks.

`rollback` restores the old approved archived bundle and former profile values at
a new increasing revision. If a prior release was recorded and a new release was
published, it uses the original SkillReleases rollback and therefore also needs
current publication authority. An unrecorded release change blocks the rollback.
Cases already migrated to the new bundle retain their new archived configuration
after rollback; cases left on the former version retain their original pins.
Rollback does not restore an old database, erase transition history, or replay
refunds, labels, messages or unknown operations.

## Recovery and privacy

Migration 046 adds four scoped tables: artifacts, reviews, transitions and
retirement proposals. They contain merchant configuration, not customer facts.
Valid unrelated erasure leaves these records intact. Repeated hash-only erasure
reapplies field-specific ID, hash, enum, integer, Boolean and path allowlists,
including malformed strings and nested copies. Arbitrary copied artifact text
must retain its original artifact, payload, bundle, manifest-resource and notice
digests. Changed skill/resource bytes become a minimal inert artifact reference
with `revoked_privacy` state. Changed copied approval records lose authority.
Caller-owned mirrors, downloads, old backups and canonical previously archived
skill resources retain the existing explicit separate-cleanup limitations.

Import, restore and uninstall normalize every new table, even without tombstones.
Reviews, transition approvals and retirement approvals become revoked; artifact
rows become `revoked_restore`, with their prior state retained as history.
Canonical approval bindings are resolved before minimization from exact scoped
artifact version/digest and independently checked archived or staged bundles.
Only matching canonical skill/bundle/version/store approval IDs are revoked; a
malformed copied review pointer cannot spare its original approval. If both
copied bundle digests are malformed, the original semantic artifact ID, payload
content hash and normalized package origin allow the existing loader to recover
the exact candidate before cleanup. Other merchants and unrelated bundles,
including another bundle of the same skill, remain unchanged. Missing canonical references
after merchant import are tolerated.

The original case configuration and effect history remain stored and inspectable.
Revoked archived approval cannot authorize resume or execution. No copied session
or metadata creates fresh authority, and the original recovery quarantine and
old-operation replay guards remain mandatory.

## Focused evidence

The author committed thirteen native cases and their fixed synthetic oracle
before implementation. Root owns the reserved fourteenth integrated case and the
single coherent milestone invocation, within the unchanged 60-case/four-file/
60-second defaults. No author product module, test or demonstration was executed.
The planned file is `tests/development/extensions.test.mts`.

Three targeted faults alter actual isolated implementation: a missing raw mirror
digest check, a missing breaking-migration plan guard, and deleted retained test
membership. Their behavioral assertions run only in the root-owned native file.
G06 uses distinct PREP IDs. `M12-EXT-PORT-023` retains the later migration/recovery
path without claiming external restore qualification or blind queue replay.
