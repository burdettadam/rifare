# COMMERCE-ENGINE-02 - Standalone native Admin delivery

State: bounded local implementation accepted by delegated maintainer; normal integration pending.
Contract: [ADR-0089](../../docs/decisions/0089-standalone-admin-delivery.md).
Base: `5aa050e9ccdf8b8156c2e0455605ef4011a5d633`.
Branch: `feat/medusa-standalone-admin`; root writer/integration owner.

Rifare has one active primary and zero linked checkouts; root resumes it without
creating another checkout. The earlier standalone branch is an ancestor of canonical
development and its PR5 work is already integrated. PR9 is verified merged; its full
tree matches published b0d3cfb. C10 runtime and compiler output are absent after fresh
Windows gates and 88,799 DELETE/share probes, with source/cache/configuration/refs and
raw evidence preserved. Removed allocated file bytes were 563,001,512; Windows host
free space rose 343,678,976 under concurrent unrelated activity. All task DBs stopped.

The previous goal turn made authoritative progress through reviewed PR9 integration
and verified retirement. The broad handoff objective remains active. This assignment
advances actual native operator delivery while external provider endpoints, account
link and custody remain unavailable; it duplicates no other worker's deployment.

Existing source node_modules remain reusable. No compatible standalone runtime is
retained from C10. Initial host C free space is recorded by the qualification owner
before build/runtime allocation. Generated types remain inspected and preserved;
no unrelated cache or user configuration is deleted.

Next: inspect upstream build/static serving and run the actual Admin-enabled build,
then reproduce standalone browser behavior and fix demonstrated delivery gaps. Root
owns the checkout; independent roles will review fixed source and actual evidence.

## Exploratory evidence and prior implementation decision

The first Admin-enabled build and own-dependency runtime served the normal login and
operator pages. A filesystem regression first showed two positive build controls pass
while enabled missing-index/missing-entry/path cases incorrectly advertised a runtime.
The builder now validates the compiled configuration and referenced local entry assets;
five new and eight retained configuration cases pass. Its first compiled-config read
used the source CWD and failed custom-module resolution; the corrected builder loads
the normal source environment, reads config from compiled CWD and restores CWD.

The initial test-profile Admin emitted React development code. Selecting production
React alone produced a genuine `jsxDEV is not a function` browser failure; production
JSX in Vite8 OXC must match that runtime. Both observations remain failures, not passes.
With both selected, the login works but create-product still has two hidden dialogs.
Source inspection demonstrates separate native table and LayoutComposer Outlets.
The root maintainer adopted the narrowly pinned compatibility correction in ADR0089
before implementing it. It does not substitute a custom commerce UI or weaken the
unchanged single-accessible-dialog requirement. Other workers' deployments stay intact.

The owned runtime keeps the two failed generated Admin bundles outside its served
public tree for review; both are task-owned rebuildable data and retire with this
runtime. PostgreSQL and the loopback backend are task-owned and currently active.
No exact-candidate or completed browser qualification is claimed yet.

## Implementation checkpoint

The builder requires the actual compiled config and all referenced local Admin entry
assets before advertising standalone commands. Explicit disabled Admin still preserves
the backend-only profile and exact lock. Static React runtime and OXC JSX production
selection agree; backend production mode remains refused. The pinned native ProductList
build hook verifies its input hash/one marker and refuses an absent target. Installed
package bytes, permission checks and both native table branches remain unchanged.

A relocated exploratory browser now observes exactly one visible/accessibility-exposed
native create-product dialog and one form. Its normal Save-as-draft action persisted
one native product and default un-managed variant, confirmed through current native
Admin API. A diagnostic predicate used an unavailable URL global after the click;
we reconciled the existing product instead of repeating that write. The committed
browser helper avoids that setup error and uses a fresh isolated context, actual
operator login/catalog/deep-link/logout, valid synthetic customer JWT separation and
all selected public holds. A native fixture independently checks persisted catalog
and unchanged protected effect tables. Those complete fixed checks remain pending.

Five static delivery regression cases and eight retained config cases pass; no-emit
passed after the native fixture was added. The earlier failing guard and duplicate
modal observations remain preserved. Root remains sole writer; one primary/zero linked
checkouts. The temporary standalone runtime, owned loopback backend and PostgreSQL
remain active for fixed qualification, with generated failed bundles owned for the
same retirement event. No production, provider authentication or distribution claim.

The initial fixed run passed all ten functional browser stages, including customer
JWT separation, nine public hold requests and local logout, but failed the unchanged
zero-runtime-errors check. Bounded diagnostics found exactly `Authentication failed`
and no external requests, unpackaged scripts or bad assets. A wrong-password-only
fresh browser confirms HTTP401, visible native validation text and that uncaught
promise rejection. Original draft outcomes were reconciled in PostgreSQL instead of
retried; all eleven protected native table digests remain unchanged. ADR0089 selects
the specific FetchError submit-handler correction before implementation. No error,
status, data-refusal or page-error assertion is relaxed.

## Fixed qualification and independent disposition

