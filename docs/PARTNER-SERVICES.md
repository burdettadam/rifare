# Partner service development boundaries

M10-G01 and G07 through G12 have bounded local implementations under ADR-0039.
Every provider record in this slice is invented and stored in a separate SQLite
fixture database. Actual commercial access, underwriting, customs/remittance,
physical sites, medical/tax eligibility and network coverage remain unqualified.
The current acceptance ledger and original formal goal packets are unchanged.

## Shared current readiness

`PartnerReadiness` uses the existing kernel's authenticated store/member scopes.
`configure` requires current `action.configure` authority and stores a versioned
service/account/source/configuration with regions, capabilities, expiration and
bounded responsibility references. An independent current `action.approve` member
reviews that exact configuration. Both the author and reviewer must still hold
their required authority whenever readiness is used. Configuration is disabled
until explicitly supplied and approved.

`PartnerContext` has service, account ID, source identity, source configuration
digest, region and capability. `PartnerPin` adds configuration revision/digest,
approval ID/digest, expiry and the `diagnostic.partner.service` execution-control
stamp. `assertReady` compares a saved pin against the complete current pin. It
checks outage, revocation, stop/resume, migration and restore fences. Dependent
services also check their exact native source context immediately before commit.

`inspect` exposes unavailable reasons and a merchant-review alternative without
a partner promise. Keys, reference strings, fixture success and application
reviewer identity never establish external contractual authorization. Pins always
carry `qualification: synthetic_local_only` and `external_qualified: false`.

`assertReconcile` grants lookup authorization only. The caller must first read
its original scoped operation and prove the stored command/source/account. A
current outage or revoked agreement stops new effects while existing original
obligations can still be observed. Migration/restore egress fences still apply.
Changing the account, operation ID or adapter instance does not reauthorize an
unknown effect. Source bindings are durable, and bound effects require the final
callback before any new native record is committed.

The shared `installPartnerReadiness` fixture helper accepts an existing kernel,
independently authenticated owner/reviewer scopes and an existing source context.
It creates no additional merchant or business-state owner.

## Implemented services

| Goal | Current behavior | Material boundary |
| --- | --- | --- |
| G01 | Versioned scoped readiness, responsibility references, independent approval, current permission and stop checks | No real contract or qualification is authenticated |
| G07 | Source-grounded coverage quote, exact independent review, current customer proof and fee/terms confirmation, one synthetic issuance | Fee records do not prove collection, underwriting, reimbursement or settlement |
| G08 | Original estimate and final customs observation remain distinct; differences require independent review of the variance and an obligation reference | No new collection/remittance owner or guaranteed landed-cost claim |
| G09 | Reviewed region/site/category route imports original warehouse events through `WarehouseReturnEvents` | A route or delivery event cannot create received goods; source fixture receipt is not qualified physical evidence |
| G10 | Additive sent/received/rejected events preserve leg, unit, custody, site and fee identities; missing handoffs remain explicit | No stock movement, assumed physical receipt, timed completion or duplicated fee |
| G11 | Provider eligibility observation is checked with the exact current canonical payment source/version/reference; authenticated confirmation records eligibility | No generated-health inference, tax/medical assurance, capture or payment settlement |
| G12 | Original account/deadline/fee-bound alerts accept reviewed acknowledgment, review or decline responses | No automatic refund/charge, guaranteed network coverage or recovered-funds claim |

Protection confirmations use the canonical CustomerAccess proof binding and
recheck current customer source ownership/contact. A change in terms, fee,
configuration, reviewer authority, source ownership or customer proof prevents
new issuance. A lost response keeps the original source operation unknown; a
later original lookup can record its already-issued result after readiness
revocation. It cannot issue a second policy under a replacement ID.

Duty estimates, actual assessments and their variance retain their own source
references. A variance approval is a local reviewed obligation reference and
executes no payment. Collection and remittance remain unavailable until their
original owners provide actual authoritative observations.

