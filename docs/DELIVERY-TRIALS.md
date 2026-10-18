# Delivery-started trials and bounded final capture

M10-G13/G14 add synthetic local preparation under ADR-0039. They extend the
existing `InstantExchanges` and `InstantExchangeFixtureSource` payment owner.
There is no second authorization ledger, capture ledger or stock owner. Formal
connected qualification and the original planning cases remain blocked.

## Trial authority

`DeliveryTrials` coordinates independently reviewed terms, authentic customer
consent and original order identity. The typed binding uses
`workflow: delivery_trial`, an actual order/case, original unit obligations and a
deterministic original financial obligation. It never substitutes a made-up
exchange quote, native return or paid amount. One scoped order has one trial;
the existing native unit-claim fence prevents spending its units again.

Before terms can be approved, `PartnerReadiness` must approve the exact
`trial_payments` source/account/configuration/region/capability. The configuration
digest includes the original source identity, current account digest and a
separately observed authorization-duration digest and revision. Source fixture
administration can provide this synthetic observation; it cannot qualify an
actual processor or agreement.

Terms define the USD maximum, delivery allowance, trial duration, return grace
and maximum cumulative extension. The delivery allowance plus trial and grace
must fit the independently observed authorization duration. Terms have a current
author with `action.configure`, an independent reviewer with `action.approve`,
exact revisions and expiration. Updating terms makes an old version unavailable
for new execution. Historical clock reads retain the original terms digest.

Customer consent requires the actual customer session and its current
CustomerAccess owner binding, including the normalized owner email and source
revision. An operator cannot supply its own session. Consent records explicit
confirmation, terms digest, currency, maximum and authorization expiry. The
maximum cannot exceed either the reviewed terms ceiling or original unit
obligations. A new authentic consent may refresh that same case's verification;
it does not grant a financial execution approval.

The native synthetic mandate records an exact expiry of consent confirmation
time plus the separately observed account duration. A delayed dispatch does not
push expiry forward. This is a fixture contract, not evidence of a processor's
actual authorization policy. The local bound is at most one hour. Saved card
data, processor credentials and network clients are absent.

## Delivery clock, returns and capture

Delivery comes from an immutable original-source observation linked to the trial,
resource and native order. Before complete delivery, all clock fields are null.
Each correction names the exact previous event and next sequence. Replaying the
same event is idempotent. The clock starts at the latest complete delivery time
in the correction chain, so an earlier correction cannot shorten a promised
trial. A latest incomplete or null observation suspends capture eligibility.

Trial end is delivery start plus the approved duration and dispatched extension;
capture eligibility starts after the separate return grace. Authorization expiry
remains a separate native field. Late delivery that leaves insufficient time
requires fresh consent and approved reauthorization.

Returns require the actual existing canonical return request, a created native
return operation and its exact original native ID/digest. `linkReturn` binds
those facts to the existing `WarehouseFixtureSource`. The service reads that
warehouse's original event journal and effective unit corrections. It does not
write warehouse stock or invoke disposition. Missing requests/links, incomplete
events, partial receipt completeness and missing expected units block capture.
Mixed-price partial unit mappings are rejected as ambiguous. Equal-priced partial
line quantities use original ordinals. A second request that would reuse an
already linked original unit is also ambiguous and is rejected; its unlinked
canonical request continues to block capture until the original mapping is
reconciled. The fixture does not invent a new original-unit mapping.

`InstantExchanges.quoteAuthorize`, `quoteReauthorize`, `quoteCapture` and
`quoteCancel` use the existing ActionGateway preview, independent financial
approval, receipt, queue and original source operation. The public trial service
does not call a second payment transport. The four trial adapter declarations
are typed extensions of `instant_exchange_source`; every prior native operation
and ordinary instant-exchange path remains.

An extension requires a fresh authentic consent tied to the same obligation and
current reviewed terms. The cumulative extension cannot exceed the approved
maximum. A consent or quote alone leaves the live clock unchanged; the original
source must commit the reauthorization. A separately approved cancellation can
waive an active obligation. Withdrawing consent blocks new effects and does not
silently cancel or reverse an existing native payment.

Final capture is the minimum of the retained original unit obligations, current
consent ceiling and exact approved command amount. It requires a completed trial
and grace period, unexpired native authority and certain current warehouse facts.
The source reruns the canonical approval, customer, terms, readiness and stop
checks inside its transaction immediately before a new effect. The exact typed
binding and current delivery/receipt digests are persisted in the original native
operation-binding table. A reopened
source without that current callback rejects a bound new effect; lookup of an
already committed original result remains available.

The canonical queue becomes unknown before transport. Concurrent dispatch cannot
create another send, and the original capture table permits one positive capture
per obligation. A changed receipt invalidates the old approval and produces a
known original rejection. Only that resolved rejection can allow a later capture
generation. A lost response retains the original unknown operation; a fresh key
cannot replace it. Readiness outage or revocation permits proven original lookup
under current reconciliation permission, never a new capture. A later returned
unit can expose `compensation_required_minor`; automatic refund or stock repair
is outside this service.

These guarantees describe the local fixture's synchronous source boundary and
original durable fences. They do not qualify a distributed processor/warehouse
transaction or a real physical race.

## Storage and privacy integration

Migration `041_delivery_trials.sql` adds five commerce tables. Existing migrations
and the original `commerce_instant_*` owner remain intact.

