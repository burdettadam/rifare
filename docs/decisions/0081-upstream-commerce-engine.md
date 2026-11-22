# ADR-0081 — Adopt an upstream commerce engine

Status: owner-directed implementation; local development only.
Protected base: `698ad808baaa72b2dba4b46831bfb0608083293f`.
Branch: `feat/medusa-commerce`.

## Authority and decision

The owner requested: “Replace what we can in rifare with Medusa, less code for
us to be liable for.” This supersedes further custom implementation of commodity
commerce in the earlier roadmap. Rifare remains the product; Medusa is its
commerce dependency. ElevenID remains the separately operated identity and trust
dependency. Source reuse reduces code we maintain; it is not a transfer of all
operational responsibility.

Assign **COMMERCE-ENGINE-01**: install a pinned Medusa v2 application under
`apps/commerce-backend`, use its PostgreSQL schema and upstream workflows, and
replace the target startup placeholder with the new local application. Reuse
upstream catalog, pricing, promotions, cart, tax, inventory, customer, order,
payment, fulfillment, return, exchange and order-edit behavior. Do not fork or
copy those engines into Rifare. Existing merchant platforms remain authoritative
where a merchant chooses them; this application is the selected Medusa profile.

The existing SQLite owners and synthetic fixtures are retained as diagnostic
regression contracts. They are not a second live commerce store or an implicit
fallback. The synchronous preview/currentness contract must not be weakened by
substituting an asynchronous HTTP result. The ElevenID command, receipt, current
authorization, approval and uncertain-outcome safeguards remain intact until a
separate tested bridge replaces their fixture assumptions.

## Bounded implementation

Root is the sole writer of the application, tests, configuration, documentation
and controls in this branch. The assignment permits a separately pinned npm
workspace, an exact lockfile, build/cache ignores, a strict dependency intake for
that workspace, source-inventory additions, and target-launcher changes. Root
diagnostic package/lock inputs, all existing tests, frozen oracles, native
registrations, acceptance ledger and delegated-use code remain unchanged.

During implementation, the unchanged CFG fixture copier was observed copying
the newly installed npm tree and private local configuration recursively; its
first case exceeded the normal 60-second budget. Permit one narrowly scoped
fixture-helper correction before continuing: exclude only installed dependencies,
Medusa/cache outputs and private dotenv files from fixture copies, while retaining
all source, test assertions and synthetic examples. This prevents runtime artifacts
and credentials from becoming test inputs; it does not skip or change a case.

The first dependency audit found GHSA-2g4f-4pwh-qvx6 through Ajv 8.13.0.
Permit a pinned same-major Ajv 8.20.0 override, followed by fresh build, migration
and workflow evidence. The automatic audit-fix proposal instead downgraded several
transitive tools and was not applied. Remove the override when the upstream graph
selects a patched version normally; retain it explicitly in dependency review.

Use Medusa 2.23.0 and its maintained workflows through public package exports.
Pin direct dependencies and preserve registry integrity for the transitive graph.
Install without lifecycle scripts; inspect any needed build step explicitly.
Medusa's current built-in OIDC SSO and RBAC are separately licensed Enterprise
features. Do not configure them, copy their implementations, or disable their
license controls. Generic commerce/auth extension APIs remain separately usable.

The first runnable profile is local-only and requires explicit database and
session secrets. It binds to loopback, uses one isolated database per merchant,
disables telemetry, and does not install real payment, messaging or shipping
providers. Sales channels do not claim cross-merchant isolation. Production
startup remains blocked pending identity integration and deployment qualification.

Use real disposable PostgreSQL and Medusa for a focused behavioral verification:
create catalog and inventory, calculate cart/pricing/promotion/tax values upstream,
complete a synthetic-payment cart through the upstream workflow, observe stock
reservation/order records, and exercise supported post-purchase operations.
Demonstrate that missing configuration fails closed and no synthetic SQLite
fallback is used. Record failures honestly; mock tests do not qualify Medusa.

Independent authority/security and regression reviewers assess the fixed source
and actual evidence. At most three corrective rounds apply. Normal Rifare focused
test limits remain; the new application integration run has its own explicit
bounded timeout because framework/database startup is outside the old harness.
Neither installation, a local build nor a green integration run accepts a release.

## Identity boundary

Authentication proves who a person or machine is; commerce authorization decides
which action is allowed on current merchant data. Keeping ElevenID focused on
identity permits authentication/federation while reusing its existing Keycloak
or external OIDC foundation. Do not build a new password, passkey or OIDC issuer
inside Rifare or Marty for this migration.

The next identity contract must specify the actual issuer/client, verified
issuer-plus-subject binding, customer versus operator versus machine association,
organization provisioning/removal, account linking, session lifetime and logout,
revocation and key rotation. Marty application login and credential-issuance
discovery do not themselves establish this external-application contract.
ElevenID identity/delegation evidence never independently permits a purchase or
refund. Rifare/Medusa enforce commerce policy and effects at the action boundary.

## Continuation and retained limits

Prioritize mapping existing workflows to upstream features and deleting a custom
implementation only after equivalent retained behavior runs through its replacement.
Returns, exchanges, edits and loyalty are reuse candidates too; they are not
automatically unique Rifare functionality. Continue public delegated-use work only
against the new commerce-source design; C6 remains an assigned, unimplemented
contract rather than a completed migration.

No production migration, remote database, paid service, real financial effect,
default-branch merge, release tag or hosted CI dispatch is authorized by this
local assignment. Existing authorization to publish development branches applies.

Primary dependency references:

- [Medusa 2.23.0 source](https://github.com/medusajs/medusa/tree/v2.23.0)
- [Commerce modules](https://docs.medusajs.com/resources/commerce-modules)
- [Core versus Enterprise terms](https://github.com/medusajs/medusa/blob/v2.23.0/ENTERPRISE-LICENSE.md)
- [Custom authentication extension](https://docs.medusajs.com/resources/references/auth/provider)
