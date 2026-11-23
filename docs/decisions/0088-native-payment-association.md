# ADR-0088 - Native original payment association

Status: implementation checkpoint; fixed qualification and independent reviews pending.
Base: `f7862128261e22f1febb02ce498cf1a8ea66409b` (C9 PR8).
Branch: `feat/medusa-payment-binding`; root owns writer/integration in the primary.

## Assignment RCG-4B-C10

Implement the next bounded local prerequisite for COMMERCE-AUTHORITY-01: derive
and retain one exact native pending-payment session for an authenticated original
whose C9 final result and current concrete C8 receipt verification already match.
This does not accept the full authority goal or enable a checkout workflow.
The original entry/compensation, live authority, final-effect fence and provider
outcome-reconciliation requirements remain unchanged and open.

Read the actual pinned Medusa2.23.0 payment models, link definitions and workflows.
Reuse existing original/current-customer/privacy/cart owners and exact native
`minorUnits` conversion. Keep the accepted cart observation profile and its digest
unchanged: payment provider data is a separate association, not pricing/cart facts.
Do not create a second payment engine or call authorize/capture/cancel/refund/order
workflows during association. Native pending state does not prove absence of a
remote provider effect. The provider method can override its default session-ID
idempotency key with caller context; this slice neither supplies that context nor
claims that later dispatch is already fenced/idempotent.

## Selected boundary

The server derives the collection and session from the current locked native cart,
never caller-selected IDs or successful-verification flags. Require exactly one live
cart/collection association, no sharing with another cart, one live session, exact
original amount/currency at both collection and session, enabled configured provider
and current region/provider eligibility. Use raw native decimal values and existing
exponent rules without rounding, coercion or a new monetary profile. Bound queries
and stable lock order under the existing serializable journal transaction.

Qualify only the native pending observation profile. Existing native
payments, authorizations, captures, refunds, cancellation, ambiguous sessions or
nonpending statuses require original-outcome reconciliation; refuse rather than
calling compensation or choosing another session. Do not inspect or retain provider
token/data/context fields. Native pending evidence is not live provider status.

A current concrete C8 verification must be owned by the actual verifier and match
the retained C9 original/result before association. Recheck current ownership,
privacy, cart facts, receipt/trust/cancellation and time after awaited observations,
write and COMMIT. No caller can manufacture this currentness with a cloned summary.

Retain the first immutable collection/session/provider IDs, canonical association
context digest and first observation in the existing operation row before any future
workflow entry. Bind context to original command/cart/amount/currency and C9 final/
receipt identities. Recovery revalidates the same native selection/currentness; it
cannot replace a vanished, changed or uncertain session. A provider/session refusal
fingerprint prevents reuse across another original and survives minimization.

Add nullable native migrations/constraints/indexes and privacy export/hold/erase/
uninstall/restore continuity before persistence. Current refusal identities may add
one optional payment fingerprint; legacy forms may not discard a retained identity.
Preserve all existing C7/C8/C9 and legacy diagnostic behavior/criteria. Do not change
catalog source pins, counts, old oracle hashes or payment execution controls.

## Scoping clarification before persistence implementation

Independent authority scoping confirmed that provider creation/update can precede
or explicitly retain a pending status. Never describe that as unattempted or as
proof that no provider interaction/effect occurred. Refuse soft-deleted/replaced
cart/collection/session history and any recorded native payment outcome rather
than filtering it away and selecting a fresh clean-looking original.

The selected local-medusa application configures no external payment providers or
cloud payment options; the pinned native loader always registers its System provider.
This first observation profile therefore requires `pp_system_default`, current native
enabled state and region eligibility. No arbitrary enabled database row establishes
a configured external provider. A real provider profile needs separate selection
and qualification; do not add a caller allowlist or default-provider substitution.

## Evidence and integration

Use actual PostgreSQL/native Medusa payment creation with synthetic local providers
and genuine synthetic C7/C8 signatures over C9 original state. Exercise exact native
money/selection, duplicates/sharing/mismatches, preexisting payment outcomes, current
ownership/trust/expiry, concurrent immutable writers, rollback, original process
recovery and every privacy path. Assert unchanged native payment/capture/refund/order
records for refusals and observation. Demonstrate a meaningful targeted native fault.

At integration, fix source/compiled/dependency inputs and qualify the own-dependency
compiled consumer, populated C9-component/schema upgrade/replay and whole-database
privacy restore. Both independent authority/security and regression roles review
that fixed candidate. Use bounded development checks between coherent changes;
broader qualification belongs to the fixed integration checkpoint.

Reuse the active primary/source dependency cache. No linked checkout or full runtime
is allocated for assignment. C9's temporary runtime/generated output is already
retired, with exact source/ref/evidence preservation. Any later generated output or
separate qualification runtime needs root ownership and retirement after its review.
Append exact new first-party inventory paths before the full distribution gate.
Hosted Actions stay skipped under the owner's cost instruction; authorized normal
feature push and merge follow passing local checks/reviews. No production/provider
or Supabase deployment, new signer/custody service, tagged release or paid effect.

Full COMMERCE-AUTHORITY-01, IDENTITY-APP-02 and DELEGATED-PURCHASE-01 remain open.
The provider worker still owns endpoint/enrolled machine/presentation custody.
