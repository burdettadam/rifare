# COMMERCE-ENGINE-01 — Upstream commerce application

State: **implemented and independently reviewed within the local development
scope; ready_for_review.** Formal product acceptance and production remain open.

| Identity | Value |
| --- | --- |
| Protected base | `698ad808baaa72b2dba4b46831bfb0608083293f` |
| Assignment commit | `f7efe55e7c298460a37d05630b6c257ae0d632c5` |
| Initial implementation / focused-regression candidate | `44e105fb6f0de907e88cfe5f22ca8e8c207375e6` |
| Corrected native-verification and review candidate | `167b9770f5b66eb5bea26fe6c1a159094c47f2fa` |
| Reviewed source tree | `435a58c11c36c4986a471a23ec07e3bb7bcd599d` |
| Published implementation | [`98ac90b`](https://github.com/burdettadam/rifare/commit/98ac90bfe36fc35766e6e36e5372a9902bdf7bac), same reviewed tree |
| Development branch | `feat/medusa-commerce` |
| Sole writer / integration owner | root |
| Assignment | [ADR-0081](../../docs/decisions/0081-upstream-commerce-engine.md) |

## Implemented boundary

The owner selected Medusa to replace commodity commerce and reduce custom code.
The old target launcher only refused startup; cart and checkout owners explicitly
bound synthetic sources. The new `apps/commerce-backend` application uses pinned
Medusa 2.23.0, real PostgreSQL, native workflows/APIs and upstream Admin. Root
`npm run dev` selects this installed/configured application without a diagnostic
fallback. The root diagnostic dependency manifests remain unchanged.

No new catalog, price calculator, cart database, stock counter or order engine was
written. Native workflows supply products, prices, promotions, taxes, carts,
stock/reservations, orders, fulfillment, returns, cancellation and payment records.
The [engine guide](../../docs/COMMERCE-ENGINE.md) maps reuse and current limits.

Public purchase, payment mutation, return, order/transfer and payment-hook routes
are held while the identity/approval bridge is unfinished. Catalog and guest-cart
preparation remain upstream behavior. Local operator authentication is explicitly
separate from ElevenID customer identity. The supported launcher binds loopback,
disables telemetry before CLI initialization and refuses ambient Cloud settings.
The local profile rejects production/staging and nonlocal database configuration.

ElevenID remains the identity/trust dependency. Read-only inspection confirmed
managed Keycloak or external OIDC authentication already exists in Marty. The
missing part is the qualified external application identity/client lifecycle and
the commerce action boundary described in the [identity contract](../../docs/IDENTITY-APPLICATION-CONTRACT.md).
No ElevenID repository was changed.

## Actual verification

Observed runtime: Node 24.22.3, npm 11.19.1, native PostgreSQL 17.12, Medusa 2.23.0.
The database was created solely for these synthetic tests, bound to loopback and
reset before each native invocation. The database and application ran in the same
owned process tree; the wrapper stopped the database afterwards.

| Evidence | Candidate | Observed result |
| --- | --- | --- |
| `evidence/commerce-engine/build-167b977.log` | `167b977` | Backend and upstream Admin frontend compile successfully. |
| `evidence/commerce-engine/native-167b977.log` | `167b977` | Fresh migrations and all **17 native workflow/check groups** pass. |
| `evidence/development/20261122T052634.125027Z-3491ec/report.json` | clean `44e105f` | **39 cases pass:** seven new configuration cases, 16 existing CFG cases, 16 existing checkout-preview cases; 4.460 seconds. |
| `evidence/development/20261122T052634.143088Z-1be107/report.json` | clean `44e105f` | **22 existing cases pass:** eight runtime-intake and 14 receipt-intake cases; 0.839 seconds. |
| `evidence/commerce-engine/fault-completion-hold-167b977.log` | isolated mutation of `167b977` | Expected behavioral failure: an actual native order is returned with HTTP 200 where the unchanged verifier requires 503. |
| `evidence/commerce-engine/dependency-audit-final.json` | same exact final lock | `npm audit --omit=dev --json` reports zero known vulnerabilities. |
| Distribution, repository, plan and generated-view reports ending `-167b977.json` | `167b977` | All pass within their declared structural/source scope. |

The seven new CFG cases remain exploratory rather than newly accepted catalog
entries. Neither focused report claims full regression or goal acceptance. Do not
combine the 17 native groups and 61 ordinary cases into one misleading case count.

The change from `44e105f` to `167b977` touches only the new native verifier and two
explanatory documents. Root and the independent regression reviewer verified
unchanged relevant configuration, helper, tests, validator, manifests and lock
bytes. The 61 cases are retained through that equivalence; they were not falsely
reported as rerun on the corrected candidate. The native run and build are fresh
on `167b977`. Closing status/work-record changes alter documentation only.

The native fixture verifies an independently calculated USD 30.25 total, exact
upstream price/tax/discount semantics, rejected caller price injection, insufficient
stock, no reservation on preparation, reservation on completion, original-order
reuse, fulfillment stock consumption, one received return unit restocked, a manual
partial-refund record and reservation release on cancellation. It also verifies
closed public action/read paths and unauthenticated Admin refusal. Loaded core
services must exist; Enterprise RBAC/audit must be unloaded and resolve undefined.
No real financial settlement, physical delivery, connected ElevenID session or
production durability is claimed.

Native run SHA-256:
`3b7d16e2002719f4b1278d63b7982a6d1d8a1e449e916152d76c94ce00e110d7`.
Fault log SHA-256:
`d1260a2b3ed082cbf788834fa2348805171b325e08a2f335ab0ee239d4772683`.
Raw evidence remains in ignored local `evidence/`; these source records preserve
the candidate, commands, results, hashes and review dispositions.

### Behavioral fault

The detached `rifare-medusa-guard-fault` checkout starts at `167b977`. Its only
product change removes the `/store/carts/:id/complete` hold. The verifier is
unchanged, SHA-256
`90670eed93146e9ca2d687526dadef6a32e0981583f61a43e3a6b0596fd3a982`.
The fixture first prepares a native payable cart. After successful fresh migration,
the actual public completion response contains an order and returns 200. The test
fails with `native_order_present=true` and `200 !== 503`. This demonstrates the
prohibited effect rather than a missing-payment, import or setup failure. The
reviewed product checkout remains unchanged.

### Corrections during development

- The original fixture copier recursively copied installed dependencies and private
  dotenv configuration, causing the initial 60-second CFG timeout. The assigned
  narrow helper fix excludes installed/generated/private artifacts only; all
  existing case assertions and synthetic examples remain unchanged.
- The first Admin build hit restricted network-interface enumeration in upstream
  automatic port selection. Supplying the supported explicit HMR port fixed it.
- Initial native probes exposed the tax-inclusive meaning of `discount_total` and
  the upstream serialized insufficient-inventory error shape. Independent amount
  and typed-error assertions were corrected; no accepted oracle was modified.
- The first dependency audit found the Ajv ReDoS advisory. The exact same-major
  8.20.0 override removes that reported finding; automatic tool downgrades were
  not applied. Fresh final migrations, build and workflows pass with the override.
- The first fixed-candidate native run failed because the new audit check treated
  a container placeholder as a loaded module. Installed upstream source showed
  unloaded services registered as `undefined`. The corrected check is stronger:
  actual installed/resolved core services, and unloaded/undefined RBAC and audit.

## Independent reviews

| Reviewer | Role and authorship | Final disposition on `167b977` |
| --- | --- | --- |
| `elevenid_identity_boundary` | Read-only authority/security reviewer; authored no code/tests and ran no tests. | No scoped blocker. Inspected actual native/fault/build evidence, route holds, Cloud/telemetry/loopback behavior, identity and license claims. |
| `medusa_replacement_audit` | Read-only regression reviewer; authored no code/tests and ran no tests. | No scoped blocker. Independently checked upstream workflow semantics, money oracle, retained-input equivalence and actual fault. |
| `postgres_runtime_setup` | Runtime preparation only, outside the repository. | Supplied disposable native PostgreSQL; neither product author nor product reviewer. |

Early authority findings led to expanded return/order/transfer/hook holds, explicit
Cloud exclusion and pre-CLI telemetry disablement. The fixed-candidate correction
changed the new module observation, followed by fresh native/build verification
and renewed reviews. The reviewer retracted a speculative HMR concern after
following the installed Vite host mapping; it was not silently treated as a defect.
No unresolved scoped blocker or exhausted corrective-round limit remains.

## Source and publication limits

The direct dependency manifest SHA-256 is
`9e55bffbb12cb3d65e9342584ede457b4553a8cadf252a387e4ec5aafb36d6b9`;
the npm lock SHA-256 is
`7f17da97236cf3ebe7f6c00203ce25e43b04e348321f3cedc3468268a43872f5`.
Install hooks remain disabled. The exact source intake covers the mixed upstream
core/Enterprise graph without granting Enterprise or distribution rights. No
Enterprise provider, RBAC or audit module is enabled and no license control is
changed. The audit result is an observation of this graph, not a perpetual guarantee.

Native HTTPS push lacked a credential helper. The authorized GitHub connector
published the exact reviewed tree as `98ac90b` on `feat/medusa-commerce`; commit
metadata differs from the native verification history, while the tree is identical.
Closing documentation is a descendant of that published implementation. No
default-branch merge, release tag, deployment, paid service or hosted CI dispatch
is part of this change. Commit messages retain `[skip ci]`.

No legacy commerce file is claimed deleted. Existing commerce/delegated-use owners,
root dependency inputs, test assertions, frozen expectations, registrations and
the acceptance ledger remain protected. The fixture-copy exclusion is the sole
legacy test-helper change. No saved synthetic observation is relabeled as a live
Medusa snapshot, and no asynchronous remote read replaces the synchronous final
currentness guard.

## Next bounded work

1. Qualify the actual ElevenID/Rifare issuer and client, verified issuer-plus-subject
   account/merchant/actor mapping, safe linking and complete session/removal/logout
   lifecycle. Reuse maintained authentication infrastructure.
2. Implement the production Medusa cart/approval/original-operation bridge, including
   exact major/minor amount conversion where required, payment-session/approved-total
   equality, current action authorization and uncertain-outcome reconciliation.
3. Map retained returns, exchanges, order edits and other scenarios to upstream
   behavior; delete obsolete custom implementations after callers/scenarios migrate.
4. Qualify served Admin/browser behavior, durable workers/events/locking, real
   providers, isolated deployments and actual distribution artifacts separately.

## Compiled application and served Admin entry point

On November 22, 2026 (America/Denver), the archived Rifare candidate
`ce082227c9016ed8ca550a51d8129024670b0fed` built the Medusa backend and Admin
in Linux with Node 24.14.1 and npm 11.11.0, using the committed lockfile.
The compiled server started on loopback after migration. Its compiled
commerce fixture passed all 17 native groups on disposable PostgreSQL 16,
including the retained protected-route holds. The login page and application
bundle returned HTTP 200, and Chromium rendered a single login form with
email, password and submit controls.

The record distinguishes the unauthenticated probe, which Medusa refused
before the Rifare hold, from the seeded store requests used for qualification.
The browser assertion uses the actual email control name and autocomplete
attribute. Authentication and post-login browser behavior remain open.
The database, npm/build outputs and disposable containers were retired.
The local evidence manifest SHA-256 is
`e4c51b4cb6a0703987348d5619581e937c40ffd5ae103c2521cd032bcc1b2ee9`.

The follow-up at `b6652bde71930559a8cda907d20049f4d681ec58` built the same
application source in Linux, with a fresh PostgreSQL 16 database and native
synthetic email/password operator. Chromium submitted the login form, observed
HTTP 200 from the native login and protected product endpoints, and rendered
the seeded product. Separate anonymous contexts received HTTP 401 before and
after sign-in. All 17 compiled commerce groups passed. The browser was
restricted to the loopback origin. No hosted identity client or connected
commerce provider was involved. The build, database and browser fixtures were
removed. The authenticated evidence manifest SHA-256 is
`8af4b0bafdd3bba8ddd004d1d4a20dd9df2b99cd3be332ffbf58a27a3c325796`.

## Standalone local qualification assignment

Resume COMMERCE-ENGINE-01 from integrated C6 development
9abf7156b7a7e785c4189ff9e88845a0748b414e on
feat/medusa-standalone-qualification. Root is sole writer and integration owner
in the existing operation-journal checkout. No additional checkout or full build
cache is allocated. The prior C6 implementation checkout is removed with its
original ref retained, as recorded in merged PR4.

Qualify the complete built backend away from the repository. The current Medusa
compiler copies package.json unchanged but omits run.mjs. Its generated scripts
therefore reference a missing launcher and source-only build tools and .ts paths.
Demonstrate that actual command failure first, then emit the minimum runtime
launcher and valid compiled scripts. Preserve the exact dependency lock, telemetry
suppression, local profile refusal, identity/trust boundaries and protected-effect
holds. No new database, auth provider or commerce workflow is assigned.

Run a clean production dependency installation from the exact lock in an isolated
runtime directory with hooks disabled. Then migrate disposable PostgreSQL and run
native compiled checks and a real HTTP health/held-effect probe from that relocated
runtime, with no repository modules or installed dependency fallback. Keep the
complete runtime candidate, toolchain, lock hash and results bound together.
Full Admin/browser release and hosted connected qualification remain separate.

Authority/security and regression reviewers remain independent and must inspect
the candidate and results. Root owns the temporary runtime/dependency directory
and its retirement immediately after qualification and evidence preservation.
Host free space before allocation is 56641687552 bytes. Reuse the inactive build
cache and existing npm download cache where compatible. No hosted CI, external
account change, provider deployment or protected commerce effect is authorized.

## Prior decision for standalone command intake refresh

Before changing tools/check_distribution.py, root as delegated integration owner
approves the source manifest SHA256
7298fd3a0a6b2b5ce7a8629d055739541616164f83f335c9bcbb535dc04d1a73.
The changes are the source start command and build finalization through the
reviewed shared-adapter and runtime builders. Every other source command remains
unchanged. Replace the generic command-prefix predicate with exact equality to
this full reviewed source script map. Preserve every dependency, locked version,
1016-entry count, registry/integrity and license check, the lock SHA256
8c8b3f4194cb50c91f03e44aa75ea922c3ad86133f6199512fdae62f9355e134,
and the exact hook-disabled .npmrc. The preexisting C6 package change had not
refreshed this intake pin. Preserve that actual failed checker result.

Independent authority review approved the bounded proposal before editing the
checker. No dependency or license waiver applies. New negative validation must
continue refusing changed scripts and hooks, even if a manifest pin is refreshed.
