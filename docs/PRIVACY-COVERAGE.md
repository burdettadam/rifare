# Privacy storage coverage

M07-G14 adds a local inventory audit and closes two subject-export omissions:
current support consent with its event history, and the customer's own members
of frozen support metric cohorts. The existing erasure, hold, uninstall and
current-checkpoint restore implementations remain the authority for mutations.
This work does not certify a deployment, legal retention or physical deletion.

## Read-only inventory audit

```sh
node --experimental-strip-types tools/audit-privacy.mts
node --experimental-strip-types tools/audit-privacy.mts --surfaces observed-surfaces.json
```

The command opens an empty ephemeral commerce schema, checks its actual tables
and columns, and compares the running checkout's executable/HTML source files
against the proposed review inventory. Its JSON identifies that environment;
it is not a scan of an installed merchant database. The optional JSON file is
an array of independently inventoried surface IDs. Matching that array is only
a declaration comparison and is explicitly not authenticated deployment evidence.
An unknown, omitted or duplicate surface fails the comparison.

The source observer covers first-party executable/HTML files under `apps` and
`packages`. It excludes only real directories named `node_modules`, `.medusa` or
`.cache`; links and junctions are rejected before that exclusion. Lookalike
names and ordinary added code remain visible. Bracketed route identifiers such
as `[id]` are literal path segments, never glob expressions. The original
entry, file-count and byte limits still apply. Installed dependencies, generated
outputs and dynamically loaded stores require separate input and privacy audits;
this source boundary supplies no deployment coverage. New Medusa source families
remain subject to review before the retained source manifest may be renewed.

For a running kernel, a server-local caller with the existing `privacy.manage`
authority can call:

```ts
import { auditPrivacyCoverage } from '../packages/commerce/privacy-coverage.mts';

const report = auditPrivacyCoverage(kernel, ownerScope, {
  observed_surfaces: deploymentSurfaceIds,
});
```

The report accounts for the declared diagnostic SQLite tables exactly once,
including the original 170-table baseline and its reviewed extensions. It retains
their existing handling rules and returns row counts only for the caller's
merchant. Tables without merchant scope report no row counts. No customer body,
credential, secret envelope, bearer token or suppression hash is returned by
this inventory audit. Existing authorization, migration and recovery fences
still apply; this helper does not bypass a paused installation.

`local_inventory_current` means the actual diagnostic SQLite schema, explicit
table-to-surface mapping, and first-party source bytes match reviewed declarations.
Native Medusa PostgreSQL tables are outside those SQLite assignments and row counts;
the separate `native_medusa_storage` surface stays `operator` / `not_verified`.
It does
not mean every subject copy was populated or erased. The report therefore always
sets `deployment_coverage_verified`, `privacy_qualified`, `physical_erasure` and
`legal_compliance_certification` to `false`. The audit itself reports subject-copy
outcomes as unexercised. Separate native behavioral cases observe those outcomes
for synthetic fixtures.

## Explicit storage surfaces

The additive contract is
`packages/commerce/contracts/privacy-storage-surfaces.v1.json`. The original
storage inventory and its schema extensions are unchanged.

The original fifteen surface clauses remain exact. The additive
`native_medusa_storage` surface has no SQLite table assignments. It identifies
Rifare-operated native PostgreSQL, identity state and associated runtime/artifact
storage as separately outstanding; native tables do not enter the SQLite schema
digest or satisfy its row-count audit.

| Surface ID | Shipped storage and handling |
| --- | --- |
| `business_resources` | Scoped customer/order payloads and cases; pseudonymize identities, redact payloads and retain suppression records. |
| `support_conversations` | Messages, contacts, consent, deliveries and rule jobs; redact content, withdraw consent, cancel pending work and preserve minimized delivery identities. |
| `attachment_media` | Embedded JSON attachments and validated PNG evidence; delete attachments and clear evidence bytes, notes and scanner data. |
| `retrieval_index` | Lexical knowledge rows and copied prevention guidance; delete subject/unbound knowledge conservatively and invalidate guidance copies. |
| `agent_task_state` | Tasks, read jobs, assistance receipts and worker records; delete or redact persisted copies and revoke access/work. |
| `analytics_readmodels` | Support metric/insight documents and return-assistance records; rebuilt reports deny erased case detail while retaining the original denominator. The polymorphic support-document table also holds merchant and migration control records. |
| `integration_replicas` | Native read caches, Woo return/RMA/event records, raw webhook bodies, event projections and simulator replies; erase private cache bodies while retaining minimized identity/state needed to prevent replay. |
| `security_and_configuration` | Merchant/staff configuration, access records and vault boundaries; exclude credentials from customer exports, revoke customer grants, and disconnect/clear local vault envelopes on uninstall. |
| `operation_audit` | Monetary, physical, return and edit identities/receipts; preserve minimized financial audit and redact supported customer-content fields. |
| `privacy_and_restore_controls` | Holds, tombstones and recovery/import fences; retain current suppression and replay it before restored data becomes readable. |
| `provider_copies` | Sender/helpdesk/model/scanner/fulfillment copies outside local SQL control; require independently observed provider outcomes. |
| `process_and_browser_memory` | Already returned values, temporary buffers, tabs, plugins, logs, clipboard and screenshots; a server revocation cannot recall these copies. |
| `caller_export_artifacts` | Customer/merchant JSON exports, downloaded media and caller-owned pilot enrollment/event/report artifacts; destination-specific inventory, access control and retention remain operator work. |
| `recovery_files_and_database_pages` | Old backups, staged upgrades, database free pages/journals/WAL, replicas and wrapping keys; logical suppression does not physically delete these artifacts. |
| `synthetic_fixture_storage` | Independent smoke databases/files and adapter fixture ledgers; commerce privacy operations do not erase another fixture's storage. Only synthetic data is qualified here. |
| `native_medusa_storage` | Rifare-operated native PostgreSQL, identity state and associated qualification/build/browser/custody artifacts; operator review remains outstanding, with no SQLite table assignments or native privacy certification. |

