# Current development plan

The recovered cross-era design inventory is consolidated in the [architecture recovery record](ARCHITECTURE-RECOVERY.md). Current implementation status and newer ADRs take precedence over historical roadmap proposals.

## Native cart context before approval integration

**COMMERCE-CONTEXT-01** is implemented and independently reviewed locally under
[ADR-0083](decisions/0083-medusa-cart-context.md), on `feat/medusa-cart-context`
from `afd678f`, published as `4550a14` with the exact reviewed `9446548` tree.
Root is the sole writer; independent authority and regression reviewers found no
scoped blocker. The bounded implementation protects native registered
cart access and observes persisted Medusa facts without opening protected effects.
The [cart-context guide](MEDUSA-CART-CONTEXT.md) defines the distinct observation
profile and its limits. All 22 new cart-context, 28 retained identity and 17 retained
commerce groups pass; 29 focused and 22 intake cases pass separately. The ownership
fault failed at the intended unchanged HTTP assertion; backend/Admin builds pass.
The [record](../work/records/COMMERCE-CONTEXT-01.md) retains the exact evidence and
the fixture-reset/unregistered-ID qualifications. Formal acceptance remains open.

This advances ADR-0081's target before C6's public transport composition. The
existing SQLite journal/currentness contracts remain retained behavioral
requirements; they cannot be replaced by a plain asynchronous cart query.

**COMMERCE-OPERATION-01 is implemented and locally verified** on
`feat/medusa-operation-journal` under [ADR-0084](decisions/0084-medusa-operation-journal.md).
The PostgreSQL journal enforces original identity and challenge uniqueness and
binds admission atomically to the native cart, customer and store. The privacy
owner can export, erase, hold and reconcile work after a logical restore.
The branch was published at `3a3d3e6` for independent authority/security and
regression review. Both reviews and maintainer acceptance remain pending. The
[work record](../work/records/COMMERCE-OPERATION-01.md) tracks those gates.
Public checkout, payment, order and return effects remain held.

