# Commerce journeys

## Scope and current evidence

ADR-0055 assigns bounded local M18 composition. The current implementation and
review decision are recorded in `work/records/M18-journey-checkpoint.md`; this
contract is not a formal M18 acceptance record. Connected providers, independent
remote callers, target-host qualification and missing-history reconciliation
remain separate open gates.

A journey uses the original commerce case. It retains typed references to the
original previews, approvals, receipts, returns, edits, carts and deliveries.
It does not retain a model provider's conversation ID, transcript, payment state
or a second financial ledger. Current native owners still decide permissions,
eligibility, approval use, source freshness and effects.

## Continuing a case

Every request includes the case ID, a verified channel-link ID and the expected
ownership generation. A separately supplied current customer proof must match
the exact tenant, store, case, order, customer and source contact. Staff and agents
must own the current generation. The current selected link reports complete,
partial or unavailable history explicitly.

The deterministic record has sequential versions and hashed request identifiers.
`open` creates the first version; `attach` appends original typed references to a
finite named intent. Reusing a request or overwriting a stale version is refused.
A retired journey never falls back to an older version or silently reopens.

`context` rebuilds current observations from existing owners. Its digest is a
view identifier; it cannot authorize a subsequent operation. Old artifact
references remain provenance even when a new configuration or source revision
makes the old preview unusable. The response distinguishes current configuration
and current original case verification. A fresh proof can permit a read while
the original case proof still requires explicit renewal through its existing owner.

## Preparing, executing and reconciling

`prepare` accepts a native resolution, exchange, label or order-edit proposal and
returns the exact new native preview. Intake preparation remains with
`ReturnIntake.prepare`/`revise`; attach its original preview to the journey.
Pending mutable return-request bodies are not durable references. After native
submission, the stable return request can be attached.

`execute` requires the attached preview's exact ID and digest and an independent
native approval ID. It returns the existing gateway's receipt and appends those
same canonical references atomically. An acknowledgement in conversation is not
an approval. The wrapper neither approves nor dispatches the resulting operation.

Before either step, the coordinator checks uncertain operations across the whole
order, including other cases and intents. Generic sends, native returns,
resolution operations, fulfillment, edit parents/steps and carts all participate.
An unknown effect blocks a conflicting new preview or execution. Missing unknown
child parents are an integrity failure, never an all-clear.

`reconcile` addresses an original attached operation through the same native owner.
Fulfillment, resolution, edits and delivery use lookup-only native methods. A cart
uses its existing confirmation lookup only when its canonical state is unknown
or already committed. A proposed cart cannot be committed through reconciliation.
A native observation can survive a takeover, but a stale caller cannot append a
new journey transition or receive authority from that observation.

Raw native responses require current `operation.read`; reconciliation also requires
`operation.reconcile`. A staff caller uses the separately verified customer proof
for the cart lookup. Customers gain no additional operation permission. Restricted
readers receive no private reference, approval, nested observation or uncertain
operation ID; hidden uncertainty still produces an explicit handoff.

## Native stage meanings

A native return record is not a completed refund. Refund acceptance remains
distinct from settlement. A replacement-created observation does not establish
shipment. Confirming an unknown edit child does not finish the parent edit. A
committed cart does not establish purchase, checkout, payment or stock reservation.
Journey projections retain these native distinctions and claim no live effect.

## Privacy and recovery

The existing support-document table owns versioned `commerce_journey` records.
Dedicated validation checks every retained version and its finite fields. Current
reads validate canonical reference chains without copying their financial content.
Subject privacy export uses a separate allowlist and the retained subject identity,
so an order reassignment or deleted source cannot hide historical journey records.

Forget and unheld retirement remove personal reference arrays and link/configuration
context from every affected version. Held records remain revoked and unavailable
in ordinary context. Erasure acts before the existing case/source minimization;
canonical operations remain under their own established lifecycle.

Backup restore and initial/repeated merchant import validate original and
destination records separately. They conservatively remove restored journey
references before use. Current subject suppression overrides an obsolete copied
hold; an unsuppressed held personal record causes atomic refusal. Restored journeys
do not resume, send, replace an approval or replay an operation.

## Local verification and rollback

The declared fixture follows a tracking question into an equal-price exchange on
`resolution_case`, loses the independent source response after one replacement,
and continues through a reconstructed coordinator using the original operation ID.
The oracle is the separate fixture source's effect count and the unchanged case,
preview, approval, receipt and operation identities.

The focused selection is 23 new composition cases, 15 retained return-portability,
eight support-workflow and 14 merchant-portability cases. The unchanged runner
limits each invocation to 60 native cases, four whole files and one 60-second
deadline. Actual results and targeted-fault evidence remain distinct from this
contract. Root is the only executor; two nonauthor reviews gate local integration.

Earlier saved refs remain available. Roll back code only after stopping new work
and reconciling unknown canonical operations through their original owners.
Do not delete journey records or change operation identities to make a rollback
appear complete. The retained cumulative checkpoint records exact source and
recovery prerequisites without advancing recovered main.
