# Offline installation and upgrade preparation

This guide prepares the **local SQLite commerce diagnostic** from a checksum-pinned
Git bundle. It uses the existing CommerceKernel, its 31 transactional commerce
migrations, the shared HTTP/status UI and the existing suppression-aware recovery
implementation. It does not install or qualify the PostgreSQL/React target stack.
`npm run dev` retains its explicit `TARGET_STACK_NOT_QUALIFIED` exit.

The observed preparation uses disposable local directories and installed tools on
the same host. A nonauthor installation on an independent machine, a reviewed
tagged release, connected services and formal M07-G10 acceptance remain required.
No public tag, license-server activation, model credential, mandatory provider,
network download or private maintainer command is part of this workflow.

## Prerequisites and the source artifact

Install Git and a Node version allowed by [package.json](../package.json), with
`node:sqlite` and TypeScript stripping. The currently declared versions are Node
22.16 through 22.x or Node 24.x. Python 3.10+ is needed only for the optional
focused development runner. The root package has no third-party dependencies;
there is no package-install step in the installer.

Obtain the bundle's SHA256, commit and tree from the separately retained handoff
record. A checksum proves identity relative to that record; the artifact cannot
self-authorize a release. Preserve the existing fully tested checkpoint and its
verification record. New development checkpoints are not full-regression passes.

Use native Git to inspect or recover a supplied bundle. These commands do not
create a release tag or configure a hosted remote:

```sh
git clone --mirror /absolute/path/Rifare.bundle Rifare-history.git
git clone Rifare-history.git Rifare-source
cd Rifare-source
git checkout --detach EXPECTED_COMMIT
git rev-parse HEAD HEAD^{tree}
```

The mirror retains every bundled ref. The installer also preserves the exact
original bundle as `artifact.bundle`, so branches remain recoverable even though
its normal `source/` checkout selects one detached commit. The input must be a
full, local, regular bundle with no prerequisite objects. Local Git clone and
bundle verification run with hooks/templates disabled and file transport only.

## Install and seed

Run this tool from the selected artifact's clean, committed source checkout. Its
current commit and tree must match the supplied artifact; the installer refuses
modified or untracked source instead of mixing transitive runtime versions.
Ignored private evidence does not change the source identity. Place a request JSON
outside source; replace every uppercase placeholder with an actual absolute path
or the independently retained hexadecimal pin. Destination parents must already
exist. The destination itself must **not exist**, even as an empty directory.

```json
{
  "artifact": {
    "bundle_path": "/absolute/path/Rifare.bundle",
    "bundle_sha256": "EXPECTED_64_HEX_SHA256",
    "commit": "EXPECTED_40_HEX_COMMIT",
    "tree": "EXPECTED_40_HEX_TREE"
  },
  "destination": "/absolute/path/rifare-install-a",
  "profile": "commerce-sqlite-diagnostic",
  "seed_demo": true
}
```

```sh
node --experimental-strip-types tools/install-upgrade.mts install /absolute/path/install.json
```

The result gives the private database path and `manifest_sha256`. Retain this pin
outside the installation. `source/` contains the actual selected Git checkout;
`data/database.sqlite` contains the commerce schema. The installer refuses
different installer commit/tree, runtime/kernel/recovery bytes or migration files
instead of mixing incompatible installed code and the currently running installer.

With `seed_demo: true`, the existing synthetic simulator creates seven resources
for tenant `installation-demo`, store `store`, owner member `operator`. Its order
`ORD-1001` has total 12,500 USD minor units and a separately recorded shipment.
These are synthetic fixtures. Set `seed_demo: false` for an empty commerce schema;
there is then no precreated operator or authentication session. Merchant import
is a separate scoped operation and does not activate live credentials or work.
That operation requires a fresh scoped `exportMerchantSuppression(kernel, owner)`
checkpoint from the authoritative source after the transfer snapshot, with its
`merchantSnapshotDigest` supplied as the fifth import argument. An old snapshot
alone cannot establish that later erasures were applied. See the public
[merchant portability guide](MERCHANT-PORTABILITY.md) for the complete API.

Files and directories are private. `installation.json` is written only after
preparation succeeds. A directory with only `preparing.json` is incomplete and
cannot be served. Existing destinations, symlink paths, hard-linked input files,
changed bundle pins and changed migration histories are refused.

## Inspect and use the existing no-AI workflow

An inspection request is `{ "directory": "/absolute/path/rifare-install-a",
"manifest_sha256": "RETURNED_MANIFEST_SHA256" }`.

```sh
node --experimental-strip-types tools/install-upgrade.mts inspect /absolute/path/inspect.json
```

A served diagnostic request additionally names an existing local operator:

```json
{
  "directory": "/absolute/path/rifare-install-a",
  "manifest_sha256": "RETURNED_MANIFEST_SHA256",
  "tenant_id": "installation-demo",
  "store_id": "store",
  "actor_id": "operator",
  "port": 0
}
```

