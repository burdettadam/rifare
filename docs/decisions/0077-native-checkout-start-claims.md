# ADR-0077 — Native checkout START_USE construction and claiming

Status: bounded delegated assignment before implementation.
Protected source: `f4cd7f1d4df569a2bfd22c7540041e0336f72d64`.

## Assignment

The owner requested continued development after C2. Under the existing delegated
development and feature-publication authority, assign **RCG-4B-C3**: construct
START_USE from an actual current native checkout preview and retain the original
through the existing command journal in one top-level transaction.

Root owns `feat/rcg4b-native-start` in `rifare-native-start`. The implementation
writer `command_consumer_impl` owns the five paths below in a separate worktree
created from this committed assignment. `commerce_checkpoint_audit` remains the
independent authority/security reviewer and `receipt_regression_review` remains
the independent regression reviewer. Neither reviewer writes product code,
tests or oracle; at most three corrective review rounds apply.

The inspected upstream snapshot is open draft provider
`0a1ef66a4b832e0fd8d67a57940425af379e2254`, with Protocol still
`6126da7619e057be2ff58dd38a5d50f49891d1b3`. Its default-off internal serving host
now includes protected original-receipt recovery and an offline receipt consumer;
the selected public Gateway/wallet/client contract and deployed qualification
remain separate. This is source inspection, not a provider test execution.
The separate provider conversation owns Marty work. No private storage bridge
or invented public endpoint is assigned here.

## One native construction source, one existing retention owner

Add `DelegatedCheckoutStarts(kernel, previews, {grant})`, requiring an actual
`CheckoutPreviews` owned by the same kernel. Capture concrete native methods and
private-brand-check the owners: a duck-typed source, arbitrary callback, copied
object or overridden instance method cannot provide current purchase proof.
The grant is a descriptor-checked, detached, frozen original `GrantRef`, validated
with the unchanged C1 codec. It is an unverified reference, not current grant
authority. The existing C2 correlation remains local configuration, not an
authenticated provider tenant or machine namespace.

Expose synchronous `prepare(scope, {command_id, preview_id})` and
`assertCurrent(scope, binding)`. Accept only those two input keys; do not accept
caller totals, resource, operation, digest, preview objects or flags. Use the
actual `CheckoutPreviews.current` owner and its existing complete preview digest.
The fixed operation is:

| Field | Native value |
| --- | --- |
| action | `urn:rifare:action:purchase:v1` |
| resource_id | `urn:rifare:resource:` plus the native preview resource ID |
| audience | `urn:rifare:store:` plus the native preview store ID |
| request_profile | `urn:rifare:checkout-preview:v1` |
| request_digest | `sha256:` plus the native preview digest |

Use C1 to encode the complete original START. Keep live binding provenance in a
WeakMap tying the actual original preview object and originating opaque Scope to
the source instance. Return frozen data; JSON copies, a foreign source's binding
and another Scope must fail the currentness assertion. Recheck the exact original
preview object and digest. Do not rehydrate a binding from stored JSON or retain
a new strong preview cache. Closing an owner or losing its process invalidates
current use; previously returned caller-held data remains historical.

Add an optional concrete starts owner to the existing
`DelegatedCommandClaims(kernel, correlation, starts?)` constructor and add
`claimCheckoutStart(scope, {command_id, preview_id})`. A missing or mismatched
source fails closed. Preserve every existing two-argument constructor and raw
claim/read/observe/recovery/cancel behavior, their return shape and false authority
flags. Reuse one private encoded-claim core rather than duplicate the journal's
identity, conflict, insertion, capacity or retirement logic.

The new method must reject pre-existing transactions before any database work,
then run native construction and claim insertion under the existing top-level
transaction. Its final order is current native customer/ownership checks,
concrete native START currentness, recovery-egress check, then the existing inert
SQL identity/digest/uniqueness fence. No callback-capable work may follow that
fence. Apply the same final checks to exact repeats. A change introduced during
the journal's final native access check must roll back the insert. A source
callback changing the journal must be caught by the existing inert fence.

Return the existing historical/unverified `CommandClaimView` only after COMMIT.
Current construction at that transaction does not authorize later sending or
execution. Expired/lost/retired previews deny this native method while original
historical read and unsent C2 recovery retain their existing contracts. Same-ID
changed valid intent conflicts; an earlier identical raw C2 claim may converge
only after the new method's complete current native checks. No new command UUID
is silently generated and no uncertain original is replaced.

## Preserved authority, storage and privacy

