# ADR-0072 — Recover original checkout preparation

Status: delegated bounded assignment before implementation.
Protected base: `abcf93f57af54ec03e0179b49c1ec4f7ff0284c7`.

## Assignment and missing behavior

The owner's instruction, "Continue," continues the existing delegated local
development, Git handoff and push authorization. Assign **RCG-5B original
preparation recovery** to the root integration writer on
`feat/rcg5-prepare-recovery`. Formal acceptance, paid/production effects and
release tags remain separate. The reviewed RCG-5A history is the protected base.

The prior journey loses a receipt response after the caller knows its intent ID.
If the preparation response is lost, the caller has only its original preview
and context references. After process loss, native preparation intentionally
requires missing live provenance and status requires the unknown intent ID.
There is no existing lookup of the original preparation outcome. Close this
recovery gap before adding the proposed customer browser review page.

Fresh provider inspection finds Marty UI main
`f81bf70f867569db97f73b06dbaef7813e89118b`; its new application-image release
work does not change delegated transport. PR #1994 remains draft/unmerged at
`aec45c6176618b3fe12d7e51e6809c4ba2d87126`. No new current-state, final-use or
uncertain-outcome contract is supplied. Keep RCG-4B and the complete RCG-5
cross-service journey open. No provider API is inferred from payload schemas.

## Bounded outcome

Add native `DelegatedCheckoutIntents.lookup(scope, {preview_id, context_id})`.
It uses the existing tenant/store-bound `intentIdentity` and `intentId`, with
current customer/resource/contact proof before revealing existence. Compare the
complete identity digest on the same validated record used for normal expiry
observation, historical view and final access/unchanged fences. A match on the
truncated ID alone is insufficient. Return only an existing record; absence must
never create a replacement or authorize another purchase.

Lookup must work without previews, contexts, signer or receipt verifier. It must
not reconstruct personal fields, refresh authority or issue a replacement session.
Retain ordinary minimized/cancelled/held/restored views and current revocation.
The normal historical-read expiry observation may advance the existing revision;
no new receipt, provider call, challenge consumption, queue or commerce effect is
allowed. No asynchronous provider callback is introduced.

Preserve the exact original seven-route v1 API contract and its client behavior.
Add a separate versioned contract and namespace at
`/v1/delegated-checkout-recovery`, with GET `/contract` and POST `/lookup`.
Reuse the actual kernel-bound checkout API composition, native authorization,
strict JSON parser, same-origin checks, 4096-byte ordinary body limit, no-store
responses and finite sanitized failures. Authorize before collecting a body and
again inside native lookup. The lookup result binds the exact supplied original
references to its returned historical intent view. No generalized search, list,
caller tenant/store, endpoint, context or trust provisioning is added.

Extend the existing independent Python caller with explicit `recovery-contract`
and `lookup` commands selecting this namespace. Keep its original contract and
commands intact, bounded strict response decoding, loopback-only transport,
private bearer input, reflected-secret rejection and no automatic retry. Verify
the returned original references exactly. An absence is an observation, not
permission to replace an uncertain operation.

Extend the existing development process harness only with a fixed preparation
response-loss probe and a bounded recovery journey/entry command. Retain the
original receipt-loss behavior and twelve RCG-5A observations. The new journey
must lose an actually completed preparation response, observe the old server's
exit, reopen its original database in a different process and recover the exact
original identity using only the original references. Record original identity
and row count independently of the client's failed response. Prove no new intent,
session, live provenance or commerce effect appears. Bound output/work and clean
only owned processes/directories. This remains local synthetic evidence.

## Writers and allowed changes

Root owns application integration, caller, process journey, documentation and
additive registration in the assigned worktree. A separate implementation writer
may change only `packages/commerce/delegated-checkout-intents.mts` and add
`tests/development/delegated-checkout-recovery.test.mts` on an isolated worktree
from this committed assignment. It must not author either independent review.

Root implementation paths are `packages/commerce/delegated-checkout-api.mts`,
`apps/commerce-api/server.mts`, `clients/delegated_checkout.py`,
`packages/development/delegated-checkout-process.mts`, new
`packages/commerce/contracts/delegated-checkout-recovery.v1.json`, new
`tools/demo-delegated-checkout-recovery.mts`, and new focused recovery HTTP/client
and process test files. Update the architecture/development/current-plan links,
add `docs/DELEGATED-CHECKOUT-RECOVERY.md`, this ADR and `work/records/RCG-5B.md`.

Under ADR-0008, append source membership, actual registered cases and a proposed
capability; update only the licensing source-count observation/explanation.
Refresh existing privacy/catalog source pins only where actual assigned bytes
change, retaining all prior paths, surfaces, schemas, operations, cases, fixture
declarations and obligations. Any new source pins must be strictly additive and
justified by the existing inventory. Do not repair unrelated inherited catalog
closure/count issues in this increment.

Retain all old test/oracle bytes, root/optional dependency manifests, migration
and record schemas, existing HTTP contract, acceptance ledger and workflow policy.
Existing owner behavior is preserved; this adds bounded historical lookup.

## Evidence and independent review

Before implementation, record actual completed preparation, discarded response
and process restart, then an expected lookup failure on the current API. Missing
imports/methods are not a behavioral red. New tests must exercise current proof,
cross-subject/resource/store refusal, exact full identity, absence without writes,
minimization/hold/expiry semantics, unchanged old contract, strict input/output,
client request binding and the actual lost-response/restart journey.

Run focused whole-file new and applicable existing intent, HTTP/client, process
and privacy checks within documented budgets. Fix the exact candidate for
independent authority/security review by `rcg5b_scope` and regression review by
`http_regression_review`; at most three corrective rounds. Preserve author versus
independent execution and exact source/report bindings. Keep raw evidence ignored
and concise review records in the separate Git handoff. The source/identity and
control preservation audit must retain every previous obligation.

Publication remains authorized. Read-only remote inspection still finds Rifare
development at `933600561a989150e2a2d3c4273a57ee84cdad52` and no published RCG
feature branches. Prior native credential and connector permission failures
remain technical limits; do not claim publication or repeat identical blocked
writes without new access evidence. Preserve verified Git bundles if necessary.
