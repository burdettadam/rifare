# ADR-0079 — Internal delegated-command transport and native admission

Status: assigned; implementation and independent review pending.
Protected source: `9c61f309398842cf49d7fdcde6cef788acdac3b7`.

## Assignment and ownership

The owner requested continued development and authorized feature-branch
publication. Assign **RCG-4B-C5**, an explicitly selected **internal mTLS**
START_USE and original-result recovery client, composed with the existing native
checkout source and original-command journal. This advances the documented
internal machine profile; it does not select or qualify a public provider route.

Root owns `feat/rcg4b-internal-use` in `rifare-internal-use`, the assignment,
independent sender/admission/catalog tests, controls, integration and closing
records. `command_consumer_impl` owns the separately assigned implementation
worktree. `c4_authority_review` and `receipt_regression_review` independently
review authority/security and regression. Neither reviewer authors product code,
tests or expected outcomes. At most three corrective review rounds apply.

Fresh read-only inspection confirms Marty UI draft PR1994 remains at
`37b7fdc3d3f1c223613ad98fe601d7d86e6a3600` and Protocol draft PR38 remains at
`6126da7619e057be2ff58dd38a5d50f49891d1b3`. The consumable internal route is
`POST /internal/v1/organizations/{organization_id}/delegated-use-commands`.
The selected host uses mandatory mTLS; its exact non-CA client leaf URI SAN and
complete certificate digest map to a MACHINE_IDENTITY. Current provider access
and grant evaluation remain independent provider checks. No provider test or
deployed endpoint was observed here. The separate provider conversation retains
ownership of Marty code and storage.

Pinned provider contracts are `rust/services/delegated-authority/USE_HTTP.md`
(blob `7287d7145252578db9053802cc7522751826814b`) and `USE_MTLS.md`
(blob `5f6f64170ff446caa8aa46d969d55ae7d0588df9`) at that head. No forwarded
identity, human bearer, service token, public Flow URL or provider-storage bridge
is selected. Public transport, signed request/proof composition, FINALIZE and
independent current receipt context remain later work.

## Fixed network boundary

Add a concrete client under the existing delegated-commands adapter family.
Server-owned configuration explicitly selects the HTTPS origin, organization,
typed machine correlation, server CA trust and client certificate/private-key
material with its exact leaf SHA-256 and canonical SPIFFE URI. Validate and
detach configuration through data descriptors without invoking accessors. Reject
unknown fields, mutable caller options, mismatched key/certificate, CA leaves,
expired identities, missing trust, insecure origins and credential-bearing URLs.
Configuration is not accepted through customer HTTP or restored from a claim.

Use the native Node TLS/HTTPS owner with mandatory certificate-chain and hostname
verification against explicit trust. Do not offer verification bypass, custom
network callback, proxy/environment fallback, redirect following, cookie/session
fallback, credential forwarding or automatic retry. Use a fresh bounded request
and no retained connection or TLS-session pool. Send only the fixed organization
path and exact canonical C1 command bytes, with the required JSON headers.
Reject FINALIZE sending. Original START and explicit recovery must remain
separate operations; recovery retains the complete START expectation.

Enforce a bounded overall deadline, header limit and streaming body limit. Feed
original response bytes to the existing strict C1 parser/binder, including
duplicate-member and original/result checks; no lenient JSON intermediary.
Accept only the selected successful JSON response. Non-success statuses, malformed
output, handshake failure, truncation, timeout and connection loss produce finite
sanitized failures. No raw response, certificate, private key, request or endpoint
is included in errors/logs. A missing result or unresolved preparation is not
permission to repeat START. Close aborts only requests owned by this client.

The transport can invoke a synchronous native guard before connection and again
after authenticated TLS, immediately before any HTTP application bytes. After
the final guard returns, no await or caller callback may intervene before the
fixed request is written. Native guard failures abort the owned request without
disclosing command bytes. Recheck client lifetime/identity at this boundary.

## Atomic admission and retained-current seams

Add `claimNewCheckoutStart(scope, input)` and a separate retained-only
`currentCheckoutStart(scope, input)` method.
Reuse C2's current concrete C3 binding, top-level transaction, customer/resource
checks, egress checks and final fence. Require the original identity to be absent
inside that transaction, including ownership checks before any collision detail.
An occupied original fails even when its payload is identical or it is observed,
cancelled, held, erased, restored or minimized. No previous method changes its
semantics. Preserve all stored fields, flags, timestamps and privacy owners.

The native sender constructs its own C2 journal using fixed configuration and
the concrete same-kernel C3 source. It captures concrete owner methods rather
than accepting overridable instance dispatch or duck-typed identity claims.
Its START operation commits the new original before initiating network I/O.
The final transport guard invokes the new synchronous retained-only
`currentCheckoutStart(scope, input)` and requires the same original/canonical
request/digest, unretired `claimed` state, revision 1 and null response. The guard
shares existing C2/C3 binding, current proof, egress and final-fence logic, but
requires the original row to exist and never inserts or reconstructs it. Reusing
the ordinary idempotent claim method here would recreate a deleted original,
possibly matching every prior scalar under a fixed clock. A changed purchase,
stale proof, closed source, absent row, retirement, observation or changed
original prevents the outbound application request. No second native source or
durable state owner is introduced.