Reverse-hub receipt import delegates to the original native-return mapping,
warehouse event sequence, receiving-unit, correction and disposition owners.
The integration does not modify stock. International handoff projections keep
each unit's last known site and in-transit status. A received first leg leaves
later legs outstanding. Final cost totals contain observed final fees only;
unobserved later costs do not become zero-cost guarantees.

HSA/FSA preparation binds a canonical payment observation to the same customer,
order, account, source system, native reference and provider eligibility limit.
The public customer path can confirm that order-linked observation without
gaining general access to payment resources. The source records an eligibility
check only. Displayed payment state is the pinned observation, not a newly
executed payment or assurance that the instrument remains usable.

Network response approval binds the exact event hash, deadline, account,
response and readiness pin. Source commit checks current authority again.
Duplicated or late requests retain their first operation; an uncertain response
is looked up under its original identity. Fees are immutable observations with
one original fee reference, and recovered amount remains zero.

## Storage, export and erasure

Migration `039_partner_services.sql` adds eleven tables. The two readiness tables
contain configuration and bounded responsibility/reviewer identifiers, without
subject lists or raw credentials. These nine tables carry explicit tenant, store,
resource and subject-hash columns:

- `commerce_protection_proposals`, `commerce_protection_confirmations`, and
  `commerce_protection_operations`.
- `commerce_duty_assessments` and `commerce_reverse_hub_routes`.
- `commerce_international_handoffs` and `commerce_hsa_fsa_eligibility`.
- `commerce_network_alerts` and `commerce_network_alert_actions`.

`exportPartnerSubject(k, tenant, store, resourceIds, customer, hash)` projects
subject records and only their referenced readiness configurations/approvals.
Session, verification and token hashes are omitted recursively. These projections
are explicitly without authority and are not activation/import credentials.

`erasePartnerSubject(k, tenant, store, resourceIds, hash)` reconstructs explicit
allowlists on every call. It matches resource IDs, stored subject hashes, original
customer hashes and recognized erased pseudonyms, including when the resource
list is empty. Arbitrary private fields introduced into an already-redacted
record are removed on the next pass. Minimal original operation/native/event,
source, custody and fee references remain for accounting and reconciliation.
An unknown state remains unknown. Confirmations and approvals cannot survive as
execution authority in a minimized record.

`revokePartnerForRestore(k, tenant?, store?)` disables readiness and revokes all
independent approvals/customer confirmations. It removes embedded execution
authority from dependent work while preserving uncertain original outcomes.
Canonical import, restore and uninstall invoke it through root's shared privacy
wiring. It dispatches no source effect and makes no physical deletion claim.

The separate fixture database contains configurations, original bindings,
coverage, duty observations, eligibility observations/checks, handoff observations,
alerts and alert responses. Subject exports and caller-held copies also have
independent disposal responsibilities. Canonical erasure cannot silently erase
those stores or present them as deleted. Disposable test fixtures close/remove
only their own source databases after the root's observation.

The prior M08 limitation remains: a transfer committed with a lost response,
followed by customer erasure before movement import, can leave shared stock
unresolved. This slice adds no automatic repair or replacement operation. Operator
reconciliation must preserve privacy and the original source identity.

## Evidence and recovery

The author committed 22 native cases before implementation: three G01 cases,
three distinct preparation cases for each external goal and original PORT-028.
Seven named faults mutate actual source statements and must be caught by fixed
independent assertions. No author product module, suite or demo was executed.
The root's source-bound reports and final independent reviews record actual
results; static source inspection is not product evidence.

The root's planned full M10 development selection remains 54 cases in four whole
files under one 60-second invocation deadline. Only concrete failures or
consequential corrections justify affected-file repeats. Formal G99, connected
qualification, broad regression and release evidence remain separate.

Rollback disables readiness and preserves migrations, historical observations
and original unknown operations. Do not delete or replace those records to make
an unresolved source effect retryable. Public release, hosted push, real provider
access, contracts, messages, spending and production activation are not authorized
by this local development checkpoint.