Qualified source: `1ed7ebfab03fd95c015dc100e5dc40498be31ca6`, against base
`5aa050e9ccdf8b8156c2e0455605ef4011a5d633`. The own-dependency relocated backend
serves static Admin under test/local-medusa; its locked installation includes TypeScript 5.9.3 as a devOptional dependency and excludes ts-node
installed. It does not use a repository dependency link or a Vite development server.
The source dependency cache and the one task-owned production installation are reused.

Fixed and exact-restored fresh-browser executions each passed eleven stages: anonymous
Admin API refusal and guarded deep link; wrong-password HTTP401 with visible validation;
operator login; one accessible product dialog; native draft creation; deep link/reload;
valid native synthetic customer JWT with Admin-data refusal; all nine selected public
holds; local browser logout; packaged assets. Each complete run fetched 483 script/style
responses with the required MIME types. No external requests, unpackaged scripts or
unexpected page errors occurred. Rendered login and saved product screens were inspected.
Customer JWT fixtures prove actor separation, not external Supabase authentication or
global revocation. Browser local logout does not prove global token revocation.

Independent native PostgreSQL verification confirmed the selected draft, one default
unmanaged variant, no duplicate original title, and unchanged row counts/digests in all
eleven protected effect tables. Catalog writes are intentional native effects; no
protected payment, order, reservation or stock-level change occurred. All records and
credentials are synthetic local fixtures. Earlier unsuccessful browser attempts' native
draft outcomes were reconciled rather than blindly repeated.

Two exact faults passed their preceding controls and failed unchanged assertions.
Removing only the served entry script returned HTTP200 HTML through native SPA fallback;
`ADMIN_STATIC_ENTRY_ASSET_INVALID` caught it. Omitting only the compiled ProductList
`hasOutlet:false` prop, while retaining the login correction and every other byte,
returned the confirmed broken JavaScript hash and failed
`ADMIN_SINGLE_ACCESSIBLE_PRODUCT_DIALOG_REQUIRED` after four controls. Both file bytes
were restored exactly to the generated source artifact. The full restored browser and
native checks passed. Prior typed-login failure is retained separately; its HTTP401,
visible validation and uncaught rejection are reproduced before the scoped correction.
No authentication, status, message, data-refusal or page-error assertion was relaxed.

Receipt `evidence/operation-journal/1ed7ebfab03fd95c015dc100e5dc40498be31ca6/admin-delivery-runtime-receipt.json`
has SHA256 `cab8d944197323771d1a2b6af2e276830ef3ae65897b740550e799b0ee901e8e`.
Actual independent roles `/root/c7_authority_review` and `/root/rifare_regression_review`
recomputed all 99 Git/disk inputs, 536 compiled outputs, seven generated inputs, 53
listed evidence hashes and dependency locks. Both installed vendor modules retain their
ADR-pinned bytes. Both roles inspected actual reports/source and cleared this bounded
local integration with no blocking finding; root accepts it under delegated authority.
These are separate reviewer sessions, not fabricated GitHub approving reviews.

Five static delivery and eight retained configuration cases, four runtime intake cases,
no-emit, repository/generated/plan, full distribution/licenses and Gitleaks passed. The
unchanged package graph remains pinned. This is not a whole upstream Admin, MFA/SSO,
connected provider, production or distribution-rights acceptance. Remaining commerce,
identity linking, managed-machine custody and transfer gates are unchanged.

The final browser helper carries bounded redacted failure diagnostics. A failed collector
first used a Windows default text encoding for package metadata; UTF-8 correction produced
the verified receipt. A restart preflight correctly stopped on a non-runtime console
helper, before changing that running backend. The corrected task lifecycle stops only
the creation-verified owned launcher/runtime children and lets other original descendants
exit with the parent; it does not stop unrelated processes. One temporary PowerShell
helper syntax failure was corrected before migration/restart; no passing result is
credited to it. All exploratory and setup failures remain distinguishable in raw evidence.

The Admin build created a three-file `.medusa/client` intermediate directory that did
not exist at assignment. It is task-owned rebuildable output and retires with the
standalone runtime and `.medusa/server`, after independent review and normal integration.
Existing `.medusa/types`, source dependencies/configuration, refs and required evidence
remain preserved. Source, screenshots, fault receipts and installed-lock bytes survive
cache retirement; no duplicate full dependency tree was allocated after the first install.

Rifare lifecycle audit scope: one active primary (root), zero linked/verification trees.
The provider repository was inspected only for source/interface availability: its
read-only registration inventory has one primary and forty linked checkouts, owned by
other workstreams; no removal audit or cleanup is claimed there. Current provider main
was verified read-only, with no selected Auth/delegated-use source change or qualified
connected endpoint replacing the known external gate. Other workers retain deployments.

Next: carry both clearances through final documentation-only publication, normal merge,
and owned runtime/intermediate/compiler retirement with fresh Windows gates. The broad
handoff goal stays active; the complete external/commerce/transfer outcome remains open.

## Evidence correction during COMMERCE-ENGINE-03

The immutable receipt records consumer_typescript_installed true and
consumer_ts_node_installed false. Earlier prose claimed both were absent; that was
incorrect and is withdrawn here and in PR10. The exact installed lock already includes
the optional TypeScript entry. No receipt, locked dependency or native/browser result
was modified for this correction. Compiled JavaScript and packaged Admin consumption
remain demonstrated; total absence of a TypeScript package was never demonstrated.