Explicit recovery uses the existing current-proof `recovery` method, the retained
complete original and C1 response binding; post-await persistence uses C2
`observe` with the exact recovery request. START observations similarly pass
through C2 after awaited network work. Revoke/retire during that wait must still
prevent observation. Preserve the first immutable result and all existing false
provider/signature/execution flags. TLS success does not promote configured
correlation or a historical journal row into current grant authority.

Fresh admission intentionally spends the only local START send opportunity even
if the process fails before application bytes are written. Every preexisting
original, including one prepared through C4, is recovery-only for this sender.
A provider 404 never resets admission, generates a replacement UUID or permits
resending. This conservative availability limit is explicit; retrying a provably
unsent or C4-prepared original requires a separately assigned durable attempt
contract. No new attempt counter, lease, queue or state machine is assigned.

## Assigned source and control changes

The implementation writer owns:

- new `packages/adapters/delegated-commands/internal-use-client.mts`;
- new `packages/commerce/delegated-checkout-command-sender.mts`;
- the two additive admission/currentness seams in `delegated-command-claims.mts`;
- new `tests/development/delegated-use-client-helpers.mts`;
- new `tests/development/delegated-use-client.test.mts` (at most 20 cases).

Root owns this ADR, `work/records/RCG-4B-C5.md`, new
`docs/DELEGATED-USE-INTERNAL-CLIENT.md`, new
`tests/development/delegated-checkout-command-sender.test.mts` (at most 15),
new `tests/development/delegated-command-admission.test.mts` (at most six), and
new `tests/development/delegated-use-catalog.test.mts` (at most three).
These are exactly ten new source members. Current ARCHITECTURE, PLANS, ROADMAP
and relevant command guides may describe actual composition and remaining gaps.

Preserve all 1,829 prior source members, 3,778 registrations, 234 capabilities,
399 protected rows and 46 commerce SQL migrations. Append actual new members,
executable cases and one proposed capability. Inventory revision 59 advances
once. Under ADR-0008 update only licensing source count/reason. Do not modify
formal acceptance, dependency versions, runners, old helpers/tests, browser assets,
customer API/client, C1 codec, C3 source or receipt/execution owners except the
specific catalog test adjustment below.

Privacy retains schema digest
`1be56171e04e051e0402ac4ccb339b0f1c910a09f8f358001e0a3e62cb70ff3b`, all 15
surfaces and all 360 existing runtime-pin positions. Refresh the C2 runtime hash
and append only the two new runtime sources. Extend the existing process-memory
description, preserving all previous text as a prefix, to cover transient TLS
credential/request/response material and the limit of reference release rather
than guaranteed runtime/OS memory erasure. No new durable personal schema or
retention policy is assigned.

Catalog registration adds one internal-client adapter with two bounded operations
and at most eight direct references to actual new wire cases. Preserve the C1
adapter and all 47 existing adapters, 225 operations, 328 native cases and 47
fixtures. Append only necessary dependency/source pins and refresh the changed
C2 pin. Stay within the existing 262,144-byte limit (current canonical size
256,569 bytes). In `delegated-command-catalog.test.mts` only the global additive
counts and exclusions for this named new adapter/source/cases may change;
preserve every original assertion and frozen `823c2dc8...` coverage digest.
New C5 catalog assertions independently freeze the complete protected C4 coverage.
Expected coverage receives only the matching additive rows. The separate legacy
nested catalog's stale 38/199/262 literals remain deferred and unchanged.

Tests use real local TLS handshakes and actual native SQLite/source owners.
Generate ephemeral test credentials in owned private scratch, or retain them
only in test-process memory; never commit keys or access real provider accounts.
Record the runtime/credential-generation inputs. No provider implementation,
deployment, paid expansion, production operation or external message is assigned.
Authorized feature publication uses `[skip ci]`; no default-branch merge or
Actions dispatch is assigned.

## Focused evidence and independent review

Write new behavioral cases before implementation or demonstrate the assigned
targeted faults. Root's independent cases must assert actual outbound counts,
original retention (including deletion during TLS under a fixed clock),
currentness across the TLS wait, post-response access denial,
explicit recovery after loss and immutable history, rather than trusting report
flags. Use actual TLS peer requests, C1 responses and native effects counts.

Use ordinary whole-file selections within 60 cases/four files/60 seconds:

- new wire (at most 20), old C1 codec (20) and native composition (five);
- new sender (at most 15), old C3 START (20) and C2 claims (20);
- new admission (at most six), C2 process (four), privacy coverage (nine) and
  bounded C2 catalog (four);
- new C5 catalog (at most three), existing C4 HTTP (20) and copied client (12).

No broad, browser or nested campaign is assigned. Additional checks must resolve
a specific remaining risk. Bind actual whole-file reports, denominators, source,
runtime and omissions to a clean candidate; focused execution is not formal
acceptance or provider qualification.

Authority review demonstrates an isolated mutant omitting the final post-TLS
native guard, with the unchanged sender file failing because a changed native
purchase reaches the peer. Regression review demonstrates an isolated mutant
allowing an existing original through fresh admission, with the unchanged
admission/sender file detecting a second START after uncertainty. No mutant enters
the product branch. Both independent reviews cover the fixed final candidate and
any later documentation-only source equivalence.

The deliverable is an internal-profile Rifare client and native composition with
local TLS evidence. Actual provisioned-provider observation, public serving,
request/proof/finalization/context composition, full RCG-5/6, target PostgreSQL/
React and formal acceptance remain separate. Rifare retains domain permission,
approval, budget, reservation, business idempotency, execution and outcomes.
