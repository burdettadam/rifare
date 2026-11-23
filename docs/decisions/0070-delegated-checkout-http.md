# ADR-0070 — Local delegated checkout application boundary

Status: authorized bounded development assignment before implementation.
Base: `83a76927ffdd8f50e8360c66896c634612ff6723`.

## Assignment and ownership

The owner's instruction "Continue with development. Push changes freely"
continues local development, durable Git handoff and publication authority.
Assign `RCG-4A-HTTP` to the root integration agent on
`feat/rcg4-checkout-api`. Preserve the reviewed RCG-4A branch and all original
RCG-2/3/4A behavior. This is a local application integration increment, not
RCG-4B provider execution or completion of the independent deployment journey
in RCG-5. Formal acceptance, production, paid effects and release tags remain
outside this assignment.

Fresh authenticated reads still find Marty UI main at
`f479d568a9ef750d804e6dde61ab70b318700963`, PR #1994 open/draft at
`aec45c6176618b3fe12d7e51e6809c4ba2d87126`, and protocol main at
`a9ce6a1d912f22a5627faebb482c44b9104d840d`. The 400-route Gateway contract
and the draft service README still contain no callable delegated final-use or
uncertain-outcome transport. No endpoint may be inferred from payload schemas.

## Bounded outcome

Expose the existing native preview, preview read, intent preparation, retained
status, receipt capture and revision-bound cancellation through the existing
loopback commerce HTTP server. Compose the actual `CheckoutPreviews`,
`DelegatedCheckoutReceipts` and `DelegatedCheckoutIntents` owners through one
small typed API wrapper. Bind injected owners to the server's actual kernel;
construct the intent owner internally. Missing preview/receipt configuration
must stay unavailable while current-proof historical status and cancellation
remain possible. Do not reconstruct saved preview/context/provenance.

Use the existing bearer authentication, host/origin checks, current customer
proof/resource owner, no-store responses and sanitized status/code logging.
Customer authorization must occur before receipt body collection. HTTP accepts
only the native IDs, expected revision and compact JWS; no context, trust, keys,
fixture setup, endpoint, verified flag, approval or snapshot provisioning route.
All successful envelopes explicitly state that execution is unauthorized and
the profile is diagnostic. Do not add remote/OAuth/DPoP claims or expose the
listener beyond loopback. No merchant effect, queue, worker, payment or provider
send is added.

Publish an exact versioned local route contract and an independent Python
standard-library caller. The caller uses an environment credential, bounded
stdin receipt input, exact loopback URLs, no proxy or redirects, bounded
response parsing and no automatic retry. It must not print bearer/JWS input or
accept a response claiming execution authority. Copy and execute the caller
outside the repository import tree for actual process-separated HTTP evidence.
This client is a local diagnostic customer client, not an authenticated remote
delegate or a complete ElevenID deployment.

## Request and error boundaries

Retain the shared JSON parser's 4,096-byte default. Permit only the receipt
route a bounded 102,400-byte envelope, sufficient for the existing maximum
100,000-character compact JWS. Enforce both announced and streamed lengths.
Keep a refused stream available long enough to send its bounded error; discard
remaining input without retaining it. Existing route behavior/limits remain.
Known local errors use an explicit finite mapping. Unexpected errors return a
generic internal failure and never reflect arbitrary exception text or input.
Unsupported paths/methods, malformed JSON, oversized/chunked bodies, changed
proof and late verification failure must not mutate intent evidence.

## Allowed paths and controls

Runtime: `apps/commerce-api/server.mts`, new
`packages/commerce/delegated-checkout-api.mts`, and the minimal per-call limit
extension in `packages/development/http.mts`. Supporting: new route contract,
`clients/delegated_checkout.py`, new HTTP and independent-caller tests/helper,
a concise API guide, work record, and current architecture/plan links. Original
native owner implementations, root/optional manifests, migrations, dispatch
owners, provider code and all old tests remain unchanged. Any necessary scope
extension must be recorded before its implementation.

Under ADR-0008, append actual new source members, proposed capabilities and
native test registrations. Update only source membership/count observations in
the licensing fixture. Refresh affected runtime/source pins and explicitly
classify the existing HTTP surface's new transient receipt handling; retain all
privacy surfaces, the storage schema and old handling obligations. Existing
catalog pins may change only for actual included transitive source inputs;
retain all operations, fixtures, cases and original denominators. No accepted
ledger, workflow policy, behavioral oracle or qualification criterion changes.

## Evidence and independent review

Demonstrate the missing route or targeted transport fault through behavioral
assertions before implementation. Run focused new HTTP/client cases and
unchanged commerce HTTP, receipt/intent and privacy coverage selections where
affected. Exercise real signatures, customer ownership, current proof, async
revocation/cancellation, exact retry, body bounds, sanitized output, unavailable
configuration, and absence of commerce effects. Preserve inherited type/catalog
failures accurately. Obtain independent authority and regression reviews on the
fixed final candidate with at most three corrective rounds. Reviewers cannot
author the code they review.

The root writes API/server/parser and integration records in this worktree. A
separate assigned writer may implement only the independent client and its new
tests in an isolated branch from this committed assignment. Integrate by native
Git, preserve local evidence under ignored `evidence/`, and save verified Git
bundles if the authorized remote still cannot accept writes.

## Prior structural supplement: application dependency pins

Read-only regression inspection found that the new application route makes five
previously unpinned runtime/contract files reachable from the pinned server:
`checkout-previews.mts`, `delegated-checkout-receipts.mts`,
`delegated-checkout-intents.mts`, `delegated-checkout-api.mts` and its versioned
HTTP contract. Authorize their additive catalog oracle pins, plus the directly
related existing intent-record and intent-privacy modules. Refresh the existing
server and shared HTTP-reader pins. These seven additions only bind actual
source bytes; no operation, case, fixture, source behavior or denominator changes.
The catalog verifier checks supplied pins, not full import closure. Six inherited
omissions in migration/support modules remain outside this increment and must
not be represented as a complete transitive-source qualification.
