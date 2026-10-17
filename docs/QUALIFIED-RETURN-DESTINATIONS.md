# Qualified return destination fixtures

M06-G12 adds explicit, versioned destination selection to the existing return
label workflow. It is a local synthetic fixture implementation. It does not
establish a warehouse agreement, carrier account entitlement, physical handling
capability, or a supported connected integration.

## Business behavior

A destination is eligible only when the native fixture has a current enabled
account qualification and every required capability, and the destination has
merchant ownership or a contract with an agreement reference. Its current
acceptance record must cover every selected original item, category and region,
every required handling capability and the requested disposition. Its remaining
capacity must cover the actual selected quantity. The merchant's allowed
destination list can restrict these choices; it cannot make an otherwise
ineligible destination acceptable.

The fixture deliberately includes cheaper unsupported choices. Three selected
original units require fragile and standard handling in US-CO. The cheapest
address is uncontracted, another destination is full, and another rejects a
selected category. The eligible fragile destination has a USD 1.50 handling
estimate; an eligible alternative has a USD 2.50 estimate. Eligibility is checked
before price ordering. The returned list includes explicit rejection reasons and
the source, destination, policy and request revisions needed to explain a choice.

| Amount in the example | Value | Observed meaning |
|---|---:|---|
| Carrier label charge | USD 5.00 | Approved label rate and synthetic carrier charge |
| Destination handling estimate | USD 1.50 | Expected handling cost; not charged by this operation |
| Combined route estimate | USD 6.50 | Display estimate, not a settlement record |

Buying a label records a carrier charge and a native destination admission. It
does not prove carrier transit, warehouse receipt, item inspection, disposition,
or handling-fee settlement. Those stages remain distinct.

## Service and native interfaces

The canonical service is `QualifiedReturnDestinations` in
`packages/commerce/qualified-return-destinations.mts`, constructed with the
existing `CommerceKernel` and `FulfillmentFixtureSource`. Existing label and
fulfillment execution constructor signatures remain unchanged.

| Method | Input | Permission and result |
|---|---|---|
| `configure` | `expected_revision`, `enabled`, `source_identity`, `account_id`, integer `policy_version`, `allowed_destination_ids`, `expires_at` | `action.configure`; stores current merchant restrictions and binds their exact native policy revision |
| `bind` | `request_id` | `action.propose`; matches native return lines, quantities, original item IDs, customer, order and source facts |
| `evaluate` | `request_id` | `action.propose`; returns `destinations`, eligibility and reasons, policy/binding digests, and `recommended_destination_id` or `needs_review` |
| `select` | `request_id`, `destination_id`, `expected_revision` | `action.configure`; selects a current eligible destination, updates the existing parcel's destination reference, and invalidates older parcel rates |
| `read` | `request_id` | `operation.read`; shows the retained binding and selected route with an explicit current-revalidation requirement |
| `policy` | No business input | `operation.read`; returns the current local policy record, which may need refresh before use |

`select.expected_revision` is the last observed local selection revision. A
successful result returns the actual new revision. A recovered source-only
revision can make this greater than `expected_revision + 1`; callers must use the
returned value. An internal `routingPolicy(kernel, scope)` read exposes current
restrictions and their digest for already-authorized qualification-pack checks.

Selection purchases nothing. The caller obtains a fresh quote through the
existing `ReturnLabels.quote`, uses the existing separate action preview and
approval, and dispatches the resulting original fulfillment operation. A selected
route appears in `quote.details.return_destination`.
`quote.details.route_cost_estimate` separately names the carrier charge, handling
estimate, total estimate, currency and `handling_charged: false`.

The fixture-only native helper is `fulfillmentSource.destinations`, implemented
in `packages/adapters/return-destination-fixture-source.mts`. Its provisioning
methods (`qualify`, `recordDestination`, `recordRequest`, `syncPolicy`, `select`)
are server-local synthetic administration methods. They are not public API
routes and do not obtain real contracts or capabilities. Input is bounded and
strict. Original order, customer, native return, item identity and quantity
cannot be rewritten in later request classifications. Category, region and
handling corrections append a new source revision and invalidate stale bindings.

