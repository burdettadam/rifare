# Local delegated checkout HTTP interface

RCG-4A-HTTP makes the existing native checkout previews and durable intent
observations available through Rifare's loopback diagnostic commerce server.
An independent Python client can prepare/read a preview, retain an intent,
submit a signed receipt, read history and cancel a local intent. Every response
states `execution_authorized: false`. No provider final use or merchant purchase
is performed. [ADR-0070](decisions/0070-delegated-checkout-http.md) assigns this
bounded increment; [the work record](../work/records/RCG-4A-HTTP.md) records its
verification and limitations.

## Server construction

Configure the actual native owners at the application composition boundary:

```ts
const checkout = new DelegatedCheckoutApi(kernel, { previews, receipts });
const server = await startCommerceServer({
  kernel, caps, customers, simulator, checkout,
});
```

`previews` is the original `CheckoutPreviews` instance configured with the native
cart and explicit synthetic shipping/fee source. `receipts` is the original
`DelegatedCheckoutReceipts` bound to that preview owner, the same kernel, and
independently configured current context and pinned verification trust. Read
[checkout preparation](CHECKOUT-PREVIEWS.md) and
[receipt verification](DELEGATED-RECEIPT-VERIFICATION.md) for those owners.
The wrapper constructs its intent owner internally. Foreign-kernel or invalid
wrapper/owner injection fails before a listener is opened.

The HTTP input cannot create trust, contexts, source quotes, grants or keys.
A new preview must receive its context from the configured server-side producer
before intent preparation. There is no production provider context producer in
this repository. A caller's signed token cannot establish its own expectations.

Without checkout configuration the ordinary server still starts. Current
customer proof can read or cancel retained intents, and exact-token historical
retries retain their existing native semantics. New preview preparation and
fresh receipt capture remain unavailable. Restarting the server does not
reconstruct a live preview, provider context or verifier provenance from SQL.

## Routes and authority

All paths below begin with `/v1/delegated-checkout`. The exact versioned contract
is [delegated-checkout-api.v1.json](../packages/commerce/contracts/delegated-checkout-api.v1.json).
Requests use the existing `Authorization: Bearer …` customer session and
`Content-Type: application/json` for POST. IDs are ordinary JSON fields, not
query parameters. Unknown fields, routes and methods fail closed.

| Method and path | Exact request fields | Meaning |
| --- | --- | --- |
| `GET /contract` | None | Read this local route contract. |
| `POST /preview` | `cart_id`, `shipping_quote_id`, `fee_quote_id` | Prepare an original frozen synthetic preview. |
| `POST /preview-status` | `preview_id` | Revalidate the original preview against current native facts. |
| `POST /prepare` | `preview_id`, `context_id` | Retain original intent identity and binding. |
| `POST /status` | `intent_id` | Read current-proof historical intent status. |
| `POST /receipt` | `intent_id`, `compact_jws` | Verify and retain one signed receipt observation. |
| `POST /cancel` | `intent_id`, `expected_revision` | Cancel only the expected current revision. |

An owner, staff, worker or agent session cannot impersonate the customer on this
surface. The wrapper explicitly checks the customer role and native current
resource/contact proof before reading a receipt body. Native owners repeat
their checks after body collection and asynchronous verification. Cross-tenant,
cross-store and foreign-resource IDs disclose no retained purchase or receipt.
Existing exact host/origin restrictions and loopback-only listening remain.
This opaque local session is not an OAuth token or remote sender-bound delegate.

Successful responses have this envelope:

```json
{
  "profile": "commerce-sqlite-diagnostic",
  "qualification": "candidate_contract_only",
  "evidence_status": "historical_observation",
  "execution_authorized": false,
  "operation": "status",
  "result": { "...": "original native intent view" }
}
```

The nested result is the existing native projection. An `evidence_verified`
state records a verification observation; it does not assert that the provider
grant is current or consumed. Original deadlines, local duplicate claims,
terminal observed expiry, minimization and cancellation remain owned by
[the durable intent implementation](DELEGATED-CHECKOUT-INTENTS.md).

