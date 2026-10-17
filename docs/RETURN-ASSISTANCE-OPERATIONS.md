# Return assistance operations

The shared service exposes `/return-assistance` and authenticated POST operations
under `/v1/return-depth/`. The page provides risk assessment and review, customer
appeals, native destination evaluation/selection, exact item previews/customer
confirmation, policy-pack inspection and declared cost reports. It stores session
tokens only in page memory, clears results on input/session changes, rejects late
responses and renders source values as text. Changing a case, quote or chosen item
also clears the dependent assessment or confirmation identity.

## Authority and operation boundaries

| Operations | Existing authority and effect |
| --- | --- |
| `risk/assess`, `risk/read` | Scoped case access; assessment needs staff support authority. Model fixtures may reference existing indicators only. Current case and quote configuration must match. |
| `risk/review` | A different authorized reviewer may request evidence, apply an existing bounded window override or dismiss an indicator. Model output grants none of these permissions. |
| `risk/appeal` | The authenticated customer for that case may request human review or cite evidence. Customer responses expose neutral review status rather than private model allegations. |
| `destinations/configure`, `bind`, `evaluate`, `select`, `read` | Existing configuration/proposal/read permissions and a supplied native fixture source. Selection reserves no capacity and buys no label. The original fulfillment flow revalidates at native charge. |
| `prevention/configure`, `configuration`, `approve`, `freeze`, `analyze`, `read` | Existing support/configuration/approval authority. Approved, versioned guidance and a predeclared frozen cohort produce optional offers. No external messages are sent. |
| `prevention/preview`, `confirm`, `revoke` | Preview uses the normal edit engine. Confirmation and withdrawal require the actual customer session. The normal separate staff approval remains mandatory. |
| `prevention/refresh-outcome`, `report` | Existing analytics authority, fixed source outcome records and retained baseline/control/treatment denominators. Missing observations or costs suppress complete comparisons. |
| `packs/put`, `get`, `evaluate` | Current published profile/policy/skill pins. Packs evaluate and restrict readiness; they grant no native capabilities or execution rights. |
| `economics/report` | Existing analytics authority over an existing frozen cost cohort. Declared costs and canonical operation observations remain distinct. |

All operation bodies are exact schemas enforced by the underlying services. There
is no public native qualification, destination/address administration, consent
insertion or outcome-fixture administration endpoint. Existing execution and
reconciliation routes remain canonical. HTTP logs contain fixed result codes,
not request bodies, session values or source records.

## Privacy and recovery

Migration 027 adds routing history, 028 adds risk/prevention records, and 029 adds
policy packs. The additive storage contract covers all **167 core tables** and
retains all earlier schema contracts unchanged. Export includes subject-linked
assistance/routing records while omitting customer session and verification
hashes. Logical erasure scrubs those subject bodies, pseudonymizes their customer
references and revokes confirmation hashes. Native source cleanup and physical
erasure remain separately identified obligations.

The existing conservative cleanup of unbound store knowledge also removes cached
guidance content and source URIs from every prevention configuration version and
every customer's copied offer. It retains original digests for audit, disables
affected configurations and leaves the offer object as an enrollment signal.
Frozen experiment bodies and denominators remain intact. An unavailable subject
or guidance record cannot quietly become a complete comparison or an ordinary
unconfirmed paid-goods edit.

Unknown financial, label and edit effects retain their original operation and
source identity. Review findings corrected lost native selection responses,
stale quote/configuration risk provenance and copied unbound guidance. Their
independent red/green proofs accompany the final candidate evidence.

## Demonstration and qualification

`node --experimental-strip-types tools/demo-return-depth.mts` prints the mixed
return, stock fallback, expired authorization, unknown capture, fragile routing,
risk/appeal, customer-confirmed edit and three policy-pack journeys. It reuses
retained disposable synthetic journey fixtures and emits relevant canonical and
native ledger entries with their digests. Credentials are omitted. The command
requires a clean committed checkout; its candidate and tree identify the code
actually used.

The runtime suite, HTTP tests and six browser components exercise this local
scope. Browser components call the real loopback service through a controlled
bridge; they do not establish direct served-browser, PostgreSQL/React, merchant
or connected-provider qualification. Formal component and M06-G99 acceptance
remain blocked as recorded in [M06 qualification](M06-QUALIFICATION.md).
