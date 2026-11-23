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
| Implementation | Separate public wire adapter at `c527439`; native composition pending |
| Local TLS tests | Eight public and 20 unchanged internal groups passed on `c527439` |
| Native integration tests | Not run |
| C5 regression | Unchanged internal wire file passed all 20 groups; other native regressions pending |
| Fault injections | Not run |
| Independent reviews | Not run |
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
owns the next design and implementation of durable original-operation ownership
and native writer enforcement through sender interruption and recovery.
Qualified dispatch must cover all cart facts, access and privacy changes and
the surviving-sender case before C6's atomic currentness claim can be made.
The current wire component remains local and protected commerce effects held.