## Limits, failures and privacy

The receipt route permits a 102,400-byte JSON envelope around the existing
100,000-character compact-JWS maximum. Every other route retains a 4,096-byte
request limit. Both announced lengths and streamed chunks are bounded; excess
input is discarded without accumulating it and receives a small refusal.
The shared reader retains the socket for that response using Node's documented
[non-destroying readable iterator](https://nodejs.org/download/release/v24.22.2/docs/api/stream.html#readableiteratoroptions).

Responses use `cache-control: no-store`. Server logs contain only an event,
status and finite code. Raw receipt bytes, bearer credentials, context and
identifiers are not logged. Unexpected exceptions produce `INTERNAL_ERROR`
without their arbitrary message. Compact JWS exists transiently in bounded
request/verifier memory and is not persisted. Existing intent export, erasure,
holds and recovery own the retained projection. Prior caller/process copies
and forensic memory zeroization remain separate limitations.

| HTTP status | Interpretation |
| --- | --- |
| 200 | Local observation returned. |
| 400 / 415 | Invalid input, rejected receipt/preview, or wrong content type. |
| 403 / 404 | Current authority denied, or unavailable scoped resource/path. |
| 405 | Wrong method; `Allow` identifies the route's method. |
| 409 | Original identity/revision conflict, terminal state, or recovery fence. |
| 413 / 429 | Body or local capacity limit. |
| 500 / 503 | Unexpected internal failure or unavailable configuration/source. |

## Independent local caller

[clients/delegated_checkout.py](../clients/delegated_checkout.py) uses only the
Python standard library. Supply the existing customer bearer privately through
`RIFARE_BEARER`; the CLI accepts no credential argument. Supply a compact receipt
through stdin. A single file-ending LF or CRLF is accepted. The client sends
only to an exact literal `http://127.0.0.1:PORT` base URL and uses no environment
proxy, redirects, cookie jar or automatic retry.

```sh
python3 clients/delegated_checkout.py --help
python3 clients/delegated_checkout.py --base-url http://127.0.0.1:8080 contract
python3 clients/delegated_checkout.py --base-url http://127.0.0.1:8080 prepare --preview-id PREVIEW_ID --context-id CONTEXT_ID
python3 clients/delegated_checkout.py --base-url http://127.0.0.1:8080 status --intent-id INTENT_ID
python3 clients/delegated_checkout.py --base-url http://127.0.0.1:8080 receipt --intent-id INTENT_ID < receipt.jws
python3 clients/delegated_checkout.py --base-url http://127.0.0.1:8080 cancel --intent-id INTENT_ID --expected-revision 2
```

Replace the example port and IDs with those from the configured application.
The commands do not bootstrap a server or provision provider context. The
client bounds response bytes and parsing, validates the exact diagnostic
envelope and original identity, rejects duplicate keys/nonfinite numbers,
reflected input secrets and any execution-authorized response. Errors print
only finite local codes; server-controlled error bodies are not echoed.

A lost HTTP response may follow a completed local mutation. Keep the original
intent ID and explicitly read its status. Do not infer failure or create a new
identity. Exact receipt retries retain native historical semantics; preview
creation has no idempotent transport-retry contract. Neither this client nor
the API supplies provider unknown-outcome reconciliation.

## Reproduce the bounded integration

The native tests generate original ephemeral synthetic signatures; no
proprietary protocol vector is required. Install the pinned optional runtime
from its cached archive, then run the two new whole files:

```sh
python3 tools/install_receipt_runtime.py --offline
python3 tools/dev_tests.py --files tests/development/delegated-checkout-http.test.mts tests/development/delegated-checkout-client.test.mts
```

The client tests copy the Python file into an isolated temporary directory and
execute it in a separate process against the actual native loopback server.
Other cases cover malicious response/transport behavior with bounded local
stubs. This demonstrates a local customer application boundary. An independent
caller against isolated Rifare, ElevenID and merchant deployments, remote
sender binding, provider final use, real reconciliation and production
qualification remain open.
