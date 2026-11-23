# RCG-4A-HTTP — Local checkout application integration

Assignment: [ADR-0070](../../docs/decisions/0070-delegated-checkout-http.md),
committed before implementation at `4fb0592`.
Protected native base: `83a76927ffdd8f50e8360c66896c634612ff6723`.
Branch: `feat/rcg4-checkout-api`.
Status: implemented local candidate; no formal goal acceptance or release.

## Delivered boundary

One typed wrapper exposes six existing native operations and the exact route
contract through the established loopback commerce server. Original customer
scope/contact proof is checked before body collection and again by native
owners. Actual kernel-bound owners are injected at server construction; absent
configuration retains historical reads/cancellation without creating authority.
Only the receipt route receives the larger bounded envelope. Unexpected errors
and status logging exclude arbitrary input. No native owner, merchant effect,
dispatch, migration, root/optional dependency manifest or provider code changes.

The separately authored Python standard-library client supports the same
operations from a copied isolated directory. It refuses remote URLs, proxies,
redirects, automatic retries, malformed/ambiguous response JSON, secret
reflection and execution-authorized results. It uses an environment credential
and bounded receipt stdin. [The guide](../../docs/DELEGATED-CHECKOUT-HTTP.md)
documents exact commands and scope.

## Behavioral evidence

Before runtime changes, `RCG4HTTP-HISTORY` exercised an actual current customer
bearer against the prior server and failed the assertion `404 !== 200`.
The separately authored client also reproduced the absent contract route through
a real Python HTTP process. Neither red result was a setup or import failure.

The focused new selection contains 23 HTTP cases and 19 independent-client
cases. It covers signed capture, preparation/read/cancellation, stale revisions,
scope/proof refusal before an unfinished body, malformed JSON, announced and
chunked limits, existing 4 KiB behavior, source/context/trust changes while
verification is pending, concurrent capture, exact retries, server restart with
configuration absent, terminal expiry, no effect creation and safe output.
Native cases and focused reports are retained under ignored `evidence/` and
bound to the final candidate in the separately tracked Codex handoff.

The root integrated run passed all 42 new cases. Unchanged focused selections
passed 45 native intent/receipt cases and 28 intent-privacy/coverage cases.
Registration retains all 339 prior test-source files, 3,488 case rows, 225
capability entries and 1,747 source members, adding 42 cases, one proposed
capability and nine sources. Privacy keeps all fifteen surfaces and its exact
schema, with 351 runtime pins. Catalog validation preserves 46 adapters,
221 operations, 308 distinct native cases and 47 direct fixtures; two existing
source pins refresh and seven source dependencies are added under the prior
supplement. Six unrelated inherited import-closure omissions, the prior direct
destination fixture mismatch and stale full-catalog count assertions remain
outside this increment; no full catalog regression pass is claimed.

The matching strict TypeScript entry scope produces 825 inherited diagnostic
blocks on the protected base and this implementation, with zero added or
removed complete-message occurrences after normalizing line/column positions.
The earlier 800-result server-only scope and previous milestone's 940-result
scope differ in their entry files. No clean whole-project typecheck is claimed.

Independent authority/security and regression review is required on the fixed
final candidate. The exact review records and final Git/tree identities belong
to the durable handoff; this source record cannot approve itself. The unchanged
HTTP/parser/application regressions, native intent/receipt selections and
privacy/source registration checks preserve the relevant prior controls.

## Remaining boundary and publication

Fresh source checks still find no provider final-use or reconciliation transport
on Marty UI main; PR #1994 remains draft/unmerged. RCG-4B and the complete RCG-5
isolated deployment journey remain open. This local API never turns historical
evidence into permission to purchase.

Publication is authorized. This session's actual native Git push failed because
no password could be obtained; the connected GitHub write returned HTTP 403
`Resource not accessible by integration`. The browser connection could list the
repository tab but could not control it. No successful remote publication is
claimed. Preserve original history through verified bundles and reconcile
remote refs before a later push. No tags, production or paid effects occurred.
