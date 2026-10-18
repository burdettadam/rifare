# ADR-0041: M12 agency and extension development through milestone assessment

## Assignment and retained authority

The owner requested "Continue with goals until next milestone" after the reviewed
M11 checkpoint. Under ADR-0004 the delegated maintainer assigns the bounded local
work for **M12-G01 through G08, G09's explicit deferred/disabled alternative, and
the M12-G99 assessment**. Protected main is
`e36dbcd7cf392d04f21d082e834698bbc6a1ac79`, tree
`38e48fd2f25a7268ea74904c9339e0e8225c4203`. The cumulative predecessor is
`Rifare-M11-inventory-procurement.zip`, SHA256
`d9844b24608602db3ff20cd3990744c2a3c0f1ec12a69f731d2c002fa320d97a`.

This assigns local development and decision/qualification preparation. It does
not accept the still-blocked M07-G99 prerequisite, original worker goals, an
independent contribution, human licensing/governance adoption or agent code
execution. G06, G07 and G08 use distinct PREP claims where their original human
or external evidence is absent. G09 remains deferred with code mode disabled,
as its original outcome expressly permits. Original G99 demonstration, criteria,
cases and dependencies remain intact. M13 is not assigned.

Native isolated worktrees, local source commits, bounded checks, two independent
reviews, local nonrelease integration and cumulative handoff packaging are
authorized. Publication, tags, account administration, contacts, solicitation,
contracts, real commerce effects, paid models and production are not authorized.
The current licensing policy and acceptance ledger remain byte-exact. No actor,
agent, manifest, checksum or synthetic fixture can create external rights,
contributor independence, authenticated human approval or observed conformance.

## One writer per worktree and concrete allowed paths

Root owns the integration branch and shared files. Authors branch from the
committed assignment, write only their paths, commit tests/independent fixtures
before implementation, and hand off exact commits. Authors and reviewers execute
zero product modules, imports, tests or demos. Root owns integrated corrections
after author handoff. Native Git remains the workflow.

| Owner | Goals and allowed paths |
| --- | --- |
| Agency author | G01-G03: new `packages/commerce/{agency-access,shared-templates,agency-reports,agency-privacy}.mts`, `packages/commerce/contracts/{agency-access,shared-templates,agency-reports}.v1.json`, `migrations/commerce/045_agencies.sql`, `tests/development/{agency-operations.test,agency-operations-helpers}.mts`, `tests/fixtures/agencies/`, `docs/AGENCY-OPERATIONS.md`, G01-G03 work records. |
| Extension author | G04-G06 PREP: new `packages/commerce/{extension-artifacts,extension-compatibility,extension-lifecycle,extension-privacy}.mts`, `packages/commerce/contracts/extensions.v1.json`, `migrations/commerce/046_ecosystem_extensions.sql`, `tests/development/{extensions.test,extensions-helpers}.mts`, `tests/fixtures/extensions/`, `docs/EXTENSIONS.md`, `docs/EXTENSION-GOVERNANCE.md`, G04-G06 work records. |
| Assurance author | G07/G08 PREP and G09 deferred: new `packages/security/{extension-qualification,code-execution-decision}.mts`, matching `packages/security/contracts/*.v1.json`, `tests/development/{ecosystem-assurance.test,ecosystem-assurance-helpers}.mts`, `tests/fixtures/ecosystem-assurance/`, `docs/EXTENSION-QUALIFICATION.md`, `docs/CODE-EXECUTION-ASSESSMENT.md`, G07-G09 work records. No database tables or runtime implementation. |
| Root | New `packages/commerce/ecosystem-privacy.mts`, `packages/commerce/contracts/storage-ecosystem-extension.v1.json`, `tests/development/ecosystem-privacy-helpers.mts`, frozen `tests/fixtures/ecosystem/storage-baseline.v1.json`; canonical privacy/import/restore/uninstall composition; one reserved local integration case in `extensions.test.mts` after handoff; metadata, documentation, G99/qualification/integration records, actual evidence and cumulative packaging. |

