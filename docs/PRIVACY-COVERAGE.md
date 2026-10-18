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

For a running kernel, a server-local caller with the existing `privacy.manage`
authority can call:

```ts
import { auditPrivacyCoverage } from '../packages/commerce/privacy-coverage.mts';

const report = auditPrivacyCoverage(kernel, ownerScope, {
  observed_surfaces: deploymentSurfaceIds,
});
```

The report accounts for all 170 shipped commerce tables exactly once, retains
their existing handling rules, and returns row counts only for the caller's
merchant. Tables without merchant scope report no row counts. No customer body,
credential, secret envelope, bearer token or suppression hash is returned by
this inventory audit. Existing authorization, migration and recovery fences
still apply; this helper does not bypass a paused installation.

`local_inventory_current` means the actual SQLite schema, explicit table-to-surface
mapping, and current source bytes match their reviewed declarations. It does
not mean every subject copy was populated or erased. The report therefore always
sets `deployment_coverage_verified`, `privacy_qualified`, `physical_erasure` and
`legal_compliance_certification` to `false`. The audit itself reports subject-copy
outcomes as unexercised. Separate native behavioral cases observe those outcomes
for synthetic fixtures.

## Explicit storage surfaces

The additive contract is
`packages/commerce/contracts/privacy-storage-surfaces.v1.json`. The original
storage inventory and its schema extensions are unchanged.

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
| `caller_export_artifacts` | Customer/merchant JSON exports and downloaded media; destination-specific inventory, access control and retention remain operator work. |
| `recovery_files_and_database_pages` | Old backups, staged upgrades, database free pages/journals/WAL, replicas and wrapping keys; logical suppression does not physically delete these artifacts. |
| `synthetic_fixture_storage` | Independent smoke databases/files and adapter fixture ledgers; commerce privacy operations do not erase another fixture's storage. Only synthetic data is qualified here. |

Each contract entry names actual implementation paths, export treatment, erasure
treatment, retained records and the observations still needed. This finite table
mapping is reviewed source metadata, not an inference that every column labeled
as audit is anonymous. Arbitrary external identifiers and unbound configuration
text can remain personal data. Subject exports retain
`unbound_text_requires_manual_scope_review: true`.

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
remains quarantined; image/message/knowledge/task copies are removed or redacted
before exposure, and the rebuilt metric report keeps an unavailable member in
its original denominator.

These are same-runtime synthetic observations. They do not prove fresh delivery
of a real external checkpoint, delete the original snapshot, inspect a provider
account, discover all possible process caches or establish a legal retention
schedule. Active configured holds retain eligible content until an authorized
release or expiry; uninstall disconnects the store and leaves held records for
server-local retention administration. The required operator/provider surfaces
remain individually listed as unverified.

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
only the proposed runtime source observations with ordinary Python:

```python
from pathlib import Path
import hashlib, json

path = Path('packages/commerce/contracts/privacy-storage-surfaces.v1.json')
contract = json.loads(path.read_text())
sources = []
for root in contract['runtime_roots']:
    for source in Path(root).rglob('*'):
        if source.is_file() and source.suffix in contract['runtime_extensions']:
            if source.is_symlink():
                raise ValueError('Unreviewed source link')
            sources.append({'path': source.as_posix(),
                            'sha256': hashlib.sha256(source.read_bytes()).hexdigest()})
contract['runtime_sources'] = sorted(sources, key=lambda row: row['path'])
path.write_text(json.dumps(contract, indent=2) + '\n')
```

The named surfaces, table assignments and handling requirements must stay intact
unless their behavior has separately been assigned and reviewed. The local audit
reads the current source itself rather than trusting this snippet's output.

## Focused development evidence

`tests/development/privacy-coverage.test.mts` contains nine whole native cases.
The three goal IDs cover the representative copy lifecycle, a real omitted-table
fault and the current-suppression import. Supporting cases cover exact 170-table
mapping, omitted agent/analytics surfaces, changed/new cache source, same-store
customer isolation, retention holds and uninstall. Tests were written before the
implementation. The final integrated focused run and separate nonauthor reviews
are the evidence of execution; static parsing alone does not prove behavior.

Run the single assigned combined development selection through `tools/dev_tests.py`
after a coherent candidate is committed. A local five-goal batch does not trigger
the full privacy, browser, regression or repeated restore campaigns. Formal M07
acceptance and actual deployment qualification remain separate.
