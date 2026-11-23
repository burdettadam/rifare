# RCG-4B-C6 — Public managed-machine command and request handoff

State: implemented and independently reviewed for bounded local development
integration at `3e74538`. Publication and integration are the next checkpoints.
Connected provider qualification and formal product acceptance remain open.

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
or approval authority. COMMERCE-OPERATION-01 supplies the qualified native journal,
and C6 composes its serializable dispatch admission with the selected machine
transport. This record's original source facts below remain historical
assignment evidence. The refreshed provider pin and current results are recorded
separately from connected qualification.

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
| Implementation | Native START/correlation and first response retention, sole initial-send claim, recovery and unverified request retrieval implemented |
| Local TLS tests | 23 public and 20 unchanged internal groups passed on `60fdc8a` |
| Native integration tests | Exact `3e74538` native suite passed, including competing sessions, withdrawal during TLS, process exit, lost response, observation commit rollback and privacy |
| C5 regression | Unchanged internal wire file passed all 20 groups; other native regressions pending |
| Fault injections | Link destination/duplicate faults and native recovery/artifact post-TLS ownership faults caught by unchanged behavioral assertions |
| Independent reviews | Authority/security and regression reviewers found no blocker for bounded development integration of `3e74538` |
| Publication of implementation | Not done |

No claim of functional support, provider qualification or formal acceptance is made by this assignment record.

## Final local development review

Before publication, root's required retained C5 regression run detected a stale
oracle pin for `tests/development/delegated-use-client-helpers.mts`. Root, as
delegated integration owner, authorizes refreshing only that pin after the
independent reviewer verifies the already-reviewed Windows executable lookup
and finite fixture-error diagnostics. The protected preimage is
`1aeff4c969b2fe1eb90cb1ff17c5e43416f00a94c225ba93e615ea6c45f285b7`.
The reviewed source hash is
`f3b1ce5dad3aa8adbaf06503b6a2ee90fca4370512880c99f30c9c146c9fc7e4`.
All source checks, expected cases, coverage shapes and case denominators remain
required. This decision precedes the pin edit and requires fresh execution of
the catalog and retained regressions. The earlier pin failure remains evidence.

Both independent review roles inspected `3e745380220129f2fc475baae201eb7a85d44840`
and its retained source/compiled evidence. They support bounded development
integration. Runtime execution was performed by root and independently inspected
by those reviewers. The native ownership faults caused actual unexpected HTTP
requests and failed the unchanged peer-count assertions. Source bytes were
restored and disposable fixtures retired.

Root owns publication and integration under the owner's existing instruction
to use local checks while Actions are cost-restricted. The remaining connected
endpoint and caller enrollment evidence belongs to the provider worker.
Signed-request verification, human linking, proof submission, FINALIZE,
commerce-effect authority and production authorization remain open.

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

## Prior decision for additive C6 catalog registration

Before changing catalog controls at d3a9397040166a982e3403396ee96702add10582,
root as delegated integration owner authorizes the missing public-client entry.
The retained regression first failed the reviewed TLS-helper pin, then correctly
reported ADAPTER_CATALOG_UNDECLARED_ADAPTER_SOURCE. Both failures remain in
ignored evidence. No validator waiver applies.

Declare only delegated_use_public_client, its actual source pin, three bounded
operations and all 23 public wire cases. Add the corresponding expected coverage.
Preserve every existing adapter, operation, case, oracle and direct fixture.
Raise only the catalog-local byte capacity from 262144 to 327680, one 64 KiB
block, because the pre-addition compact inventory already occupies 260505 bytes.
Generic configuration limits and overflow rejection remain mandatory.

Validate the exact addition independently before subtracting it for the existing
frozen C1/C5 preservation checks. Retain their original hashes and denominators.
The full pre-addition coverage canonical SHA256 is
06033d81d78481d8225cf83752cdefec171e77cfeadc6d3d79f4e8e9ef9c75ed.
Independent authority reviewer rifare_authority_review approved this bounded
proposal before implementation. Both independent roles must inspect the actual
candidate and rerun evidence. External and production qualification remain false.
This decision changes local catalog capacity and inventory only.

## Final local candidate and integration disposition

Candidate bb39ed16e39f57ee4f10f04cd7b979311930b69e retains the reviewed native
product tree from 3e74538 and compiled packaging from 6c66999. Later changes
are documentation, the explicitly authorized catalog addition and its checks.
The final catalog now has 49 adapters, 230 operations, 359 distinct native cases
and the unchanged 47 direct fixtures. Both external flags remain false.

Retained selections passed in whole-file batches of 51, 43, 43 and 21 cases,
plus the three retained C5 catalog cases and two new public catalog cases.
The final C1 catalog four cases, C5 catalog three cases and public catalog two
cases all preserve the independently frozen earlier coverage. The exact public
subtraction restores the pre-addition full coverage hash. Receipt binding's
17 cases passed. No skipped or cancelled cases count as passing evidence.
Repository structure, generated views, retained-plan validation and diff checks
also passed. Ignored operation-journal evidence retains every actual log.

The initial public catalog run correctly found the changed expected-coverage
oracle pin; the pin now binds the approved additive file. The Windows bind C1
catalog run passed but took 82 seconds. Its repeat copied the same read-only
inputs to disposable container tmpfs and passed in 0.41 seconds. Final C5/public
catalog and receipt batch took 0.39 seconds, retained wire batch 2.54 seconds.
Node 24.14.1 and the existing pinned dependencies were reused with no install.
Temporary candidate copies and their containers were removed after each run.

Independent authority/security and regression reviewers inspected bb39ed1.
Authority review cleared bounded local development integration, carrying forward
the independent native product review. This supplements the earlier checkpoint
sections, whose open implementation items are historical. The final independent
regression disposition is required before merge. Root owns publication and
integration under the user's explicit feature push and local-check merge
instructions. Hosted Actions remain skipped due the user's cost restriction.

Provider endpoint and managed caller enrollment could not be located in existing
workspace records. Provider PR2063 distinguishes image packaging from signed-image
execution and live Rifare transactions. The provider worker owns that connected
prerequisite. No duplicate provider deployment is assigned here. Signed request
verification, account linking, protected effects, standalone application install,
connected qualification and formal product acceptance remain open.

Worktree inventory remains one primary and two linked checkouts. Root owns the
active integration checkout. The public implementation checkout is idle at
626828a64c60daba394d91718972c1ba6183d695 with its original refs preserved.
Retirement requires final integration/equivalence evidence and fresh Windows
activity, ignored-data, consumer and DELETE-sharing checks. No checkout is
reported removed before those gates and normal git worktree remove succeed.

Final regression reviewer rifare_regression_review also cleared bb39ed1 for
bounded local integration after inspecting the actual passing logs. Both roles
reported no scoped blocker. Root accepts this implementation for local development
integration only, with connected and formal product acceptance still open.