Root's permitted old source changes are exactly `README.md`, `PLANS.md`,
`packages/commerce/{privacy-lifecycle,merchant-portability,safe-recovery}.mts`,
`packages/commerce/contracts/privacy-storage-surfaces.v1.json`,
`planning/{component-inventory,regression-registry}.json`, the retained
`tests/development/{privacy-coverage,return-portability,installation-upgrade,adapter-catalog,compatibility-matrix}.test.mts`,
and `tests/fixtures/{conformance/{adapter-catalog,contract-cases,expected-coverage},licensing/artifact-oracle}.v1.json`.
These are additive integration and exact current schema/source hash metadata
changes; old case identities, assertions, fixtures and requirements remain.
Any other old source edit requires a concrete prior maintainer scope decision.
No kernel, permission, gateway, delivery, profile, case-pin, installer or release
implementation change is currently needed or assigned.

## Agency authority, templates and reports

Agency identity is descriptive metadata, never a global administrator or a
credential. Owner-only delegation uses current `authority.manage`, the canonical
membership and `Permissions.change` transaction. Explicit store-specific action
and resource subsets cannot delegate owner/authority, account, secret or budget
administration. Existing unrelated membership collisions are refused. Revocation
clears that store's canonical permissions and revokes its member sessions;
regranting cannot revive old sessions. All operational services keep their
existing current authorization and secret/resource scope checks.

The queued revocation proof uses actual `SupportDelivery`: it binds the original
session and rechecks that principal at final native send. A still-authorized
worker cannot send an agency-owned queued message after that agency grant is
revoked. Current agency action execution must also deny. Do not claim that every
operation separately approved and owned by another authorized principal is
canceled merely because an earlier proposer lost membership.

Shared templates are immutable, inert **presentation-only** manifests for tone
and locale. Publication does not mutate subscriber stores. A destination-store
offer binds the exact template digest, local profile and expected revision. A
current store owner explicitly accepts or rejects; accepted activation uses
`Profiles.put` and preserves all skill, action, data-scope, policy and authority
fields. Rollback writes a new increasing local revision restoring prior values.
Other stores and archived case/approval pins remain unchanged. Existing task
invalidation after a profile change remains. Arbitrary policy, secret, permission,
source or budget overrides are rejected.

Agency reporting calls actual scoped `SupportMetrics.report` and exposes a hard
allowlist of aggregate counts and explicit denominators. It validates current
per-store delegation on every refresh, excludes inaccessible stores, preserves
missing/pending/maturity denominators and requires store access for drilldown.
No aggregate cache is persisted. No customer/case/order/resource identifiers,
credentials, financial observations or declared cost rows are pooled or returned
in an aggregate. Each request uses the existing opaque per-store scopes.

## Pinned artifacts, compatibility and governance preparation

Local mirrors are bounded ordinary JSON artifacts bound to exact bytes, source
commit/content identity, owner/license/notices, immutable manifest, contract and
fixture/evidence pins. Unknown provenance/license, changed digest and incompatible
contracts fail before installation. A mutable tag is information, never execution
identity. Approved archived bytes remain usable without a vendor service. No
registry daemon, automatic network fetch, package manager, script hook or second
loader is introduced.

Instruction artifacts use real `SkillInstaller`, `Skills` and `SkillReleases`
validation, current scoped review, canary selection, rollback and revocation.
Local adapter preparation only describes already present source-pinned host
adapters from the retained catalog; it cannot install or execute arbitrary adapter
code. Contract evaluation is not model quality or external qualification. A
caller-supplied pass flag or reviewer name cannot create service approval.

Compatibility conservatively classifies exact before/after contract and profile
pins. Activation affects future work; in-flight cases retain their archived
skill/policy/adapter versions and original approval/effect identities. Breaking
changes require an explicitly reviewed named retain-pins/repreview strategy;
arbitrary executable migrations and mutation of pending approved amounts/actions
are refused. Explicit case migration uses existing `CaseConfigurations.migrate`,
which requires a new preview. Rollback retains history and never replays unknown
refunds, labels or messages; current recovery quarantine remains mandatory.

G06 prepares an enforceable proposal/review protocol for ownership, licensing,
security response, support, version notice, migration, export and retirement.
Claims bind actual contract/fixture/test/evidence versions and current service
authority. Retiring accepted actions while deleting protected tests, readers or
exports without the required reviewed transition must block. The protected
regression registry is an external baseline, not candidate-controlled acceptance.
No new license grant, contribution solicitation, DCO signoff or adopted human
policy is inferred from this local implementation.

