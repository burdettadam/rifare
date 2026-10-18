# Optional media, try-on quality and identity preparation

M09-G12, G13 and G14 add an explicitly configured **local synthetic boundary**.
They do not activate a real media processor or identity partner. The only media
format is a bounded inert fixture marker. There is no image generation, actual
photograph handling, network transport, provider SDK, credential entry, fallback
provider, biometric inference or customer identity graph.

The assignment is [ADR-0038](decisions/0038-m09-growth-development.md). Formal
M07-G99, connected try-on evaluation and identity partner qualification remain
blocked. Local quality records cannot record a real agreement or physical fit
observation. Original goal packets, formal case IDs and the acceptance ledger
remain unchanged.

## Services and authority

`OptionalMedia` implements configuration, verified consent, inert upload,
queueing, dispatch, original-source reconciliation, withdrawal and eligible
deletion. `IdentityPartner` exposes the same lifecycle for one synthetic
identifier and adds readiness intake/revocation. `TryOnQualification` ingests an
original immutable fixture evaluation and binds a separate current reviewer to
its exact source configuration, synthetic dataset identity and permitted scope.

Each service receives one explicitly constructed `OptionalProviderFixtureSource`
in a **separate SQLite database**, bound to one tenant, store and purpose. Its
server-local configuration pins the provider/account names, API/model versions,
bounded rendering and safety settings, geography, retention ceiling, products,
materials, synthetic provenance and deletion/opt-out capability. No configuration
row means disabled. Only a current merchant actor with `action.configure` can
enable the local boundary. A different current actor with `action.approve` must
review the local evaluation; their permission is checked again at dispatch.

Consent comes from an authentic `CustomerAccess` challenge completion for the
exact order owner. The customer proof must still match the current customer
record and address at consent/upload/withdrawal. Consent stores the source
customer record ID and version, never the bearer, proof or session hash. An
operator or agent cannot supply customer consent. Processing rechecks the order
owner, customer record version, resource erasure guard and exact purpose consent.

Consent binds the input ID and digest, purpose, processor/account, API/model and
settings, product/material, geography, configuration revision and explicit
retention deadline. It includes bounded acknowledgements of purpose, destination,
retention, withdrawal, non-biometric processing and generated-output limitations.
Changing a source, model, setting or enabled configuration invalidates prior
consent and quality context. Explicit reconsent uses a new consent ID; withdrawal
cannot be reversed by resubmitting an old event.

The existing return-evidence implementation is untouched. Its `model_access:
false` boundary remains mandatory. Optional uploads require their own origin,
verified consent and exact inert bytes; a return-evidence reference, active SVG,
HTML, real photograph, URL, arbitrary payload or executable media format is
rejected. Media content carries no authority.

## Queue, processing and uncertainty

An authorized proposal creates one durable logical operation for the original
resource, consent and input. Dispatch rechecks current proposer and dispatcher
permission, the execution-stop generation, recovery egress quarantine, source
configuration, consent, retention and independently reviewed quality scope. The
same check executes inside the fixture source immediately before its native
effect. A changed reviewer, source, expiry, withdrawal or erasure cannot be hidden
by an earlier queue decision.

Canonical state becomes `unknown` before the source records an effect. A lost
response preserves that original operation ID. Repeated dispatch never resends
unknown work, and a different request ID cannot bypass its logical identity or
create another unresolved operation for the same resource and purpose. Only
`reconcile` looks up the original source identity. It never creates another native
effect. A successful original lookup still requires the current authorized
context before an output can be made available; otherwise withdrawal/deletion
is the recovery path. Deleted source operations retain a tombstone and cannot be
reprocessed.

The media result is labeled `synthetic_generated_preview`, carries its permitted
product/model/retention pins, and always states that it is generated. It supplies
no physical fit guarantee or return-policy decision. A text-only source,
unsupported product/material, unsafe output, expired evaluation or changed model
is rejected. Unsafe outputs are withheld and eligible deletion is queued.

Identity results carry the original source, purpose, account/API, geography,
synthetic provenance, retention and an explicit confidence limitation. A numeric
fixture confidence is not real identity verification. Nonempty cross-merchant
inputs fail before any source call. There is no alternate local identity graph
when a partner is absent. Original CASE-M09-G13 and CASE-M09-G14 formal cases are
unperformed; the permanent local tests use distinct `PREP` IDs.

## Storage, erasure and restore

Migration `038_growth_optional.sql` adds six tables. Root integrates them into the
canonical inventory, export, erasure and restore surfaces.

| Table | Scope and retained data | Privacy and recovery behavior |
| --- | --- | --- |
| `commerce_optional_configurations` | Tenant/store/purpose; structured fixture configuration and configuring merchant actor | Merchant export; no customer media or free text; disabled on import/restore |
| `commerce_optional_quality` | Tenant/store/purpose; structured source/dataset IDs, hashes, facts and reviewing merchant actor | Merchant export; no dataset contents or unbound notes; revoked on import/restore |
| `commerce_optional_consents` | Tenant/store/resource/subject hash; exact purpose and input/destination pins | Subject export; allowlist minimization and permanent withdrawal; no proof/session secrets |
| `commerce_optional_media` | Tenant/store/resource/subject hash; inert bytes, input digest and consent ID | Subject export; body erased on withdrawal, expiry or subject erasure; old bytes cannot be uploaded under an erased media ID |
| `commerce_optional_operations` | Tenant/store/resource/subject hash; original operation, source and native IDs and known/unknown stage | Subject export; minimize command/output; preserve original unknown identity; never replay after restore |
| `commerce_optional_deletions` | Tenant/store/resource/subject hash; original source/operation and deletion IDs | Subject export; keep a minimal original-source deletion receipt and no processing payload |