Original item identity must exist in the canonical paid-line product facts or
the original return-line product facts. Missing facts fail closed. A caller
cannot supply a category, handling claim, address, fee or capacity in the public
selection input.

## Current-state validation and concurrency

The route pins the native source and account, exact original request, source
record, destination and address digest, merchant policy, account qualification,
parcel digest and revision, quantity, handling, disposition, fee estimate and
expiry. Quote preparation, approval and final dispatch reconstruct this state
through the existing fulfillment quote validation. A destination revocation,
category/region correction, policy change, fee change, address edit, capability
loss or insufficient capacity invalidates the old route.

The native purchase transaction independently requires the route for every
registered request or account. Removing optional route metadata, changing the
request identity or recomputing an ordinary rate content hash cannot bypass it.
The native source validates the original request and current selected route
before it records any label. No label can be sent to an uncontracted cheap
destination simply because a profile or command names it.

Destination admission uses the same separate native SQLite database and the
same `BEGIN IMMEDIATE` transaction as the existing label charge. Two processes
competing for the final capacity admit at most one shipment. A duplicated
operation returns one existing label and one admission. The capacity quantity is
derived from native selected original units, never from a client-supplied count.

An admission remains counted while a label is active, in transit, delivered,
or awaiting void confirmation. Confirmed void or native confirmed unused expiry
releases its capacity. A pending void or a reimbursement request does not release
capacity. Releasing an admission does not assert a cash reimbursement. A
replacement label needs the existing prior-label chain, separate approval, a
fresh destination selection and the next native label generation.

## Uncertainty and recovery

The existing fulfillment operation is persisted as unknown before a source call.
A lost purchase response is reconciled by looking up that same original operation.
That lookup remains available after destination or qualification revocation and
does not repeat a charge or admission. A new destination selection is blocked
while a label operation is unknown. A purchased active label cannot be silently
reinterpreted as a shipment to a different destination.

Policy and selection updates cross the core and separate native databases but
have no carrier, capacity or financial effect. If the native update commits and
the core response is lost, the next authorized update uses the caller's local
compare-and-swap revision and advances beyond the verified native head. The
source-only revision remains in history. An unavailable old destination can be
replaced by a currently qualified alternative; no successful response or earlier
label effect is invented. Concurrent native updates fail their revision checks
and require a fresh read and explicit retry of the reversible update.

Migration 027 adds scoped policy, binding and selection history. Existing
fulfillment quotes, approvals, operations, labels and source effects remain
canonical. Unconfigured stores retain the earlier label behavior. Once routing
is configured, disabling it blocks new routed purchases; deleting configuration
is not a supported bypass. Native source records remain separate from core
records and are needed to reconcile uncertain effects after a restore.

## Permanent checks and qualification gaps

The predeclared matrix is in
`tests/fixtures/qualified-destinations/routing.v1.json`. The existing native Node
runner executes the 27 new permanent cases in:

- `tests/development/qualified-destinations.test.mts`
- `tests/development/qualified-destinations-races.test.mts`
- `tests/development/qualified-destinations-recovery.test.mts`

The tests cover the packet's positive, negative and revocation cases, policy and
source authority, metadata stripping, independent carrier/handling amounts,
current original facts, actual two-process admission races, unknown original
operation recovery, source-only policy/selection recovery and void/replacement
capacity. The source-only revision recovery cases were added before the fix and
failed behaviorally. Deliberately removing ownership/category checks makes the
wrong cheap destination eligible. Deliberately removing current native routing
checks permits stale routing. The unchanged permanent assertions detect both
faults; these faults exist only in disposable exported test copies.

Real merchant-owned or contracted destination evidence, provider-specific API and
account capabilities, real capacity observation, handling/disposition validation,
target PostgreSQL/React behavior, independent intended-use qualification and the
formal M03/M04/M05 prerequisites remain open. This work authorizes no paid
provider operation, physical shipment, external publication, deployment or
release.
