# Internal delegated-use client and native START sender

RCG-4B-C5 selects the provider's existing internal mTLS command interface for a
bounded Rifare client. It connects the actual native checkout preview and
durable original journal to START_USE and explicit RECOVER_RESULT. The assignment
is [ADR-0079](decisions/0079-internal-delegated-command-transport.md); exact
implementation, execution and review status is in [the work record](../work/records/RCG-4B-C5.md).

This is a server-side TypeScript composition. The existing local customer HTTP
routes and Python caller retain their C4 behavior: their recovery operation
constructs an unsent request. C5 adds no customer-facing send route. The executable
checkout development fixture also retains its earlier configuration; wiring a
larger runnable journey remains a distinct task.

## Selected provider boundary

The client sends only:

```text
POST <configured-origin>/internal/v1/organizations/<configured-organization>/delegated-use-commands
```

The selected contract is the provider's
[internal HTTP interface](https://github.com/ElevenID/marty-ui/blob/37b7fdc3d3f1c223613ad98fe601d7d86e6a3600/rust/services/delegated-authority/USE_HTTP.md)
and [mTLS identity profile](https://github.com/ElevenID/marty-ui/blob/37b7fdc3d3f1c223613ad98fe601d7d86e6a3600/rust/services/delegated-authority/USE_MTLS.md),
pinned to draft PR1994 `37b7fdc`. Protocol PR38 remains `6126da7`. These are
source-inspected contracts. Local TLS tests do not establish an actual Marty
deployment, provisioned account, current grant or production custody.

Provider configuration maps the authenticated non-CA leaf certificate's exact
SPIFFE URI and complete DER SHA-256 digest to a full MACHINE_IDENTITY. Current
provider access and grant evaluation are separate checks. Rifare configuration
must agree with that separately provisioned mapping; a syntactically valid local
correlation cannot establish it.

The client uses one to eight explicit, currently valid CA certificates and native
hostname verification. Its bootstrap accepts exactly one non-CA client leaf
certificate, with exactly one SAN entry: the selected canonical SPIFFE URI.
It requires the exact configured certificate digest, a matching private key and
current certificate validity; an appended client chain is outside this narrow
profile. The origin is the complete canonical HTTPS origin, for example
`https://internal.example:8443`, with no trailing slash, path, query, fragment,
credentials or repaired spelling. An explicit default `:443` is rejected.
Callers cannot supply paths, headers, proxies, redirect destinations, tokens or
certificate-verification callbacks.

## Composition

Create an `InternalDelegatedUseClient` from server-owned material:

```ts
const transport = new InternalDelegatedUseClient({
  origin,
  correlation,             // provider_ref, organization_id, MACHINE_IDENTITY actor
  ca_pem,                 // explicitly selected server trust
  certificate_pem,
  private_key_pem,
  certificate_sha256,      // sha256:<complete leaf DER digest>
  workload_uri,            // exact canonical SPIFFE URI in that leaf
  timeout_ms,
});
const sender = new DelegatedCheckoutCommandSender(kernel, {
  correlation,
  starts,                 // actual same-kernel DelegatedCheckoutStarts
  transport,
});
```

Configuration is validated, detached and retained privately. The sender checks
the concrete transport identity and exact correlation, captures concrete owner
methods, and creates its own existing C2 journal. Forged prototypes, proxies,
instance method shadows and configuration accessors cannot replace the native
owners. Existing C3 grant configuration remains an unverified input; the provider
must independently authorize its own operation.

The native operations are:

| Method | Behavior |
| --- | --- |
| `start(scope, {command_id, preview_id})` | Atomically admit one new native START, commit the original, establish mTLS, recheck current native provenance, send once and retain the bound observation. |
| `recover(scope, command_id)` | Use current customer proof to recover the retained complete original, send its exact RECOVER_RESULT, and preserve the first immutable result. |
| `close()` | Invalidate future calls, pending native guards and post-response observation. Injected owners stay live; the application separately closes the transport to abort its pending requests. |

The underlying client exposes distinct `start(original, guard)` and
`recover(original, recovery, guard)` methods. Both require a complete START
expectation and use the existing C1 encoder and response binder. They never send
FINALIZE. Their synchronous guard is an integration port; the native sender
supplies it from the actual commerce owners. Calling the wire adapter directly
does not provide native admission, permission or durable recovery.

## Original admission and the final native check

`DelegatedCommandClaims.claimNewCheckoutStart` requires absence inside the
existing top-level SQLite transaction. It uses the actual current preview and
commits the complete canonical START before network work begins. A separate
`currentCheckoutStart` method requires that original to exist and shares C2/C3's
current proof, native preview, egress and final-row checks. It never inserts or
reconstructs an absent record.

The transport calls its native guard before connecting and again after
authenticated TLS, before writing any HTTP application bytes. For START, the
sender requires the exact original identity, canonical request and digest,
`claimed` state, revision 1, null observation and an unretired record. Changes to
the purchase, customer proof, original record or source lifetime prevent START
transmission. Deleting a row while TLS is pending cannot recreate it under a
fixed clock. Recovery instead rechecks current customer access, egress and the
unchanged retained original; an observed original remains recoverable without
a live preview or START source.

After an awaited response, C2's existing observation method independently
rechecks current access, egress and retirement before retaining the result.
Local withdrawal during that wait can therefore prevent observation even if the
provider already received START. That situation preserves uncertainty; it does
not undo a provider request or permit another mutation.

## Explicit recovery and the availability limit

Each admitted original receives **one local opportunity to send START**. Admission
is durable, while the application intentionally stores no separate send-attempt
state. Consequently, every existing original is recovery-only for this sender:

| Situation | Subsequent behavior |
| --- | --- |
| TLS or hostname verification fails before HTTP | Retain the original; refuse another START; allow explicit recovery under current access. |
| Purchase changes during TLS | Send no HTTP bytes; retain the original for explicit historical handling. |
| Response is lost, truncated or invalid | Retain the unresolved original; recover that same UUID and digest. |
| Process ends after admission but before transmission | Restart with the same fixed correlation and recover the original. Absence at the provider remains unresolved. |
| C4 already prepared the original locally | Refuse C5 START. C4 preparation is not a transferable send capability. |
| Provider recovery returns 404 or unresolved preparation | Report a finite failure; preserve the original and keep START closed. |
| The original is observed, cancelled or minimized | Never reopen START admission; existing current-proof and retirement rules govern history/recovery. |

This deliberately sacrifices availability in the known-unsent case. Reopening
an admitted original requires a separately designed durable attempt contract;
neither a network error nor provider absence proves permission to retry or
generate a replacement UUID. The caller supplies the original command ID once.

A history-only process may construct the sender without `starts`, while retaining
the same explicit transport and correlation. It can recover historical outcomes
without reconstructing C3's process-local preview provenance. The first validated
response value, result and timestamps remain immutable through later matching
recovery; the journal does not retain the original HTTP serialization.

## Data and authority boundaries

Requests use the fixed internal path and canonical C1 bytes. Response parsing
retains original bytes through bounded streaming and the strict existing parser;
duplicate members, malformed Unicode, changed original IDs/digests and mismatched
purchase results are rejected. The overall timeout defaults to 5,000 ms and
accepts integer values from 1–30,000 ms. Each transport permits at most eight
pending requests. Response headers are limited to 16,384 bytes and streamed
bodies to 65,536 bytes; the unchanged C1 parser applies its own additional bounds.
Finite errors and owned request cleanup bound failed connections. There is no
automatic request retry, redirect, cookie or forwarded identity path.

C2 history continues to return `historical_unverified_observation`,
`local_unverified_input`, `candidate_contract_only` and false
`provider_authenticated`, `receipt_signature_verified` and `execution_authorized`
flags. Successful TLS protects this selected connection; it does not change the
journal's contract or authenticate a current receipt context. A P03 challenge UUID
is not the independently signed proof nonce. No request-JWS verification, proof
submission, FINALIZE composition or native receipt approval is added.

TLS keys, certificates and raw transport buffers are transient process material.
They add no durable journal fields and do not appear in ordinary error messages.
C2 does retain the canonical original command and first validated response value
under its existing export, retirement, hold and minimization rules. Closing
owned requests and releasing references does not guarantee deletion from native
TLS buffers, JavaScript strings, callers, swap or process snapshots. The existing
privacy inventory records those limits.

## Verification and continuation

The C5 tests use ephemeral credentials, real local TLS peers and actual native
SQLite/source owners. They observe committed originals before requests, the exact
peer certificate/path/body, plaintext HTTP byte counts, lost responses, explicit
recovery and unchanged commerce effects. The independent sender tests control the
TLS handshake to change native state during the actual asynchronous wait.

All **158 selected cases** passed freshly on clean native `3ecb91e`: 44 new and
114 existing cases across thirteen whole files. Published implementation
`9ecb34e5635fbc7ec0a31ef186c1d6f41b6c2570` has the exact reviewed tree
`e9ffcfe55aeb692e35c17d3e6403e3262ba23f64`. Both independent reviews found no
scoped blocker. Removing the final native guard caused a changed purchase to
reach the peer; removing fresh-admission refusal caused a second START after
response loss. The work record preserves those faults' actual earlier execution
identities and exact unchanged-input equivalence.

The following are separate ordinary invocations, each within sixty cases,
four files and sixty seconds:

```sh
python3 tools/install_receipt_runtime.py --offline
python3 tools/dev_tests.py --files tests/development/delegated-use-client.test.mts tests/development/delegated-command-codec.test.mts tests/development/delegated-command-native.test.mts
python3 tools/dev_tests.py --files tests/development/delegated-checkout-command-sender.test.mts tests/development/delegated-checkout-starts.test.mts tests/development/delegated-command-claims.test.mts
python3 tools/dev_tests.py --files tests/development/delegated-command-admission.test.mts tests/development/delegated-command-process.test.mts tests/development/privacy-coverage.test.mts tests/development/delegated-command-catalog.test.mts
python3 tools/dev_tests.py --files tests/development/delegated-use-catalog.test.mts tests/development/delegated-checkout-commands.test.mts tests/development/delegated-checkout-command-client.test.mts
```

The work record pins raw reports, runtime/OpenSSL observations and closing
documentation equivalence. These are local TLS and native SQLite observations.
A passing local peer does not establish a provider process or complete
cross-service journey.

Closing inspection found provider `3c05227` adds an optional public managed-machine
profile on the same mTLS listener, while the selected internal route remains.
[The provider checkpoint](DELEGATED-COMMAND-CONSUMER.md#provider-and-next-integration)
records its exact routes and unverified request/client boundary. It is a next
integration input and does not extend this fixed-path client. Public commands and
original-bound challenge/request handoff can reuse the native lifecycle; then
independent signed request verification must precede proof/FINALIZE and current
receipt-context composition. Actual endpoint provisioning, registered
identity/trust acquisition, certificate lifecycle, full RCG-5/6 and target
PostgreSQL/React qualification remain open.
