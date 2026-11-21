# Disposable checkout process lifecycle

RCG-5A supplies a runnable local checkout demonstration over the existing
[checkout API and Python client](DELEGATED-CHECKOUT-HTTP.md). It starts real native
server processes with separate SQLite files, executes the copied independent
client, loses a response, kills a server, and reopens its original evidence in a
new process. This is a local prerequisite for the full isolated deployment
journey. Provider final use and merchant execution remain open.

## Run it

From the native Rifare checkout, using the supported Node version and Python 3:

```sh
python3 tools/install_receipt_runtime.py --offline
node --experimental-strip-types tools/demo-delegated-checkout.mts
```

If the exact optional JOSE archive is not cached, omit `--offline` for the
documented installer. It validates the unchanged pinned `jose` 6.2.18 package
and notices under ignored root `node_modules/jose`. No root or optional dependency
manifest changes are required. Do not install dependencies inside source folders.

The command accepts **no arguments, external endpoint, database path or provider
credential**. Its fixed child programs receive only a minimal operating-system
environment and their own disposable synthetic bootstrap information. It creates
an owner-only temporary directory and normally removes it before returning.
Successful output is one JSON report with source commit/tree, dirty state, direct
entry-file hashes, twelve checked observations, process IDs and a copied-client
digest. Failure output is a finite code, without the input or arbitrary exception.

The final candidate should be committed and the report's `source.dirty` should be
false for a checkpoint observation. During development, a dirty result is clearly
identified. The report does not authenticate its own reviewer or accept a goal.

## What the command observes

| Observation | Actual boundary exercised |
| --- | --- |
| Independent processes | Two concurrent HTTP server processes, distinct loopback ports, separate native/source databases, and Python callers copied outside repository imports |
| Contract and preview | Current customer bearer reads the exact API contract and prepares/reads a 6800-minor-unit synthetic USD preview |
| Original intents | The independent client creates two intents from original server-owned preview/context pairs; repeated preparation retains identity |
| Instance isolation | A bearer from one instance is refused by the other; an instance's own bearer cannot read the other intent ID |
| Lost response | A one-use loopback fault discards a completed native receipt response; explicit status retrieves the same original committed intent |
| Exact retry | Repeating the original signed bytes returns the same receipt-history view |
| Process loss | The original server is killed and observed exiting; a different server PID opens its existing database |
| Retained history | Current-proof status and exact receipt retry retain original IDs, revisions and history after process loss |
| Missing live provenance | A prepared but uncaptured intent cannot acquire new receipt evidence; fresh preview access and preparation remain unavailable |
| Revision-bound cancellation | Current revision cancels; a stale cancellation revision conflicts |
| Other instance continues | The second server retains its original independent receipt history across the first server's loss |
| No commerce effects | Complete synthetic source ledgers and selected native commerce/effect/resource ledgers match their original digests |

The response-loss fault has a fixed local destination and one receipt route. It
does not alter the application server or the client's normal transport behavior.
It waits for the real upstream response to finish, discards it, and checks the
native result through the original intent. No mutation is automatically retried.
This observation concerns local receipt evidence, not provider reconciliation.

## Synthetic startup and history startup

Fresh fixture startup uses the actual kernel, CustomerAccess challenge/proof
owner, native synthetic catalog/cart/quote sources, CheckoutPreviews,
DelegatedCheckoutReceipts, pinned JOSE verifier and DelegatedCheckoutApi. It
prepares two independent preview/context pairs but creates no intents. The
Python caller performs intent preparation and receipt capture through HTTP.

Original ephemeral synthetic signing keys, complete contexts, raw receipt bytes
and customer bearer remain in process memory or the private parent/child pipe.
There is no fixture or context provisioning HTTP route. The two SQLite files
contain native synthetic records and hashed session/proof bindings; a small
nonsecret marker binds instance and schema identity. Files and directories use
private permissions and reject unsafe links or an unexpected existing layout.

History startup verifies the original marker, store identity, schema and
migration records before constructing the native kernel. It does not reseed,
issue a replacement session, load a signing key, or reconstruct a preview,
context or verifier. The parent reuses its original in-memory customer bearer.
Persisted session revocation or changed customer proof therefore remains a
refusal, as checked in the focused fixture tests.

The fixture uses the real wall clock and short native validity windows. The
demonstration has a 45-second deadline, bounded startup/client output and owned
process cleanup. Slow or unavailable prerequisites produce failure; they are not
converted to skips or refreshed authorization. Interruption stops owned child
handles and removes only the allocated directory. Forced termination of the
parent itself can leave its temporary files for the operator to inspect and
remove; this is not crash-proof resource reclamation or physical erasure.

## Focused verification

```sh
python3 tools/dev_tests.py --files \
  tests/development/delegated-checkout-fixture.test.mts \
  tests/development/delegated-checkout-lifecycle.test.mts
```

The fixture cases include current proof and revoked-session behavior across
history startup, no persisted raw secrets, exact marker/instance/schema checks,
nonempty-directory and file/link refusals, read-only snapshots, and child startup
and parent-disconnection handling. Controller cases exercise the complete real
process journey, exact copied-client bytes, handle ownership, interruption,
failed restart cleanup and command input refusal. Prior API/client, native
intent/receipt and privacy tests remain unchanged.

All reports retain `execution_authorized: false`, `provider_final_use: false`,
`full_rcg5_complete: false`, `target_stack_qualified: false`, and
`os_sandbox_qualified: false`. Separate processes do not establish OS-level
isolation, network confinement, a deployed ElevenID service, real merchant
effects, production privacy or formal acceptance. The native wall-clock and
single-process SQLite boundaries remain. See [ADR-0071](decisions/0071-delegated-checkout-process-lifecycle.md)
and [the work record](../work/records/RCG-5A.md) for assignment and evidence.