```sh
node --experimental-strip-types tools/install-upgrade.mts serve /absolute/path/serve.json
```

Open the printed loopback URL with `/status`. The temporary bearer is in the
printed private session file; use it in the existing status UI's operator token
field. The shared authenticated HTTP lookup is
`GET /v1/lookup?kind=order&external_id=ORD-1001`, with `Authorization: Bearer ...`.
The UI and deterministic read remain usable without model keys. The server
configures no vault, model provider, real sender or external source adapter.
The bearer is never printed by the tool. Stop with Ctrl-C; the session is revoked
and its private file removed. A stale session file requires checking its recorded
PID before manual cleanup; the tool refuses to replace it.

The preparation tool creates no worker process or scheduler. Diagnostic execution,
real commerce qualification and formal product acceptance remain separate states.

## Stage an upgrade without replacing the original

Stop the source installation first. Keep its source bundle and manifest pin.
Use the new artifact's installer and a new empty destination request:

```json
{
  "artifact": {
    "bundle_path": "/absolute/path/new-Rifare.bundle",
    "bundle_sha256": "NEW_BUNDLE_SHA256",
    "commit": "NEW_COMMIT",
    "tree": "NEW_TREE"
  },
  "destination": "/absolute/path/rifare-install-b",
  "source": {
    "directory": "/absolute/path/rifare-install-a",
    "manifest_sha256": "ORIGINAL_MANIFEST_SHA256"
  }
}
```

```sh
node --experimental-strip-types tools/install-upgrade.mts upgrade /absolute/path/upgrade.json
```

The tool verifies the stopped original, copies its database into the new private
directory, and runs the unchanged CommerceKernel migrations in their existing
transaction. Its history-prefix and checksum checks remain fatal. It verifies the
result against the current storage inventory, makes an actual recovery snapshot,
and restores that snapshot into the new `data/` directory in **quarantine**.
Copied sessions, approvals, credential slots and execution settings are revoked;
unknown work stays uncertain. The tool never switches an active database or
starts a replacement worker. The original database hash is checked again before
publishing the new installation manifest.

If the process is interrupted, the original installation remains the rollback
point. Keep any incomplete destination for diagnosis; it has no ready manifest.
Only remove a stopped, positively identified disposable destination. Restart
preparation with another new path. There is no automatic in-place rollback or
destructive SQL downgrade.

## Restore the pre-upgrade state

For a same-schema upgrade, the new installation contains a pinned pre-upgrade
`rollback/` snapshot. Obtain a **current** suppression checkpoint from the
authoritative source using the existing `suppressionCheckpoint(kernel)` function
and pin it with `contentDigest(checkpoint)`. The saved `suppression.json` is only
the capture-time checkpoint; it must not replace newer erasures. The exact latest
object belongs in the private rollback request:

```json
{
  "upgrade": {
    "directory": "/absolute/path/rifare-install-b",
    "manifest_sha256": "UPGRADE_MANIFEST_SHA256"
  },
  "destination": "/absolute/path/rifare-install-rollback",
  "suppression": { "version": 1, "generated_at": 0, "subjects": [], "resources": [] },
  "suppression_sha256": "CURRENT_CHECKPOINT_SHA256"
}
```

The zero timestamp above is a shape example and will be rejected for a newer
snapshot. Use the actual checkpoint and its digest, without removing fields.

```sh
node --experimental-strip-types tools/install-upgrade.mts rollback /absolute/path/rollback.json
```

Rollback uses the unchanged recovery implementation. Tampered manifests/databases,
stale suppression and unsafe existing destinations remain fatal. It creates a
fresh quarantine restore of pre-upgrade data with the current compatible-schema
artifact; it does not imply that an older binary was activated. Native Git can
select the preserved prior artifact separately. A schema-changing downgrade is
blocked: retain the untouched original installation and run the matching previous
artifact's recovery procedure. Do not change migration hashes or recovery schema
guards to force a restore.

Keep backups and databases out of source control and public evidence: they may
contain merchant records and encrypted secret references. Wrapping keys and
external attachment paths are excluded by the existing snapshot contract.

## Focused evidence and limits

```sh
python3 tools/dev_tests.py --files tests/development/installation-upgrade.test.mts
```

The ten native cases cover installation/CLI seed and upgrade, absent activation
or model services, interrupted preparation and rollback, the actual shared served
UI/HTTP read, artifact pins, unsafe destinations, retained migration guards and
suppression-aware recovery, an actual transactional failure in migration 031 and
the scoped merchant import into a clean installation. The default 60-case/four-file/60-second development
budget applies. The suite starts only a temporary local diagnostic server; it
does not run browser automation, nested catalogs, the full regression controller
or archive audit chains. Raw reports and the author work record distinguish these
observations from independent-machine and tagged-release qualification.