## External qualification and optional code execution

G07 PREP binds the published-contract/SDK requirements, source/artifact/evidence
identity, actual local validator outcomes and review obligations. Maintainer-
authored fixtures, core forks, private infrastructure, privilege widening or
stale evidence cannot be presented as an independent contribution. Missing
attributable contributor and independent execution observations remain blocked.

G08 PREP records named typed workflow outcomes and independent expected results,
the unexecuted proposed-code alternative, threat/trust boundaries and proposed
resource/egress/gateway limits. Parity-only needs or ambient credentials/egress
reject the design. Otherwise the recommendation remains deferred pending an
explicit human decision. Changed need or boundary requires renewed review. No
caller Boolean can enable code mode. G09 remains disabled; exercise the existing
typed tool gateway's rejection of unknown code tools. Do not build a sandbox,
run arbitrary code or claim an adversarial runtime qualification campaign.

## Privacy, recovery and protected metadata

Every new table has tenant/store scope and an explicit storage surface/handling
contract. Aggregate/configuration/extension records accept no customer facts and
do not appear in unrelated customer exports. Repeated hash-only erasure reapplies
strict nested allowlists to remove arbitrary restored subject copies. Customer
erasure must not silently remove legitimate unrelated merchant history.

Import, restore and uninstall revoke new agency, template acceptance, extension
review/release and migration authority, including stores without tombstones.
Restored inert records do not recreate sessions, permissions or execution grants.
Original archived business semantics and uncertain effect identities remain
readable/reconcilable; recovery dispatches no effect. Source/caller copies retain
their existing explicit separate-cleanup limitations.

Protected baseline: 1,535 tracked paths, 2,933 registration objects, 185 capability
objects, 254 tables, 44 migrations, ten storage contracts, fifteen privacy
surfaces, 278 runtime source pins, 35 adapters, 196 operations, 231 declared native
IDs, 47 direct native fixture facts and 492 oracle pins. Preserve every old
member and byte-exact old storage contract/migration. Derive the new frozen
254-table projection from protected Git bytes before changing shared metadata;
retain all older frozen projections. Current table/migration/catalog counts and
source hashes may be maintained in the five named retained tests without changing
their case names/order or behavioral expectations. Generic/catalog JSON bounds,
accepted ledger, original planning/governance and licensing remain unchanged.

## Bounded evidence and milestone assessment

The planned focused selection is **44 actual cases**: 12 agency, 14 extension
(13 author cases and one root local integration case), nine assurance PREP and
the retained nine privacy cases. The owner-requested ceiling remains **60 actual
native cases, four whole files and one total 60-second deadline per invocation**.
No author/reviewer duplicate execution, nested catalog runner, full regression,
browser, controller, restoration or connected campaign is triggered by G99.

Each applicable original local obligation retains a stable case identity and
independent oracle. G06/G07/G08 PREP and G09 disabled checks use distinct identities;
their original human/external/conditional runtime cases remain unperformed. The
agency file retains TEST-002's later path and PORT-032; extensions retain PORT-023's
new migration/recovery path. A named targeted fault must alter real isolated
implementation behavior and fail a behavioral oracle, not an import or wrapper.

Root runs the coherent integrated candidate once, repeating only affected or
not-yet-run whole files for a concrete issue. Retain every native XML/TAP case,
failure, duration, source/configuration hash and actual invocation. Two fresh
nonauthor authority/security and regression reviewers inspect exact evidence
without product execution, with at most three corrective rounds. Carrying results
requires exact source deltas and both final review bindings.

The local integration demonstration installs a pinned synthetic instruction
extension, reviews requested permissions, canaries it in one store, accepts or
rejects a shared presentation template per store, preserves in-flight pins and
revokes one store without affecting the other. It is not the original community
extension qualification. G99 must explicitly retain its two original exit
criteria and unmet prerequisite/external/human/full-suite obligations. Root's
actual nonrelease integration decision remains separate from independent review
and formal milestone acceptance.
