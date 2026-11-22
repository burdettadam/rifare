# ADR-0078 — Local checkout command access and concrete owner composition

Status: bounded local implementation and focused review complete; formal acceptance separate.
Protected source: `e8a0152825711bea81df29b8d9b035fea01ea035`.

## Assignment and ownership

The owner requested continued development after C3. Assign **RCG-4B-C4**:
expose the existing native START and original-command journal through the
authenticated local checkout application and independent Python caller. Preserve
the existing preview/intent/receipt and preparation-recovery contracts.

Root owns `feat/rcg4b-command-http` in `rifare-command-http` and integrates
the separately assigned implementation writer `command_consumer_impl`.
`commerce_checkpoint_audit` and `receipt_regression_review` remain independent
authority/security and regression reviewers; neither authors product code,
tests or oracle. At most three corrective review rounds apply.

Closing review note: `commerce_checkpoint_audit` completed the assignment review,
then its final model session failed authentication after preparing an unexecuted
isolated mutant. Fresh independent `c4_authority_review` completed the final
authority/security review and assigned fault; the preparation-only worktree was
preserved. `receipt_regression_review` completed the regression review and its
assigned fault. No corrective product round was required. Exact evidence and
publication identities are recorded in [C4](../../work/records/RCG-4B-C4.md).

The inspected provider PR1994 snapshot is open draft
`37b7fdc3d3f1c223613ad98fe601d7d86e6a3600`; Protocol PR38 remains
`6126da7619e057be2ff58dd38a5d50f49891d1b3`. The provider now has an actual
internal executable managed network lifecycle through concrete catalog,
issuance, signing and receipt-consumer owners. Public Gateway/wallet/client
selection remains open. This is pinned source inspection, not provider test
execution here. The separate provider conversation owns Marty source. Internal
mTLS routes are not an assigned Rifare public transport or private-storage bridge.

## Existing owners behind a separate local contract

Extend `DelegatedCheckoutApi` with server-owned configuration:

```ts
commands?: Readonly<{
  correlation: CommandCorrelation;
  starts?: DelegatedCheckoutStarts;
}>;
```

Descriptor-check the outer owner container and nested command container without
invoking accessors. Read their data properties once. Construct exactly one
private existing `DelegatedCommandClaims(kernel, correlation, starts)`; C2 owns
the detached correlation and concrete C3 binding checks. Invent no default
namespace, grant, provider identity or new journal. Configuration never comes
from HTTP. No configuration leaves command operations unavailable. Correlation
without a source preserves original history/recovery/cancel; START requires a
configured concrete source and complete current native checks.

Add `commandsContract(scope)` and `postCommand(scope, operation, input)` through
the existing API/server under `/v1/delegated-checkout-commands`:

| Method/path | Exact input | Existing owner |
| --- | --- | --- |
| `GET /contract` | None | Separate static command contract |
| `POST /start` | `command_id`, `preview_id` | C3 `claimCheckoutStart` |
| `POST /status` | `command_id` | C2 `read` |
| `POST /recovery` | `command_id` | C2 `recovery`, constructing an unsent RECOVER_RESULT |
| `POST /cancel` | `command_id`, `expected_revision` | C2 `cancel` |

Use distinct envelope operation names `command-contract`, `command-start`,
`command-status`, `command-recovery` and `command-cancel`. Preserve the existing
diagnostic envelope with historical observation and `execution_authorized:false`.
Return the actual unchanged C2 view or recovery projection, including its false
provider-authentication/signature flags and unverified origin. Do not imply
fresh send permission from successful construction or history.

No raw claim, observation/result ingestion, caller grant/context/configuration,
FINALIZE, provider send or execution endpoint is assigned. An unknown outcome
retains its original UUID; status and unsent recovery do not replace it or
authorize automatic retry. Original C2 schemas, identity conflicts, observation
immutability, cancellation, retirement and current-proof rules remain unchanged.

Apply actual customer/resource/contact authorization before collecting the new
strict 4,096-byte JSON body, then invoke the native owner after collection.
Reject duplicate members, malformed UTF-8/Unicode, unknown fields, queries,
methods and route variants. Reuse the existing strict recovery body reader and
established loopback host/origin checks. Keep bounded finite error responses and
logs, no-store output and no credential/body/reference logging. Map the finite
native command errors deliberately; arbitrary exception text never reaches the
caller. Do not wrap C2 mutations in an outer transaction. Recovery retains its
active-work egress fence; historical read/cancel retain their existing exceptions.

Extend the existing independent Python client with the five `command-*`
subcommands. Use the original caller-supplied UUID, strict revision and closed
arguments. Keep exact literal loopback, bounded response parsing, private bearer
environment input, no proxy/redirect/cookie fallback, no UUID generation and no
automatic retry. Validate command response identity, digest/canonical binding,
operation/profile, historical/minimized shape and all false authority flags
independently before output. Recovery is explicit unsent command preparation.
Existing client operations and their assertions remain unchanged.

## Bounded native composition correction

Read-only scouting found that four existing checkout composition boundaries
validate owners with overridable instance methods and subsequently dispatch
through those methods. Copied prototypes and authentic objects with shadows can
therefore avoid intended native identity/guard behavior. Assign only the
following concrete wiring corrections alongside the new application surface:

1. API: concrete prototype/private-brand kernel checks for preview and receipt
   owners; capture concrete preview preparation, revalidation and availability.
   Capture `revalidate` directly because `read` dynamically invokes it. Internal
   authorization must use a private/concrete routine rather than `this.authorize`.
2. Server: concrete API private-brand/kernel check before listening; capture
   concrete existing and new API entrypoints once, including pre-body authorization.
3. Intent owner: concrete receipt private-brand/kernel check and capture of
   current binding, verification, final assertions and availability.
4. Receipt owner: concrete preview kernel/currentness capture, private availability
   guards and canonical/private internal current-binding dispatch during verify.

These are immediate owner composition changes, not a general class-system or
whole-process hardening sweep. Existing injected context/JOSE/quote source ports
retain their explicit contracts. No trust source, receipt expectations, stored
intent behavior, deadlines, parser or business owner is replaced. New assertions
must demonstrate the original spoof/override behavior and preserve old journeys.

## Assigned files and preserved controls

The implementation writer owns narrow changes to:

- `packages/commerce/delegated-checkout-api.mts`;
- `apps/commerce-api/server.mts`;
- `clients/delegated_checkout.py`;
- `packages/commerce/delegated-checkout-receipts.mts`;
- `packages/commerce/delegated-checkout-intents.mts`;
- new `packages/commerce/contracts/delegated-checkout-commands.v1.json`;
- new `tests/development/delegated-checkout-command-helpers.mts`;
- new `tests/development/delegated-checkout-commands.test.mts`.

Root owns this ADR, `work/records/RCG-4B-C4.md`, new
`docs/DELEGATED-CHECKOUT-COMMANDS.md`, new
`tests/development/delegated-checkout-command-client.test.mts` and new
`tests/development/delegated-checkout-owner-binding.test.mts`. Current
ARCHITECTURE, PLANS, ROADMAP and checkout HTTP/START/command guides may describe
actual composition, scope, evidence and the pinned provider snapshot. Exactly
eight new source members are assigned.

Preserve all 1,821 original source members, 3,734 prior test registrations,
233 prior capabilities, 399 protected rows and all 46 commerce migrations.
Append only the actual eight members, new executable cases and one proposed
capability. Under ADR-0008 update only licensing source count/reason. No formal
acceptance-ledger change is assigned. Preserve all existing test/helper/fixture
bytes except the explicitly assigned licensing fixture and catalog pin refresh.

Privacy preserves its schema digest
`1be56171e04e051e0402ac4ccb339b0f1c910a09f8f358001e0a3e62cb70ff3b`, 15 surfaces
and all 360 runtime-pin positions. Refresh only the four changed API/server/
receipt/intent hashes. Any explanation in the existing process-memory surface
must preserve earlier text as a prefix and remain within the existing bounds.
No new privacy owner, personal schema or retention policy is introduced.

Catalog oracle pins for those same four runtime files may refresh. Append only
newly reached source/contract dependencies established by actual validator/input
inspection; do not change adapter, operation, expected-coverage or native-case
rows. Preserve the existing 262,144-byte limit. The legacy nested catalog's stale
38/199/262 literals remain deferred and unchanged; its full campaign is not assigned.

Both original checkout and preparation-recovery contract JSON files, browser
assets, C1 codec/oracle, C2/C3 runtime/record/privacy owners, runners, dependency
versions and execution owners remain unchanged. No provider code, deployment,
new credential, paid expansion or production action is assigned. Authorized
feature publication uses `[skip ci]`; no Actions dispatch or default-branch merge.

## Focused evidence and independent review

Root writes new owner-binding assertions against the protected implementation
before integration, using actual native objects, forged prototypes/proxies and
accessor/instance shadows. The writer writes new HTTP behavior before implementing
its surface; root independently writes copied-client assertions. Reuse actual
native SQLite/source owners and the real loopback server. Validate exact original
retention, scope denial before input, revocation during body collection, changed
purchase/held erasure, masked history, closed source, unknown-outcome explicit
lookup, strict input/output, finite logs and unchanged native business effects.

Use four ordinary selections, each within 60 cases/four whole files/60 seconds:

- new HTTP (at most 20), old checkout HTTP (23) and recovery HTTP (12);
- new command client (at most 12), old checkout client (19) and C2 journal (20);
- new owner binding (at most 12), old native receipt (22) and intent (23);
- C3 native START (20), C2 process (4), privacy coverage (9) and bounded catalog (4).

No broad/browser/nested full catalog run is assigned. Further checks require a
specific remaining risk. Preserve actual failures and native denominators;
dirty exploratory observations do not replace fixed clean-candidate evidence.

Each independent reviewer demonstrates one isolated targeted fault on the final
candidate, preserving the whole new test file: authority restores overridable
pre-body API authorization so an unauthorized oversized/unfinished body reaches
body handling; regression removes the client's original-command UUID comparison
so a valid response for another original is accepted. Tests must fail at actual
behavioral assertions, not import, setup or syntax failures. Bind source/runtime,
raw reports, review verdicts and explicit closing-document equivalence to fixed
commits. No mutant enters the product branch.

C4 closes local customer command access only. Authenticated provider namespace,
current grant/actor authority, selected public transport, independent FINALIZE/
proof/context composition, full RCG-5/6, target-stack and formal acceptance remain
separate work. Rifare retains domain permissions, budgets, reservation, business
idempotency, execution and outcomes.
