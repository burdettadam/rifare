# Merchant export and paused import

M07-G07 adds a server-local, owner-authorized merchant transfer API in
`packages/commerce/merchant-portability.mts`. It exports one tenant/store from an
existing installation and imports into an otherwise empty installation with the
same tenant, store, and market. It requires no model or connected provider.

## Transfer API

```ts
import { exportMerchant, exportMerchantSuppression, importMerchant,
  merchantSnapshotDigest, bindImportedCredential }
  from './packages/commerce/merchant-portability.mts';

// sourceScope and destinationScope are authenticated owner scopes produced by
// their respective CommerceKernel instances. They cannot be plain objects.
const snapshot = exportMerchant(sourceKernel, sourceScope, {
  snapshot_id: 'merchant_checkpoint_1',
});

// Transport the snapshot as private JSON. Retain and verify the expected digest
// through the owner's trusted transfer channel before calling the importer.
const currentSuppression = exportMerchantSuppression(sourceKernel, sourceScope);
const receipt = importMerchant(destinationKernel, destinationScope,
  receivedSnapshot, independentlyRetainedDigest, {
    suppression: receivedCurrentSuppression,
    suppression_sha256: independentlyRetainedSuppressionDigest,
  });
```

The receiving store and its local owner must already exist. The API does not
create users, accept a source bearer token, remap tenants, merge a live database,
or start any worker. This first format supports the exact current schema and
migration history; a different or extended schema is rejected. A future format
migration needs its own explicit implementation and compatibility evidence.

`merchantSnapshotDigest(value)` provides bounded canonical JSON hashing. A digest
stored inside the package establishes consistency only. The importer also
requires the expected digest as a separate argument; the caller owns its trusted
delivery and verification. These APIs are local service primitives, not newly
published HTTP endpoints.

The suppression checkpoint is mandatory and comes from the source owner's
current erasure-retention channel after the transfer snapshot. Retain its digest
separately, using `merchantSnapshotDigest(currentSuppression)`. The caller must
quiesce the source during final transfer and obtain its latest checkpoint; a
checkpoint merely bundled with an old snapshot cannot prove later erasures.
The importer validates its identity, fields, digest, and timestamp, then replays
the existing erasure implementation before committing. Missing, tampered,
cross-merchant, future, or pre-snapshot checkpoints fail. This preserves the
existing restore boundary against resurrecting subsequently erased data.

## What is preserved

The version-one manifest accounts for all 170 current core tables. Each included
table names its exact columns, row count, and canonical SHA-256. The importer
rejects missing or extra table coverage, unknown columns, duplicate primary keys,
unsafe cell encodings, oversized packages, and tenant/store identifiers belonging
to another merchant, including those embedded in JSON records.

Business row bodies remain unchanged: profiles, policy versions, skill content
and pins, case configuration digests, consent and suppression history, evaluation
records, source mappings, native identities, receipts, and financial amounts.
Amounts stored as decimal strings remain strings; no floating-point conversion
is used. Binary cells use strict base64 objects and are decoded back to SQLite
bytes. The default limits are 64 MiB and 10,000 included rows per snapshot.

Import runs in one `CommerceKernel.transaction`. Foreign keys are deferred while
the snapshot is loaded, then checked before commit. Redacted resource rows are
inserted before their retained privacy tombstones; inconsistent suppression
records fail the transaction. Later erasures in the mandatory current checkpoint
take precedence over the snapshot's old content. An insertion or validation failure leaves the
destination business tables and import controls unchanged.

## Local authority and credentials

The manifest lists exclusions explicitly. Source memberships, permissions,
sessions, challenge/proof records, gift authentication, and worker grants remain
local. Historical actor and proof references remain inert business history.
The receiving owner retains their existing local identity.

Secret-vault envelopes and wrapping keys are absent. Credential metadata includes
only the opaque reference, provider, adapter, creation time, and revoked flag.
Every referenced credential must have a matching metadata entry. Known sensitive
structured fields and recognized credential strings are rejected in portable
rows; this is not a general detector for arbitrary secrets hidden in free text.
The export contains merchant data and must be handled as private information.

Imports return a `credential_map` with `requires_rebind` entries. A compatible
destination credential must be provisioned locally before import, while ordinary
credential management is available. An owner can then record an explicit mapping:

```ts
const binding = bindImportedCredential(destinationKernel, destinationScope, {
  snapshot_id: receipt.snapshot_id,
  expected_digest: receipt.digest,
  source_ref: sourceCredentialReference,
  destination_ref: independentlyProvisionedDestinationReference,
});
```

The destination reference must be active and match the original provider and
adapter. A conflicting mapping fails. Recording a mapping does not create a
vault alias, rewrite historical configuration pins, invoke the credential, or
enable execution. It records `bound_for_reconfiguration` for a future reviewed
configuration. New credentials cannot be provisioned by weakening quarantine;
prepare them before import or use a separately authorized deployment workflow.

## Pause and replay behavior

The importer installs the existing recovery quarantine and uses its unmodified
egress boundary. Action/readiness approvals, credential slots, webhook routes,
execution settings, relevant worker leases, and imported support documents are
revoked or disabled. Financial and content bodies retain their existing digests.
Sending operations become unknown; leased or sending work loses its lease and
requires reconciliation. Every imported generic operation is added to the
existing permanent restore replay-deny list.

The receipt records the precise transformations and original imported counts.
Its mode describes the import event. Repeating the identical snapshot and digest
returns that same receipt without reinserting business rows or replaying work.
A newer suppression checkpoint may apply further erasures; already applied
erasures do not add duplicate erasure events. The returned suppression digest
identifies the checkpoint just applied. Another
snapshot is rejected rather than replacing the first import. Local migration
bindings and merchant import/rebinding receipts are excluded from exports and
cannot be injected through an incoming package.

Existing diagnostic restore activation can permit local diagnostic work after
its reconciliation checks. It still denies secret/model egress and replay of old
operations. This transfer API offers no live activation operation. Migration
ownership and cutover controls are documented in the operator runbook; neither
an import receipt nor an ownership transfer supplies production qualification.

## Focused evidence and limits

`tests/development/merchant-portability.test.mts` covers the three M07-G07 cases,
PORT-020, and ten supporting cases. It checks real SQLite relationships and
rollback, preserved configuration and monetary values, no implicit credential
reuse, tenant/owner boundaries, tombstones, later erasures, repeated imports, and paused work.
The fuller fixture settles one synthetic Woo gateway refund and round-trips its
native identity, observations, consent withdrawal, and actual evaluation record.
Export/import does not add another source refund or gateway movement.

```sh
python3 tools/dev_tests.py --files tests/development/merchant-portability.test.mts
```

This is bounded local development evidence. Full regression, connected-provider
qualification, live merchant migration, and formal prerequisite acceptance remain
separate. No release or independent-machine observation is inferred.
