# Local drop-off discovery

## Assigned behavior

ADR-0062 defines the local M20-G01 increment. An authenticated human who currently
owns a support case may ask for the drop-off choices for that case's original
return request. Discovery uses the existing native return and destination
bindings, the current reverse-hub configuration and independent partner readiness,
and an explicit short-lived method declaration. It does not issue a credential.

The service entry point is `DropoffChoices.quote(scope, {request_id})`. The optional
`SupportService` integration is `post(scope, 'dropoff-choices', {request_id})`.
There is no new HTTP route or source-administration endpoint in this increment.

## Item and complete-return choices

The response separates original items, declared methods and eligible choices.
Every method names one explicit site/destination/method combination. Its item
results describe each original line and exact quantity. Its overall result also
requires the native destination's complete-return decision, including aggregate
capacity. A destination accepting one item cannot thereby accept the whole return.

| Result | Meaning |
|---|---|
| `eligible` | Current native eligibility, current partner readiness and a current available observation all support the choice. |
| `unavailable` | A known exclusion or current unavailability prevents the choice. |
| `unverified` | Required current evidence is absent, expired, future-dated or bound to an earlier configuration. |

Known exclusions take precedence over missing evidence. The `choices` array holds
only methods eligible for every selected item and the complete quantity. Integrity,
schema, source identity and authorization failures throw; they are not ordinary
unavailable results. The fallback is `merchant_review_without_dropoff_promise`.

Packaging is explicitly `box_required` or `provider_packaging`, with a separate
label requirement, future credential kind, public instructions reference and
declared accessible alternative. These are synthetic method terms. The discovery
response itself contains no usable QR code, code or other credential.

## Fees and authority

The partner fee and destination handling estimate remain separate amounts, each
with its native currency and `per_handoff` basis. `total_minor` is null and
`charged` is false. The amounts may overlap; displaying two item rows does not
multiply either fee, and no currency conversion or collection occurs.

Each response states `qualification: synthetic_only`, with false flags for
external qualification, physical handoff qualification, credential issuance,
execution authorization, capacity reservation and financial effect. It writes
no quote, route, destination selection, approval, credential, custody, stock,
allocation, experiment, delivery or financial record.

## Current evidence and privacy

The source wrapper binds actual fulfillment, partner and warehouse instances in
the same tenant/store. It validates their stable handles and durable identities
and rejects core-backed or physically aliased databases before creating its one
customer-free fixture configuration table. Each declaration pins the current
native partner configuration and lasts at most five minutes; reads never renew
its observation or expiry.

Discovery resolves the original case internally and rechecks human authority,
current support ownership, native return/resource permissions, the existing
customer proof, order freshness, installation, lifecycle and privacy restrictions.
The original customer session is not refreshed. Contributing source views and
authority are read again before return to reject changes during observation.

The native item projection is bounded to 20 original selected lines and 64 current
destinations. Oversized views fail before unbounded destination materialization.
Canonical JSON remains bounded to 131072 bytes; the service never silently returns
an incomplete prefix. The public response omits customer/contact data, proof and
session hashes, copied source envelopes and credential secrets.

## Validation and continuation

The assigned focused batch contains 12 independently authored drop-off cases and
21 unchanged qualified-destination cases. The single isolated fault caches the
destination view and offers a method after that destination's accepted category
is revoked, with other evidence kept valid. Actual candidate results and review
identities belong in the [M20 work record](../work/records/M20-dropoff-milestone.md).

G02 needs a separate assignment for durable original credential identity, approval
and final issuance checks, secret handling, unknown outcomes, revocation,
replacement, privacy and restore behavior. Later handoff and receiving work must
reuse the existing custody and warehouse owners. Formal M07/M08/M10 prerequisites,
actual partner access, physical handoff, accessibility/device, target-host and
financial-trigger qualification remain open. This local increment does not accept
the canonical goal or the M20 milestone.