Each contract entry names actual implementation paths, export treatment, erasure
treatment, retained records and the observations still needed. This finite table
mapping is reviewed source metadata, not an inference that every column labeled
as audit is anonymous. Arbitrary external identifiers and unbound configuration
text can remain personal data. Subject exports retain
`unbound_text_requires_manual_scope_review: true`.

ADR-0035 extends this existing classification for the pilot protocol's separate
caller-owned directory and reports. Enrollment, case IDs, event references and
adjudication/cost evidence references can identify people even when raw customer
messages are absent. The protocol uses bounded artifacts, owner-only local
permissions, fixed file names, link rejection and separately retained integrity
pins. Those controls do not authenticate consent or establish a retention
period. Commerce customer erasure does not discover or rewrite these journals,
their input files, printed reports or copied evidence. The operator must record
the actual destinations and every required deletion or retention decision; an
old artifact remains private after commerce erasure. Current fixtures contain
only synthetic data and do not authorize a live pilot.

The same assignment adds ephemeral carrier quote snapshots and display-only
locale helpers. Returned quote/display values belong to the existing process
and browser-memory surface. The independent carrier fixture's bounded in-memory
package/account/rate records belong to synthetic fixture storage. No commerce
table is added and the original fifteen surface IDs and prior handling clauses
remain intact.

ADR-0067 adds native synthetic checkout preparation to these same categories.
`checkout-previews.mts` owns at most 128 short-lived frozen previews in process
memory, including reserved capacity for pending preparations. The composer
returns detached frozen values. Entries contain scoped IDs, monetary facts and
terms digests; no proof/session token, contact address or raw customer envelope
is retained. Every fresh read rechecks native customer proof, privacy, current
sources and the recovery egress fence. Expired entries are swept on access and
owner `close` clears its map; unused heap references are not claimed physically
erased at an exact deadline. Restart does not restore these records, and they
are absent from canonical SQL exports and backups. Caller-held values cannot be
recalled. The separate `checkout-quote-fixture-source.mts` holds at most 256
explicit scoped synthetic quote observations in its owning process and supplies
its own `close` cleanup. Canonical erasure does not claim to erase those fixture
or caller copies. No SQL table, surface ID or existing handling rule is changed.

## Subject export changes

`PrivacyLifecycle.export(scope, customerId)` now includes
`support_records.commerce_support_consent` and
`support_records.commerce_support_consent_events`, filtered by tenant, store and
customer. It also adds `analytics_records.metric_cohorts`. Each cohort projection
contains only members linked to this customer's exported resource and case IDs,
along with cohort identity/version, observation window and original document
digest. `subject_projection: true` labels the subset; other customers' members
and the complete cohort denominator are not included in this subject view.

The operational cohort remains unchanged. `SupportMetrics.report` continues to
retain its complete denominator and mark an erased member unavailable before
reading private detail. Export size remains bounded by the existing four-MiB
limit. Existing gift-recipient and purchaser separation, credential exclusion,
configured holds and current authorization are preserved.

## Suppression, restoration and retention

The focused fixture places a synthetic customer into actual conversations,
contact/consent records, attachments, PNG evidence, knowledge, task state, metric
membership and a signed raw webhook. It exports the scoped data, erases it, checks
the real fields/read APIs, and rebuilds the metric report. A separate case takes
one old owner-scoped merchant snapshot before erasure, then imports it with the
later separately retained suppression checkpoint. The receiving installation
is first checked in quarantine: image/message/knowledge/task copies are removed
or redacted before exposure, and analytics rebuilding is denied. After the
existing restore identity and reconciliation checks, explicit diagnostic-only
activation permits rebuilding the metric report, which keeps an unavailable
member in its original denominator. External egress and old-operation replay
remain blocked.

