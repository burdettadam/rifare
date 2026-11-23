# ADR-0089 - Standalone native Admin delivery

Status: assigned; implementation and qualification pending.
Base: `5aa050e9ccdf8b8156c2e0455605ef4011a5d633` (Rifare PR9).
Branch: `feat/medusa-standalone-admin`; root is sole writer and integration owner.

## Assignment COMMERCE-ENGINE-02

Complete the next ready part of the selected Medusa migration: deliver and qualify
upstream Admin from a relocated compiled backend with its own locked production
dependencies. The earlier standalone checkpoint explicitly excluded full Admin/browser
delivery. Do not replace upstream Admin or create a second operator commerce UI.

Build Admin enabled using the pinned Medusa 2.23.0 toolchain. Preserve actual static
assets and supported deep-link routing in the standalone output; do not rely on
repository source, its dependency directory, a development Vite server or fixture
fallback. Reuse compatible source caches before allocating another runtime. Record
all generated output, owner and retirement event; check Windows host space first.

Qualify actual anonymous/login/logout and a native operator catalog journey in a
fresh isolated browser against disposable PostgreSQL. Use only synthetic development
operator/customer identities and local System payment fixtures. Inspect rendered
screens and native effects, not only HTML status or generated files. Browser reload
and a deep link must still load the same packaged Admin. Wrong/absent authentication
must not supply Admin data. Preserve customer/operator separation and server commerce
holds. Any tested catalog writes stay within task-owned synthetic data; no orders,
protected checkout, connected provider, external identity deployment or paid effect.

Keep the local profile's production refusal and existing Enterprise/cloud exclusion.
No generic OIDC implementation, new Supabase architecture, managed-machine enrollment,
release artifact/tag or distribution-rights acceptance belongs to this assignment.
The provider worker owns those deployment/custody boundaries. Latest provider main
`a18d9f0b19a9225ce5c1466187c126eacdc2c42c` was inspected read-only; selected delegated-use,
Auth and caller paths are unchanged from the earlier Rifare provider pin. The
published provider deployment record still leaves external HTTPS qualification open.

Use focused behavior checks while developing. Bind final browser, native HTTP,
compiled/dependency inputs and a meaningful static-delivery fault to the fixed
candidate. Run affected retained backend/configuration/intake and public commerce-hold
checks without weakening their assertions. Both independent authority and regression
roles review the actual fixed candidate and evidence before normal authorized merge.
Hosted Actions remain skipped under the owner's cost instruction. Retire owned
runtime/browser/database/generated output after qualification/review/integration while
preserving source, configuration, refs, screenshots, logs and qualification evidence.

This completes only local standalone Admin/browser evidence. Full connected identity,
commerce authority, legacy data porting, receiving-operator transfer and production
acceptance retain their existing requirements.

## Proven upstream product-route duplication and selected compatibility fix

Before implementation of a vendor adjustment, the delegated maintainer selects one
bounded build-time compatibility correction. The actual 2.23.0 product table renders
its child Outlet, and ProductList wraps it in LayoutComposer with its own default
Outlet. Native create-product navigation therefore mounts two dialogs; both become
aria-hidden and the unchanged accessible-dialog assertion fails. A production React
runtime/JSX build still reproduces the two dialogs, so do not attribute this route
bug to StrictMode or claim the React build selection resolves it.

The official release API still reports [v2.23.0](https://github.com/medusajs/medusa/releases/tag/v2.23.0)
as latest on November 23, and official develop's product table retains its Outlet.
Select the existing LayoutComposer `hasOutlet=false` prop only at ProductList's
call site, leaving its table-owned Outlet, layout, widgets and permission checks
unchanged. Apply it through the existing Vite build hook to the exact qualified
`@medusajs/dashboard` 2.23.0 product-list module. Do not overwrite installed package
files, add install scripts, replace routes/UI, change RBAC/SSO gates or fork a
commerce engine. Refuse changed module bytes, a changed marker or an absent target.
The module is `dist/product-list-SC2CY4XX.mjs`, SHA256
`3aba92f16ae523ec7ccbdaa44dc1787f066cf1771439420da9e7599816fd3e5c`.

The affected original call site is
`packages/admin/dashboard/src/routes/products/product-list/product-list.tsx`,
outside the Enterprise paths enumerated in the selected release's root license
scope. No permission hook or other Enterprise implementation is changed or copied.
Retain existing source/license notices and distribution restrictions; this is not
legal clearance or a public release authorization. Remove the compatibility hook
when a fixed upstream release is selected and independently requalified.

Require a fresh-browser native create-product/catalog journey and single accessible
dialog, with a deliberate omission of this exact adjustment reproducing the unchanged
failure. Static missing-entry fault remains separately required. Scope stays local
packaged Admin delivery; other upstream features are not accepted by one journey.

## Reported email/password failure promise

The fixed browser's wrong-password request returned HTTP401 and rendered the native
`Authentication failed` validation text, but also raised an uncaught page error with
that message. A separate fresh-browser wrong-password-only reproduction confirms it.
The native EmailPassLogin awaits `mutateAsync` with an onError callback that already
populates the form, then lets that reported HTTP rejection escape its submit handler.
Do not weaken the zero-unexpected-page-errors or HTTP401/data-refusal assertions.

Before implementation, the delegated maintainer selects a second narrowly pinned
compatibility adjustment: catch only the existing SDK FetchError rejection after
that unchanged native mutation/onError handling; rethrow every other exception.
Preserve the original onError status checks, validation/server-error messages,
onSuccess and MFA callbacks, backend Auth responses, all permissions and provider
selection. The browser must verify the visible error as well as failed authentication.

The exact module is `@medusajs/dashboard/dist/login-NQL3NNCN.mjs`, SHA256
`b86850b96199e64c8efa01027800be32413f97802722106a7b202dc7e4428d47`.
Hash/unique-boundary checks must confine the adjustment to EmailPassLogin's submit
handler from `src/routes/login/components/email-pass-login.tsx`. Do not modify the
SSO component or any other Enterprise code that shares the distributed chunk. A
changed or absent module fails the build. Installed packages and npm lock remain
unchanged; retire both hooks with a selected, qualified upstream fix. This remains
local compatibility qualification without distribution-rights acceptance.
