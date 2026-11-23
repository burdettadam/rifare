# RCG-4B-C6 — Public managed-machine command and request handoff

State: public wire component implemented and locally tested; native composition,
fault qualification, independent reviews and publication remain pending.

Resumed November 23 from integrated `8cd2a09` on
`feat/rcg4b-public-caller`. Root owns tests, native composition and integration.
The public transport implementation writer is assigned
`impl/medusa-public-caller` in `rifare-public-caller-impl`, to be retired
after integration and checkpoint preservation. Provider source is refreshed to
`169ba94680653a7235319498f5bff2f6da221515`. Qualified endpoint and enrolled
caller evidence remain external prerequisites owned by the provider worker.
Base: `c88799bdd0d3b9211be7f8dbf1d04cb7104de1c0`.
Branch: `feat/rcg4b-public-caller`.
Assignment: [ADR-0080](../../docs/decisions/0080-public-managed-machine-caller.md).

Target update: ADR-0081 and [ADR-0083](../../docs/decisions/0083-medusa-cart-context.md)
supersede the old SQLite-specific composition. COMMERCE-CONTEXT-01 now supplies
locally verified native cart ownership and persisted observations, with no sender
or approval authority. C6 still needs the supported ElevenID authority selection,
native original-operation journal and atomic admission/currentness boundary.
Refresh upstream pins before its implementation; this record's original source
facts below remain historical assignment evidence, not current runtime qualification.

## Objective

Add a distinct Rifare client for the optional public managed-machine profile found in provider draft PR1994 at
`3c05227fe0a2da1216c8d4306a9e2ca0f9ea432a`. The first bounded integration covers original-bound START/recovery and challenge-bound retrieval of the exact signed authorization-request artifact. The artifact remains explicitly unverified.

## Source facts inspected

- Public command: `POST /v1/organizations/{organization}/delegated-use-commands`.
- Challenge request: `GET /v1/flows/instances/{challenge}/request`.
- A CHALLENGE response carries exactly one Link with relation `urn:marty:delegated-use:request`; it must bind to the same configured HTTPS origin and exact challenge path.
- The request media type is `application/oauth-authz-req+jwt`.
- Both routes are selected only by the optional default-off managed-machine profile on the provider's mandatory mTLS listener.
- The upstream Rust client expressly labels fetched request bytes unverified and requires caller-side independent signature/context verification before proof submission.

The C5 internal route and its source remain unchanged. No provider tests or deployed endpoints were accessed.

## Work sequence

1. Freeze exact provider source pins and implement the separate public transport adapter.
2. Write local real-mTLS peer tests before/alongside implementation; independently author Link parsing, request artifact and native lifecycle assertions.
3. Compose the public transport with the existing concrete native sender/journal, preserving atomic admission and recovery-only semantics.
4. Run new tests and unchanged C5/C1/C2/C3 regressions in bounded whole-file invocations.
5. Run actual negative mutations for Link origin/challenge binding and duplicate Link acceptance.
6. Complete independent authority/security and regression reviews, update controls/catalog/docs, then publish the feature branch with exact execution/equivalence evidence.

## Evidence ledger

The independent root-authored public wire test reached the local mTLS peer
using the unchanged C5 adapter and failed specifically on its internal command
path versus the required public command path. This establishes the targeted
wire behavior before introducing the public adapter. The ignored log is
`evidence/operation-journal/c6-public-route-red.log`. Seven new whole-file
test groups specify public START/recovery, exact unverified artifact bytes,
fresh authenticated GET, original/response binding, closed Link destinations,
artifact rejection and guard withdrawal. These remain unqualified until the
public implementation is integrated and the actual tests pass.

| Item | Status |
| --- | --- |
| Provider source inspection | Complete; source-only |
| Assignment/ADR | Complete |
| Implementation | Public adapter and internal native authority session composed at `60fdc8a`; durable response observation remains pending |
| Local TLS tests | 23 public and 20 unchanged internal groups passed on `60fdc8a` |
| Native integration tests | Native PostgreSQL plus real local mTLS START, original recovery, request retrieval, cart change during TLS and close during blocked database admission passed on `60fdc8a` |
| C5 regression | Unchanged internal wire file passed all 20 groups; other native regressions pending |
| Fault injections | Link destination and duplicate acceptance faults caught at unchanged rejection assertions; later implementation refresh pending |
| Independent reviews | Scoped authority reviews found and verified correction of export omission and session-close race; final C6 reviews pending |
| Publication of implementation | Not done |