| Table | Scope and contents | Canonical privacy handling |
| --- | --- | --- |
| `commerce_trial_terms` | Tenant/store; versioned merchant policy, source/configuration and amount/time bounds; author authority revision | Export only terms referenced by the selected subject; preserve shared merchant policy on erasure |
| `commerce_trial_term_approvals` | Tenant/store; exact terms version/digest and independent reviewer/expiry | Export only referenced approvals; preserve shared merchant policy on subject erasure; revoke every approval on restore/uninstall |
| `commerce_delivery_trials` | Tenant/store/resource/customer plus canonical subject hash; original order/value binding and state | Scoped export; rebuild explicit allowlist, pseudonymize customer and mark erased/redacted; restore blocks execution |
| `commerce_trial_consents` | Tenant/store/resource/customer/subject hash; exact consent, original native consent and current proof-session hash | Export omits proof-session/native digest; erasure and restore strip replay material and revoke authority |
| `commerce_trial_events` | Tenant/store/resource/customer/subject hash; original delivery/return IDs, digests, sequence and corrections | Scoped export and repeatable explicit allowlist minimization; source identity and minimal observations remain |

`delivery-trial-privacy.mts` exposes the canonical lifecycle integration:

```ts
exportTrialSubject(k, tenant, store, resourceIds, customer, hash)
eraseTrialSubject(k, tenant, store, resourceIds, hash)
revokeTrialsForRestore(k, tenant?, store?)
```

Passing only one of tenant/store to restore revocation fails before any mutation.
Erasure selects by original resource, subject hash or deterministic pseudonym,
and repeats its allowlist transformation even for an already erased row.
Restore/import/uninstall revoke terms approvals, strip consent proof-session
material and block active trials. They preserve original financial state.

The helper also minimizes only typed delivery-trial additions in existing
`commerce_instant_obligations`, `commerce_instant_operations.command` and
`commerce_instant_quotes`. It retains original operation/obligation/source IDs,
kind, generation, amount/currency, minimal original binding, source times and
original digests. The original command cannot be replayed after erasure, and an
unknown operation stays unknown. Ordinary exchange records are unchanged.
Existing instant observation receipts remain append-only: they contain minimal
original identifiers, amounts, times and digests, with no customer proof session
or card data. The canonical shared lifecycle also revokes case/action/session
authority.

The original instant source database adds only
`fixture_trial_windows`, `fixture_trial_deliveries` and
`fixture_trial_return_links`. Authorization, operation, capture and unit-claim
records stay in the existing `fixture_instant_*` tables. The warehouse journal
and stock remain in a distinct original warehouse database. Separate native
stores, historical exports and caller copies need their own authorized retention
or cleanup; local erasure never reports an externally confirmed deletion or a
reversed payment.

## Six bounded preparation cases

Behavioral tests and independently declared values were committed first at
`2860a00`. There are exactly six native case declarations in
`tests/development/trial-payments.test.mts`.

| Case | Required local evidence |
| --- | --- |
| `M10-G13-PREP-01` | Delivery start, trial end, grace, authorization expiry and maximum stay distinct; original identity and tenant boundaries; no capture or stock effect |
| `M10-G13-PREP-02` | Short duration, current owner change, readiness outage and missing current source callback block; fresh source proves the persisted binding guard and original lookup |
| `M10-G13-PREP-03` | Duplicate and linked corrections apply once and never shorten; isolated actual module mutant starts at creation and fails the fixed delivery oracle |
| `M10-G14-PREP-01` | One of three USD 10 units returned permits exactly USD 20 capture; fresh approved reauthorization activates extension; canonical cancellation has zero capture |
| `M10-G14-PREP-02` | Partial receipts, expiry, excessive extension and final-boundary readiness outage stop capture; actual-service privacy population retains unknown original authorization |
| `M10-G14-PREP-03` | A receipt arriving at final send rejects the obsolete amount; a new known-rejection generation captures USD 20 once; concurrent/lost responses retain original unknown identity and reconcile; actual full-order mutant fails independent USD 20 oracle |

`usingTrials` provides the real existing kernel, customer/owner/reviewer scopes,
native instant source and warehouse. `populateTrialPrivacy` fills all five new
tables through actual service APIs and returns scoped identifiers plus
`unknown_operations` referring to an original `commerce_instant_operations` row.
It loses the authorization response after the original native commit and creates
the actual native return/warehouse observation; it performs no capture.

Authors run zero product modules, tests or demos under ADR-0039. Parser-only
inspection is not behavioral evidence. Root owns the bounded integrated native
run, exact reports, independent reviews and integration decision. The original
`CASE-M10-G13-*` and `CASE-M10-G14-*` connected obligations are unperformed.

## Rollback and remaining qualification

Disable the current trial partner configuration and ordinary instant settings,
revoke the new terms/consent authority, and preserve all original obligations,
unknown commands, captures and native lookup identity. Do not drop the migration
or retry an unknown key as rollback. Restore starts with trial authority revoked;
new readiness and authentic consent are required before eligible new work.

Actual processor/account approval, contractual authorization duration, real
delivery/receipt records, native capture/settlement/chargeback behavior, target
database qualification and connected return/payment race evidence remain absent.
The protected M07-G99 and formal M10 dependencies stay open. The prior documented
post-erasure/unimported-movement stock limitation is unchanged. No deployment,
publication, paid effect or acceptance follows from this local preparation.
