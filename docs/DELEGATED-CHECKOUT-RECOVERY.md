# Recover an original checkout preparation

RCG-5B closes a specific lost-response gap. Preparation can commit before its
response reaches the caller. If the server then exits, the caller has its original
preview/context references but no intent ID. History startup deliberately has no
live preview, context or verifier, so repeating preparation is unavailable.
Explicit lookup now recovers that existing record from the original references.

This builds on the [process lifecycle](DELEGATED-CHECKOUT-LIFECYCLE.md) and
[local checkout API](DELEGATED-CHECKOUT-HTTP.md). It retains historical evidence;
it supplies no provider final-use or merchant execution authority.

## Explicit caller contract

The original `/v1/delegated-checkout` contract and its seven routes are unchanged.
The separate [recovery contract](../packages/commerce/contracts/delegated-checkout-recovery.v1.json)
uses `/v1/delegated-checkout-recovery`:

| Method and path | Input | Result |
| --- | --- | --- |
| `GET /contract` | Current customer bearer | Separate two-route contract, with envelope operation `recovery-contract` |
| `POST /lookup` | Exact `preview_id` and `context_id` | `original` references bound to the existing `intent` historical view |

Use the existing Python client with the original bearer supplied through its
documented private input. These commands require a running native server; the
client does not bootstrap a fixture or accept remote provider credentials:

```sh
python3 -I clients/delegated_checkout.py --base-url http://127.0.0.1:4311 recovery-contract
python3 -I clients/delegated_checkout.py --base-url http://127.0.0.1:4311 lookup \
  --preview-id ORIGINAL_PREVIEW_ID --context-id ORIGINAL_CONTEXT_ID
```

The caller must retain those references before sending preparation. Lookup is an
explicit observation: the client performs one request and never falls back to
preparation or retries a mutation. `NOT_FOUND` under the current session and
references does not establish that a replacement operation is safe. A returned
intent can be inspected or cancelled through the original status/cancel commands.

The client validates the exact echoed references, response operation, historical
qualification, revision/state and false execution-authority flags. Its existing
bounded JSON, loopback transport, bearer handling and reflected-secret rejection
also apply. Original commands retain their original paths and behavior.

## Native identity and privacy

`DelegatedCheckoutIntents.lookup` checks the actual current customer, resource and
contact proof before disclosing record existence. Tenant and store come from that
session. The owner derives the existing identity from those values and the two
original references, selects a validated record by its existing ID, and compares
the **complete identity digest**. The shorter public ID alone is insufficient.

The same selected record passes ordinary expiry observation, historical view,
final access and unchanged-record checks in the native transaction. Lookup may
observe expiry and advance the original revision just as status does. It never
creates an intent, receipt, session, provider call, challenge consumption, queue,
order or payment. A changed record or lost authority fails the final fence.

History lookup needs no live preview, context, signer or verifier. Cancelled,
held, erased and restored views use existing privacy projections. Echoing the
caller's two supplied references binds the response; it does not reconstruct
erased stored personal fields or live provenance. Already returned caller copies
cannot be recalled, and memory zeroization is not claimed.

The server authenticates and authorizes before collecting a body, then native
lookup checks authority again. The new route collects at most 4096 bytes and
uses the existing strict JSON decoder to reject duplicate members, malformed
UTF-8, unpaired surrogates and unsupported structure. It preserves exact
loopback host/origin, no-store output and finite sanitized errors/logs. The
original general HTTP parser and seven-route contract are unchanged.

## Reproduce the process-loss journey

```sh
python3 tools/install_receipt_runtime.py --offline
node --experimental-strip-types tools/demo-delegated-checkout-recovery.mts
```

If the unchanged optional JOSE archive is not cached, use the documented installer
without `--offline`. The demonstration accepts no arguments, external endpoint,
database path or credentials. It uses the existing disposable native fixture,
two separate databases, a copied independent Python caller, bounded work/output
and owned cleanup. Its 45-second deadline and real native validity windows are
not relaxed for slow execution.

The eight report observations are:

1. Read both separate contracts and observe absence before preparation.
2. Forward preparation exactly once, wait for its actual successful response,
   retain only original identity metadata privately, then discard the response.
   The client must fail without learning an intent ID.
3. Kill the original server, observe its exit and reopen the same database in a
   different history process using the preexisting bearer.
4. Recover and compare the original ID, creation time, revision and binding
   digest through the copied client's explicit lookup; ordinary status agrees.
5. Refuse fresh preparation/receipt work without live provenance, preserving the
   recovered record.
6. Refuse absent and mixed original references, cross-instance references and
   foreign bearers.
7. Cancel the original record by revision and recover its same minimized view.
8. Retain exactly one original intent, zero in the other instance, the original
   session count across restart, and unchanged native/source commerce digests.

Successful JSON includes exact source commit/tree, dirty state, direct source
hashes, eight checked observations, process IDs, copied-client digest and cleanup
completion. It omits bearer, raw receipt, context and signing material. The fault
has a fixed owned destination and preparation route; it cannot forward arbitrary
requests. The original receipt-loss journey and its twelve checks remain usable.

## Focused verification and limits

```sh
python3 tools/dev_tests.py --files \
  tests/development/delegated-checkout-recovery.test.mts \
  tests/development/delegated-checkout-recovery-http.test.mts \
  tests/development/delegated-checkout-recovery-process.test.mts
```

The new selection has 32 cases: 17 native, twelve HTTP/client and three process
cases. It includes a valid minimized record sharing only the truncated ID prefix,
proof before corrupt-record parsing, late authority and record fences, history
without owners, privacy/expiry, strict transport, response binding, no automatic
fallback and actual process loss. Separate unchanged intent, lifecycle,
HTTP/client and privacy selections retain the prior obligations. Raw test reports
remain ignored; independent review records and exact candidate bindings belong
in the separate Git handoff.

All reports retain `execution_authorized: false`, `provider_final_use: false`,
`full_rcg5_complete: false`, `target_stack_qualified: false` and
`os_sandbox_qualified: false`. This is local synthetic recovery evidence. Actual
provider reconciliation, remote sender-bound access, isolated cross-service
deployment, target PostgreSQL/React/browser qualification and production effects
remain open. The customer browser review page is a subsequent bounded candidate.
See [ADR-0072](decisions/0072-original-checkout-preparation-recovery.md) and
[the work record](../work/records/RCG-5B.md).