These are same-runtime synthetic observations. They do not prove fresh delivery
of a real external checkpoint, delete the original snapshot, inspect a provider
account, discover all possible process caches or establish a legal retention
schedule. Active configured holds retain eligible content until an authorized
release or expiry; uninstall disconnects the store and leaves held records for
server-local retention administration. The required operator/provider surfaces
remain individually listed as unverified.

## Native Medusa remains outstanding

Native Auth/provider identities, verified email/customer associations, customer
contacts/addresses, carts, orders, payment/provider records and workflow
checkpoints live outside the legacy SQLite database. Journal commands, signed
requests/responses/receipts and suppression/refusal records occupy separate native
PostgreSQL tables. Scoped journal export, hold/minimization and restore refusal
handling do not erase those other native records. UUIDs, HMACs, fingerprints and
attempt times remain potentially linkable evidence; neither anonymization nor
legal retention is established by preserving them.

OIDC state/nonce/PKCE storage is delegated to native Auth state; this inventory does
not establish its deployed cache backend. Browser cookies, bearer credentials,
TLS keys and proof buffers need separate runtime review. Qualification tools may
read installed native tables and emit restore contexts or credential-bearing
custody files, even while creating synthetic fixtures. Worker seals/credentials,
Admin customer-token fixtures, stdout/logs, IPC, database dumps/WAL/pages,
generated outputs, screenshots and browser state require operator-managed scope,
permissions, retention and cleanup. In particular, the current Admin fixture
writer lacks an explicit restrictive file mode. Disposable/test flags do not
certify an arbitrary database or output directory as safe, private or synthetic.

Rifare owns this native storage review. The SQLite audit does not query those
tables or perform their cleanup. Native deployment privacy, whole-customer
treatment and connected-provider copies remain unverified until separately
qualified evidence and an authorized retention decision exist.

## Review on new stores or runtime source changes

The observer reads executable/HTML formats under the actual `apps/` and
`packages/` roots. A new table or column fails the original full-schema guard.
An executable source addition, deletion or byte change fails with
`PRIVACY_RUNTIME_REVIEW_REQUIRED`. This includes a cache introduced into an
existing reviewed module. A newly observed surface absent from the declaration
fails with `PRIVACY_SURFACE_INVENTORY_INCOMPLETE`.

Source drift is a review trigger. It is not automatic heap inspection, discovery
of runtime-loaded third-party code, inventory of a caller's filesystem or proof
that a supplied surface list is complete. Deployment qualification must establish
those actual boundaries separately. Adding a new store requires updating its
named handling and behavioral evidence before refreshing source pins. Do not
silently accept an unexplained source change by regenerating the list.

After reviewing the exact assigned changes, the integration owner may refresh
only the proposed runtime source observations using the actual observer. From
the repository root, run this as a Node module with supported type stripping:

```js
import { readFileSync, writeFileSync } from 'node:fs';
import { observePrivacyRuntimeSources } from './packages/commerce/privacy-runtime-sources.mts';

const path = 'packages/commerce/contracts/privacy-storage-surfaces.v1.json';
const contract = JSON.parse(readFileSync(path, 'utf8'));
contract.runtime_sources = observePrivacyRuntimeSources();
writeFileSync(path, JSON.stringify(contract, null, 2) + '\n');
```

The named surfaces, table assignments and handling requirements must stay intact
unless their behavior has separately been assigned and reviewed. The local audit
reads the current source itself rather than trusting this snippet's output.

## Focused development evidence

`tests/development/privacy-coverage.test.mts` retains the nine original native
cases and adds an ownership-classification negative case for native Medusa.
The three goal IDs cover the representative copy lifecycle, a real omitted-table
fault and the current-suppression import. Supporting cases cover exact 170-table
mapping, omitted agent/analytics surfaces, changed/new cache source, same-store
customer isolation, retention holds and uninstall. Tests were written before the
implementation. The final integrated focused run and separate nonauthor reviews
are the evidence of execution; static parsing alone does not prove behavior.
The added case refuses relabeling native storage as synthetic-only or borrowing a
real SQLite table assignment while keeping the total at 262. Frozen original
surface clauses remain exact, and a current local audit still reports native
Medusa as unverified with all deployment/privacy certification flags false.

Run the single assigned combined development selection through `tools/dev_tests.py`
after a coherent candidate is committed. A local five-goal batch does not trigger
the full privacy, browser, regression or repeated restore campaigns. Formal M07
acceptance and actual deployment qualification remain separate.