After that journal is qualified, select the supported ElevenID human/machine
account-link and authority contract, then compose its evidence with the retained
operation and enforce final cart currentness/payment equality at Medusa's actual
effect boundary. A disposable [Redis takeover test](IDENTITY-APPLICATION-CONTRACT.md#payment-validation-and-compensation)
shows that the original worker can still write native checkout effects during
successor ownership. Re-evaluate C6's public command transport against the
Medusa-native operation owner.
The [merchant portability guide](MERCHANT-PORTABILITY.md) records the evidence
required to qualify a transfer of the Medusa application to a receiving operator.

## Owner-selected external identity provider

**IDENTITY-APP-01** is implemented and independently reviewed within its local
scope under [ADR-0082](decisions/0082-external-customer-identity.md), published on
`feat/supabase-identity`. Rifare and ElevenID use separate clients of a shared
external authentication provider. ElevenID retains identity/trust/delegation;
Medusa retains commerce ownership. The maintained OIDC customer adapter adds
browser/actor binding, native identity/customer persistence and short credential
lifetimes without opening protected commerce routes.

Reviewed native `8e1f727` and published `003d558` have the same source tree.
All 28 identity and 17 retained commerce groups pass against the synthetic peer,
PostgreSQL and native HTTP; 29 focused and 22 dependency cases pass separately.
Both independent reviews found no remaining scoped blocker, and the isolated
browser-binding fault failed at the intended unchanged assertion. The
[work record](../work/records/IDENTITY-APP-01.md) records exact inputs and limits.
Next: configure and qualify the actual provider clients/login-consent frontend,
then connect supported ElevenID identity/approval evidence to current Medusa
operations and original-outcome recovery. Shared login alone does not supply that
service dependency. Formal acceptance and production remain open.

## Owner-selected commerce replacement

**COMMERCE-ENGINE-01** is implemented and independently reviewed within its
local development scope on `feat/medusa-commerce` under
[ADR-0081](decisions/0081-upstream-commerce-engine.md). The owner selected Medusa
to replace commodity commerce and reduce custom code. The selected target is a
pinned upstream application with PostgreSQL and Medusa's standard modules and
workflows. New custom catalog, cart, pricing, inventory, order, return and exchange
engines are superseded by reuse-first migration. Existing SQLite implementations
remain diagnostic regression contracts until their retained behavior is migrated.

ElevenID remains the identity/trust supplier. External authentication now follows
the owner-selected provider contract above; commerce permissions and effects stay
with Rifare/Medusa. The separate ElevenID account/approval binding remains open.
C6 now has a locally qualified native implementation. The [migration record](../work/records/COMMERCE-ENGINE-01.md)
separates real application evidence from unconnected identity and legacy workflows.

Candidate `167b977` passes the actual Medusa/PostgreSQL verification (17 workflow
groups) and backend/Admin builds. The 61 selected configuration/dependency/legacy
cases pass with unchanged relevant inputs from `44e105f`. Both independent reviews
find no scoped blocker, and removing the completion hold in an isolated checkout
causes an actual order and the expected failing assertion. Formal acceptance and
production remain open. Next, qualify the identity/client lifecycle and the
Medusa approval-to-effect bridge before opening protected public operations.

**COMMERCE-ENGINE-02 standalone native Admin delivery is locally qualified** under
[ADR-0089](decisions/0089-standalone-admin-delivery.md). A relocated own-dependency
backend serves packaged upstream Admin and its demonstrated operator catalog journey.
Browser login/negative authentication, one accessible product dialog, native draft,
deep-link reload and local logout passed with public holds and customer separation.
Native protected-effect table digests stayed unchanged; exact asset and Outlet faults
were caught and restored. [The record](../work/records/COMMERCE-ENGINE-02.md) preserves
source/dependency hashes, independently checked evidence, compatibility scope and
remaining broader UI/connected/production/transfer gates.

The current source includes the bounded local **M20-G03 item-level drop-off
handoff** implementation. Start with the [architecture](ARCHITECTURE.md) for
existing modules and [roadmap](ROADMAP.md) for remaining work.

## Current internal command connection checkpoint

**RCG-4B-C5 — internal mTLS START and original recovery** is complete within
[ADR-0079](decisions/0079-internal-delegated-command-transport.md), from public
C4 checkpoint `9c61f30`. It selects the already documented internal machine
profile: atomic fresh admission, current native checks after TLS and before
application bytes, and explicit recovery of the original after uncertainty.
Existing originals, including C4 preparations and failures before transmission,
remain recovery-only. All 158 focused cases passed freshly on clean `3ecb91e`:
44 new and 114 existing cases. Both independent reviews found no scoped blocker;
the two assigned faults demonstrated stale transmission and a repeated START
at the actual peer. Published `9ecb34e` has the exact reviewed tree.
[The C5 record](../work/records/RCG-4B-C5.md) preserves actual executions,
negative-input equivalence and documentation-only closure. The existing customer
API, Python caller and runnable fixture keep their prior composition. Public
serving and FINALIZE/receipt-context integration remain separate.

## Current local command application checkpoint

**RCG-4B-C4 — local checkout command access** is complete within
[ADR-0078](decisions/0078-local-checkout-command-access.md). It connects the
existing C3 native START and C2 original journal to a separate five-route local
customer API and the standalone Python caller. The same assignment corrects
concrete native owner checks and dispatch at the API, server, receipt and intent
composition boundaries. The [command guide](DELEGATED-CHECKOUT-COMMANDS.md)
describes configuration, explicit original recovery and the preserved execution
boundary. All 200 focused cases passed freshly on clean `ecc34e5`: 44 new cases
and 156 existing regressions. Both independent reviews found no scoped blocker,
and both assigned isolated authorization/UUID faults caused the intended unchanged
behavioral assertions to fail. Published `6000723` has the exact reviewed tree.
The [C4 record](../work/records/RCG-4B-C4.md) preserves actual reports, review
identities and documentation-only closing equivalence. Existing tests, contracts,
business owners and record schemas remain protected; public provider transport
and formal acceptance remain separate.

## Previous native START checkpoint

**RCG-4B-C3 — native checkout START_USE claims** is complete within
[ADR-0077](decisions/0077-native-checkout-start-claims.md). It connects the actual
current checkout preview to original-command retention, with final purchase
currentness checked inside the journal's top-level transaction. The new
[native source](DELEGATED-CHECKOUT-STARTS.md) selects fixed purchase fields and
the complete preview digest; grant and provider correlation remain unverified.
Both independent reviews found no remaining scoped blocker after the held-erasure
and privacy-description corrections. Final evidence covers 115 distinct passing
cases: 62 fresh on corrected `ffe81ad` and 53 carried through independently
verified unchanged execution inputs. The isolated currentness and digest faults
fail the intended behavioral assertions. Published candidate `dfd60b5` has the
exact reviewed source tree. See [the current work record](../work/records/RCG-4B-C3.md)
for actual reports, correction history and closing equivalence. Formal acceptance,
provider authentication, public transport and FINALIZE composition remain open.

## Previous original-command checkpoint

**RCG-4B-C2 — durable original command claims** is complete within
[ADR-0076](decisions/0076-durable-delegated-command-claims.md). Both independent
reviews found no remaining scoped blocker after one catalog-pin correction. The [journal](DELEGATED-COMMAND-CLAIMS.md)
retains complete P03 originals and immutable unverified observations, including
privacy/hold/restore handling and terminal duplicate refusal. The slice also
repairs C1's missing additive adapter-catalog registration. It installs no
transport or execution authority. Final evidence covers 112 distinct passing
cases: 95 retained through independently verified unchanged inputs and 17
freshly executed after the catalog correction. Public candidate `9a5133c` has
the exact reviewed native `0330376` tree. See the [current work record](../work/records/RCG-4B-C2.md).

## Previous command-consumer checkpoint

**RCG-4B-C1 — delegated-use command consumer** is complete within the bounded
[ADR-0075](decisions/0075-delegated-command-consumer.md) assignment. It implements the pinned
P03 START_USE, FINALIZE_USE and RECOVER_RESULT intent/result boundary while public
provider serving continues upstream. The pure adapter validates original command
digests, exact result binding, immutable historical recovery and receipt-byte
correlation. It adds no network transport, current-authority source, durable
claims, native execution or approval. See the [consumer guide](DELEGATED-COMMAND-CONSUMER.md)
and [current work record](../work/records/RCG-4B-C1.md) for candidate and evidence.
All 42 focused cases pass on clean `e8c87c2`, including 25 new cases and 17
unchanged receipt regressions. Two separate original Protocol-vector checks
match the published digests; both independent reviews found no scoped blocker,
and their isolated binding mutants failed at the intended behavioral assertions.
The public candidate `ae924a1` has the exact tested source tree. Formal milestone
acceptance and the actual public transport remain separate.

## Completed local receipt checkpoint

The owner has continued development and publication. **RCG-5D receipt evidence
review** is assigned under [ADR-0074](decisions/0074-checkout-receipt-review.md),
starting from public checkpoint `4ac8556`. It extends `/checkout-review` with one
explicit submission of an already-issued signed receipt to the existing native
API. Preserve the original intent, transient input handling and explicit status
after an uncertain response. **The bounded local gate is complete** on candidate
`40fc973`: 12 new and 21 existing controller/native HTTP cases, five new receipt
browser cases and all nine existing browser cases passed. Both independent
reviewers found no scoped blocker. The closing documentation carries those
executions through explicit source equivalence; exact reports, review identities
and limits are in [the work record](../work/records/RCG-5D.md).

RCG-5C's nine served Chromium cases passed on `3db6507`, with earlier three
lifecycle and 21 HTTP/controller passes carried by their recorded source
equivalence. Both independent final reviews found no scoped blocker. The source
was published as exact-tree checkpoint `4ac8556`, matching native `413f849`;
the original native history remains separately preserved. These are local
plain-browser/SQLite observations, not React/PostgreSQL or full RCG-5 acceptance.

Closing inspection for C5 found provider draft PR1994 at `3c05227`, advanced
from the assigned internal `37b7fdc` contract. It adds a default-off public
managed-machine caller profile on the same mandatory mTLS listener: public
commands, challenge-bound request retrieval, proof submission and original
receipt recovery, with a separate Rust client. The internal route remains;
Protocol draft PR38 remains `6126da7`. General wallet/Gateway selection and
deployed serving qualification remain open. These are source observations; no
provider process or public route was exercised here. See the
[provider checkpoint and exact contracts](DELEGATED-COMMAND-CONSUMER.md#provider-and-next-integration).

**RCG-4B-C6 is implemented and independently reviewed locally** on
`feat/rcg4b-public-caller` under [ADR-0080](decisions/0080-public-managed-machine-caller.md).
It connects public START/original recovery and the original-bound challenge/request
handoff to the Medusa/PostgreSQL journal with a post-TLS serializable dispatch claim.
The returned signed request remains an unverified artifact. Proof submission and
FINALIZE are explicitly excluded until independent signed-request verification
and current native receipt-context composition are separately designed and tested.
A caller's verification assertion or a challenge UUID cannot supply that authority.
The [C6 work record](../work/records/RCG-4B-C6.md) records exact source and
compiled evidence, independent reviews and the remaining connected qualification.

**RCG-4B-C7 is implemented and independently reviewed locally** under
[ADR-0085](decisions/0085-native-signed-authorization-request.md). A separate native
session composes C6 retrieval with pinned ES256 request verification and immutable
PostgreSQL retention for the retained original. First nonce, bytes, context and
observation time survive retries and recovery; stale ownership, changed requests,
expired observations and privacy suppression refuse use. The compiled consumer,
populated upgrade and whole-database restore reconciliation passed locally.
The [C7 record](../work/records/RCG-4B-C7.md) preserves exact evidence and reviews.
Proof submission, presentation verification, FINALIZE and final commerce authority
remain unimplemented in this slice; their qualification cannot be inferred from
a verified request. Provider trust enrollment and connected qualification remain open.

**RCG-4B-C8 is implemented and independently reviewed locally** under
[ADR-0086](decisions/0086-native-delegated-receipt-admission.md). Its
[native receipt owner](NATIVE-DELEGATED-RECEIPTS.md) derives expectations from the
retained Medusa original and authenticated C7 nonce, verifies pinned signatures
and atomically retains one immutable PostgreSQL observation. Recovery, replay
refusal and privacy remain original-bound. The isolated compiled runtime, populated
prior-schema migration/replay and whole-database restore reconciliation passed
locally; [the record](../work/records/RCG-4B-C8.md) preserves exact evidence.
The observation remains inert. C9 composes proof/finalization with this receipt owner.

**RCG-4B-C9 is implemented and independently reviewed locally** under
[ADR-0087](decisions/0087-native-proof-and-finalization.md). The internal
[native continuation](NATIVE-DELEGATED-CONTINUATION.md) retains selected proof
context/digest without a VP, admits first dispatch after TLS, preserves original
submission evidence and uses a distinct durable FINALIZE UUID. Explicit recovery
requires original identities/bytes; prepared-only lost-ticket intent stays pending.
All continuation operations retain the authenticated submission origin. DENY,
receipt/result correlation and privacy refusal identities remain immutable/inert.
The own-dependency compiled consumer, actual mTLS session, populated C8-component
schema upgrade/replay and whole-database erasure/uninstall restore passed locally;
[the C9 record](../work/records/RCG-4B-C9.md) preserves source and review limits.
Connected provider enrollment/managed-machine presentation custody, live grant
status and final commerce execution controls remain separate open work.

**RCG-4B-C10 is implemented and independently reviewed locally** under
[ADR-0088](decisions/0088-native-payment-association.md). It derives one native
pending System payment identity from the authenticated original, exact money,
retained C9 final result and current C8 receipt verification. It refuses ambiguous
or deleted links, prior payment outcomes, retired regions and ineligible providers.
Immutable identity and privacy refusal continuity remain inert. The own-dependency
compiled consumer, populated C9 component/schema upgrade/replay and whole-database
erasure/uninstall restore passed; [the C10 record](../work/records/RCG-4B-C10.md)
preserves exact evidence and unexplained intermittent inherited C7 qualification
failures. Live provider outcome/status, connected custody, identity linking and
final commerce execution authority remain open.

The full isolated **RCG-5 cross-service journey** and connected **RCG-6 profile**
follow those bounded integrations. Preserve original recovery and Rifare's
execution, budget, reservation and business-idempotency ownership. Reuse the
landed receipt UI and provider service owners through documented interfaces.
Canonical criteria, actual endpoint qualification and formal acceptance remain open.

## Continuing commerce roadmap

**M20-G04: consolidation and custody continuity**, followed by **M20-G05: shopper
drop-off experience**, is the next recorded commerce direction. Reuse the current
handoff and custody owners. Preserve original units, partial acceptance,
corrections, disputes and the separation between custody, receipt, inspection,
stock and settlement. The [M20 record](../work/records/M20-dropoff-milestone.md)
contains the latest source/review checkpoint and exact limits.

This remains a roadmap continuation point rather than an automatic assignment.
It is separate from the delegated-checkout continuation above.

## Other open work

The [active catalogue](../planning/WORKER-GOALS.md) contains 55 remaining packets:
47 worker scopes and eight future integration gates. Ten packets are narrowed to
unfinished portions of existing work. The same catalogue carries 27 concise
connected-adapter follow-ups; their local workflow owners already exist.

Priority alternatives include completing loyalty attribution/reconciliation,
building the actual target application, and implementing a chosen real provider
adapter. M15/M16 source is missing from recovered history; M21–M25 remain future
implementation. See the [roadmap](ROADMAP.md) before selecting a lane.

[Remaining qualification](QUALIFICATION.md) records actual provider, model,
physical, deployment, independent-user and pilot obligations. Retired milestone
packets do not close those obligations. Formal dependency IDs and the
[acceptance ledger](../work/accepted-goals.json) retain their meaning.

## Continue without replaying completed work

1. Read the current architecture and the relevant domain guide.
2. Select a bounded remaining scope from the active catalogue or integration
   follow-ups. Inspect the current code, native contracts and tests first. Before
   assigning a compact entry, [promote just that entry](../planning/README.md#assign-a-compact-entry-or-qualify-a-retired-gate)
   to an active packet and commit the planning assignment so evidence checks can
   resolve it at their trusted base.
3. Record assignment, candidate, focused verification and independent reviews in
   an ordinary work record. Use [development commands](DEVELOPMENT.md).
4. Once a local implementation lands, remove its completed instructions from the
   active inputs. Carry any real code gap or qualification obligation forward
   concisely, then regenerate the views.

## Earlier plans

The chronological development diary and complete former goal catalogue are in
Git, with their underlying decisions and work records. Do not copy them into a
new completed-work archive.

```sh
git show d1fb45b94e14b276f7fa6e04f50173fe8cf39c77:docs/PLANS.md
git show d1fb45b94e14b276f7fa6e04f50173fe8cf39c77:planning/goals/M20/M20-G03.md
git log --all -- packages/commerce/dropoff-handoffs.mts
```

[ADR-0065](decisions/0065-retire-landed-planning.md) records the cleanup decision.