No claim of functional support, provider qualification or formal acceptance is made by this assignment record.

## Native fence interruption rehearsal

At `52ef90d`, a disposable PostgreSQL statement trigger made a separate
Medusa cart update wait on an exclusive advisory session lock. The owner
completed loopback HTTP while PostgreSQL reported it idle with no transaction.
Explicit release allowed the native update to commit.

A second native worker's line-item insert also waited. Terminating only the
fixture owner's identified database backend released that insert. The original
JavaScript process then successfully emitted another HTTP request despite
losing its database session. The native script asserts both observations.
TypeScript passed and the synthetic triggers, function, cart and database
container were retired.

This experiment establishes a session-loss gap in that proposed fence. Root
owns durable original-operation admission and recovery. A subsequent independent
requirement audit corrected the interpretation that C6 requires global native
immutability through physical transmission. ADR-0080 requires preserved original
admission and recovery plus refusal of native purchase changes during TLS.
ADR-0084 places final synchronous currentness and payment equality at the
subsequent Medusa commerce effect boundary.

C6 will commit the original before network activity and perform a short
serializable dispatch-admission transaction after authenticated TLS. That
transaction rechecks live access, privacy, complete native facts and original
eligibility and atomically claims the sole initial-send opportunity. After
commit the transport sends captured bytes with no further caller callback,
selection or asynchronous lookup. Currentness is established at that
transaction's serialization point. The commit-to-send interval remains disclosed.
Existing invocations remain recovery-only even when interruption precedes
transmission. The public adapter's new explicit native-admission seam preserves
the existing synchronous transport API and its refusal of asynchronous guards.

The native session-fence experiments remain evidence about the stronger proposed
mechanism and its failure after session loss. They do not replace the unresolved
COMMERCE-AUTHORITY-01 final-effect controls. The current wire component remains
local and protected commerce effects held.

## Native session composition checkpoint

At `60fdc8a`, the session captures concrete native journal and public transport
prototype methods. It retains and C1-validates complete remote bytes before
opening TLS, consumes the initial ticket before awaiting transport, and connects
the post-TLS callback to the serializable native dispatch claim. Existing
originals expose recovery and retained-challenge retrieval. Privacy and session
state are checked again before returning network data.

Independent review identified a close race while database work was pending.
The corrected session checks closure after each awaited native operation and
owns a cancellation signal for its exchanges. A native test holds the actual
operator row, observes the blocked dispatch claim, closes the session and releases
the database lock. The claim is spent and the peer observes zero HTTP bytes.
Another native test changes cart quantity during the TLS handshake and observes
refusal, including after facts are restored and the same session tries again.

The repository launcher loads the existing shared C1 and transport source assets
relative to the commerce application working directory. Packaging must retain
those assets and qualify that layout separately. Native Windows TLS qualification
used the existing Git OpenSSL executable through a task-local PATH after the
Strawberry OpenSSL fixture failed. No global environment was changed.

Native schema, privacy, cart/journal and migration replay passed. TypeScript and
all 43 selected wire groups passed. The disposable fixture was retired.
Durable provider-response observation, restart recovery evidence, connected
provider qualification and final C6 acceptance remain open. Root owns the next
implementation checkpoint.

## Compiled adapter qualification

At `6c66999`, the normal backend build also emits the shared authority adapter
dependency closure as 20 ESM modules using the existing pinned TypeScript
compiler. Compiled native code loads that packaged entry relative to itself.
The journal's transport factory ensures that the session and client use the
same packaged class identity.

The relocated adapter test passed C1 roundtrip and real public mTLS after
copying the generated assets outside the checkout. The backend build passed
with Admin disabled for this backend-only profile. A compiled native recovery
worker ran from `.medusa/server`, asserted its JavaScript entry, and recovered
the retained original through the packaged adapters.

Schema, privacy and native cart/journal tests passed. Commerce passed separately
in a fresh disposable database, with migration replay. The earlier combined
fixture run collided on US region setup and remains retained as failed setup
evidence. A nullable payment-session guard found by the real backend build was
corrected and the build rerun successfully.

Root owns the reused `.medusa/server` compiler cache for the next C6
qualification; retire generated output after final qualification/integration.
The temporary relocation directory and database fixtures were removed.
This qualifies the adapter layout and compiled consumer locally. Full standalone
application installation, connected provider qualification and C6 acceptance
remain open.