No ReceiptContextSource is produced: the existing receipt context includes an
independently established proof nonce and cannot serve as pre-START authority.
Do not infer FINALIZE challenge or proof relationships. Provider authentication,
current grant/actor authorization, transport, native receipt verification,
business permission, budgets, reservation and execution remain separate owners.

Keep C2 record version, exact body fields and personal projection unchanged.
Only the canonical original START is stored through existing typed retention.
No new SQL table/migration, durable purchase binding, workflow, lease, operation,
raw receipt, proof, secret or current-authority flag is introduced. Existing
privacy/hold/erase/uninstall/recovery/import owners remain unchanged. New focused
integration tests must show native-produced claims obey those owners, that
minimized originals cannot be repopulated, and that history cannot restore a live
preview. Source bindings in process memory are subject to native current access
and retirement; they do not preserve use permission through a hold or erasure.

## Allowed paths and additive controls

The implementation writer owns:

- new `packages/commerce/delegated-checkout-starts.mts`;
- narrow changes to `packages/commerce/delegated-command-claims.mts`;
- new `packages/commerce/contracts/delegated-checkout-starts.v1.json`;
- new `tests/development/delegated-checkout-starts.test.mts`;
- new `tests/development/delegated-checkout-start-helpers.mts`.

Root owns this ADR, `work/records/RCG-4B-C3.md`,
`docs/DELEGATED-CHECKOUT-STARTS.md`, and the new
`tests/development/delegated-checkout-start-lifecycle.test.mts`. Root may update
the current ARCHITECTURE, PLANS, ROADMAP, command-journal/consumer guides and C2
contract descriptions to document the additive method and actual boundaries.
There are eight new source members in this assignment.

Append the eight source members to the existing component inventory, actual new
native test IDs and one proposed capability to the regression registry. Preserve
all 1,813 original source members, 3,706 prior test rows, 232 prior capabilities,
399 protected rows and all 46 migration files. Under ADR-0008 refresh only the
licensing oracle's actual source count/reason, retaining all its other values.
No acceptance-ledger change is assigned.

Privacy keeps the exact schema digest
`1be56171e04e051e0402ac4ccb339b0f1c910a09f8f358001e0a3e62cb70ff3b`, its 15
surfaces and all 359 prior runtime-pin positions. Refresh only the changed
command-claims runtime hash and append the new native START source; add its
membership/retention explanation to the existing process-memory surface. No
privacy hook or stored-record parser change is assigned. Catalog source/oracle
pins may only refresh a genuinely changed, previously pinned source and append
a newly reached dependency if direct validator evidence requires it; preserve
all adapter/operation/expected-coverage rows and the unchanged byte bound.
The separate legacy nested catalog test's stale hard-coded totals remain
deferred; no existing test, fixture, oracle expectation or runner is edited.

No existing preview/receipt/intent/codec change, dependency, browser/API route,
workflow, provider code, production effect or paid expansion is assigned.
Authorized feature publication uses `[skip ci]`; do not dispatch Actions, merge
the default branch, create a release or deploy.

## Focused behavioral verification and independent review

Write the new behavioral cases before implementation, using actual native
customer proof, source owners and SQLite. Cover exact purchase mapping,
descriptor safety, detached grant config, concrete-owner/provenance isolation,
scope denial, source/quote/terms/expiry changes, exact-repeat and changed-intent
conflict, late source and native-access fences, transaction ownership and failed
commit. The returned result and all existing business/source effects remain
non-authorizing and unchanged.

Use three ordinary selections, each no more than 60 cases/four whole files/60
seconds: new unit cases plus unchanged C2 journal and C1 native binding; new
lifecycle cases plus unchanged native checkout and C2 command privacy; existing
privacy coverage, C2 process durability and C2 bounded catalog checks. Do not run
the nested full catalog or broad/browser regression campaign. Extra verification
requires a concrete remaining risk, not a larger green total.

Independently demonstrate two isolated targeted faults on the finished candidate:
remove only the final concrete native currentness check, and separately replace
the native request-digest derivation with a different syntactically valid digest.
The actual new behavioral assertions must fail, with schema parsing still valid.
No mutant enters product source. Bind source, runtime, raw native reports and
both review verdicts to a fixed clean candidate. Closing documentation may use
explicit source/runtime/input equivalence rather than rerun product cases.

C3 completes native construction at a local transaction only. It does not close
authenticated provider namespace/current-grant binding, public transport, full
RCG-5/6, target-stack qualification or formal acceptance.