`eraseOptionalSubject(kernel, tenant, store, resourceIds, subjectHash)` rebuilds
allowlists even for previously redacted bodies and orphan media/operation rows.
It minimizes consent, media and dependent operations, keeps an original unknown
operation unknown, and records eligible deletion requests using the original
source/operation ID. `revokeOptionalForRestore(kernel, tenant?, store?)` disables
configurations, revokes quality, withdraws restored consent and minimizes its
dependent work. Restore never grants optional processing authority.

Withdrawal and quality/readiness revocation also minimize dependent work and
queue deletion. Authorized `deleteEligible` processes at most 100 pending requests,
including expired consent, through the configured source's original delete
boundary. The final deletion check requires current privacy permission, exact
source scope, a still-eligible original request and recovery egress clearance.
The operation's original uncertain identity is retained even when deletion is
confirmed. Deletion adds a source tombstone before any later processing attempt
could commit against that original ID.

These are logical record minimization and synthetic deletion observations.
Physical SQLite page/WAL erasure, file-system snapshots, actual provider retention
and independent processor compliance are unqualified. The source databases and
caller copies need their explicit cleanup owner. An erased resource cannot be
used to replay or restore a processing command; a privacy-authorized deletion
request can still be drained without granting resource access. The previously
documented post-erasure inventory limitation is unchanged.

## Focused evidence

`tests/development/growth-optional.test.mts` contains exactly twelve cases. The
author writes these before implementation and runs no product suites or demos.
Root's coherent candidate run combines this whole file with the other M09 files
and the retained privacy file under the 60-case/four-file/60-second budget.

| Permanent local case | Independent assertion |
| --- | --- |
| `CASE-M09-G12-01` | Exact consent/input reaches only the configured synthetic processor and retains its deadline |
| `CASE-M09-G12-02` | No consent, wrong destination, wrong customer authority, active payload or expiry produces processing |
| `CASE-M09-G12-03` | Withdrawal inside the source's final boundary removes queued media and prevents processing or fallback |
| `M09-G12-LOCAL-NAMED-RETURN-EVIDENCE-REUSE-FAULT` | A changed actual media guard improperly admits return evidence without purpose consent; the fixed rejection oracle catches it |
| `M09-G13-PREP-01-GENERATED-PRODUCT-AND-RETENTION-LIMITS` | Generated output carries declared product/model/retention and no fit/policy claim |
| `M09-G13-PREP-02-TEXT-UNSAFE-AND-UNSUPPORTED-FAIL-CLOSED` | Text-only, unsupported or unsafe behavior is withheld and eligible deletion recorded |
| `M09-G13-PREP-03-CHANGED-QUALIFICATION-AND-FINAL-AUTHORITY` | Model/settings changes, execution stop and permission changes block processing |
| `M09-G13-PREP-04-NAMED-SUCCESS-IS-NOT-FIT-FAULT` | A changed actual output projection claims fit after a successful source effect; the fixed no-fit oracle catches it |
| `M09-G14-PREP-01-SCOPED-SYNTHETIC-IDENTITY-RECEIPT` | Result preserves source/purpose/retention/confidence limits and repeats without a second source effect |
| `M09-G14-PREP-02-NO-PARTNER-NO-SHADOW-GRAPH` | No default partner, geography override or private cross-merchant access |
| `M09-G14-PREP-03-REVOKED-READINESS-WITHDRAWAL-AND-UNKNOWN-DELETION` | Final readiness revocation blocks activation; lost response and withdrawal preserve original unknown identity through eligible deletion |
| `M09-G14-PREP-04-NAMED-PRIVATE-CROSS-MERCHANT-GRAPH-FAULT` | A changed actual partner boundary reads private fixture customers across merchants; the independent rejection oracle catches it |

The three named faults import altered isolated product modules and exercise
actual storage/source behavior. Import failures, syntax errors and copied output
changes are not accepted fault evidence. Expected data is fixed in
`tests/fixtures/growth-optional/expected.v1.json`. The helper
`populateOptionalPrivacy` populates all six canonical tables and separate source
stores for root's existing privacy case without running a suite itself.

## Integration and rollback

The author submits ready for independent review, not accepted. The integrated
checkpoint provides the exact native run, preserved source hashes and fresh
nonauthor authority/regression dispositions. This source documentation does not
preclaim those results. A local rollback disables optional configuration and
retains its native/source history; never delete an unknown operation or remove a
migration from an already-applied database. Restoring an older checkpoint does
not erase a source effect or grant the right to repeat one. Real provider accounts,
authorized datasets, agreements, budgets, current endpoint/version qualification,
observed retention and the original milestone obligations remain future work.
