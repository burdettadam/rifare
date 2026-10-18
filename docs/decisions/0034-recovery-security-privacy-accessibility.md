# ADR-0034: Recovery, security, privacy and accessibility development

## Prior assignment

The owner requested "Proceed with the next 5 goals" after the M07-G06–G10
checkpoint. Under the existing delegated local development authority, the
maintainer assigns M07-G11 through M07-G15 from clean main
`6dfd50853525c707138e52673c32ce71707f9ad4`. This assignment covers executable
development preparation and local nonrelease integration. The original goal
cards and blocked M05/M06 acceptance prerequisites remain unchanged. Local
measurements cannot establish connected-service, target-stack, approved hardware,
release, human screen-reader or independent-machine qualification.

## Ownership and boundaries

Each writer owns one native Git worktree. Root controls shared metadata,
registrations, inventory and integration. Existing implementations are extended
only where the assigned behavior requires it; original assertions and fixtures
are retained.

| Goals | Writer | Allowed implementation paths |
| --- | --- | --- |
| M07-G11, M07-G12 | Recovery/load worktree | New `packages/operations/recovery-rehearsal.mts`, `packages/operations/load-envelope.mts`, `tools/rehearse-recovery.mts`, `tools/measure-load.mts`, `tests/development/recovery-load.test.mts`, their new operations contract/fixture files, `docs/RECOVERY-LOAD.md`, and work records G11/G12. Minimal existing `packages/commerce/webhook-inbox.mts` and `apps/commerce-api/server.mts` changes may enforce transactional intake capacity and honest HTTP backpressure, preserving authentication, duplicate acknowledgement and current default behavior. |
| M07-G13 | Security worktree | New `packages/security/` release audit module/contracts, `tools/audit-release.mts`, `tests/development/release-security.test.mts`, `docs/RELEASE-SECURITY.md`, `SECURITY.md`, and G13 work record. Reuse existing distribution/inventory rules; do not relax them. |
| M07-G14 | Privacy worktree | New `packages/commerce/privacy-coverage.mts`, additional storage-surface contract, `tools/audit-privacy.mts`, `tests/development/privacy-coverage.test.mts`, `docs/PRIVACY-COVERAGE.md`, and G14 work record. Minimal existing `packages/commerce/privacy-lifecycle.mts` changes may close demonstrated missing erasure/export coverage while preserving old semantics and controls. |
| M07-G15 | Root integration worktree | Existing status, return, order-edit, execution, support and exception HTML/client surfaces under `apps/commerce-api/`; a shared accessibility client/CSS if needed; static asset allowlist only in `apps/commerce-api/server.mts`; `tests/development/accessibility-workflows.test.mts`, a bounded new browser fixture, `docs/ACCESSIBLE-WORKFLOWS.md`, and G15 work record. Preserve all API authority, confirmation and receipt semantics. Coordinate any shared server edit with recovery/load writer before mutation. |

The root may append registrations, five proposed capabilities and source inventory
entries and refresh only source hashes made stale by the specifically assigned,
reviewed source changes in the existing conformance declaration. The licensing
artifact source count may be updated to the actual tracked inventory. These
changes cannot alter fixture semantics, capability expectations, accepted
controls, package inputs, migration bytes or qualification thresholds. No new
commerce migration, service, worker scheduler or mandatory model dependency is
assigned. Old restoration, suppression, tenant and migration fences remain in
force. New coverage observations must fail closed on missing stores or evidence.

## Focused validation and review

Use at most four whole test files and 60 cases under a single 60-second default
development deadline. The planned selection combines recovery/load, security,
privacy and accessibility. Run tests once after coherent changes; another bounded
check requires a concrete failure or remaining risk. A small accessibility browser
check may be explicitly selected for the new UI behavior; this does not dispatch
the existing browser campaign. Full regression, nested catalog/controller runs,
repeated fault campaigns and multi-level restore audits are not batch defaults.
Keep concise source records and exact native observations in ignored evidence.

Separate nonauthor authority/security and regression reviews assess the final
candidate and close concrete findings. Local integration does not record formal
goal acceptance or change the acceptance ledger. Production access, paid services,
real payment or message effects, external publication and release tags are outside
this assignment.
