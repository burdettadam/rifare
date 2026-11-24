# Architecture

## Active application

`apps/commerce-backend` owns the Medusa/PostgreSQL application. Use upstream
catalog, pricing, cart, inventory, order and post-purchase modules and workflows.
Use upstream Admin rather than maintaining a second merchant application.

Rifare-specific code provides external-customer identity binding, native cart
context, an original-operation journal and guarded delegated-use execution.
Native database migrations, stale-worker fencing, refusal identities and privacy
minimization remain in that application. Their protection is not relaxed by
retiring the replaced SQLite implementation.

ElevenID owns identity/trust/delegation. The selected external identity provider
owns authentication. Rifare owns commerce policy and actual effects. Connected
provider/caller provisioning and production qualification remain open.

## Shared authority code

`packages/adapters/delegated-commands` contains the strict codec and public mTLS
client. `packages/adapters/delegated-receipts` contains strict JSON and JOSE
verification. The small pure modules under `packages/commerce` supply canonical
values, immutable checkout snapshots, receipt binding and command correlation.
They contain no database engine. Primitive/correlation functions were extracted
without changing their validation or error behavior.

`apps/commerce-backend/tools/build-authority-adapters.mjs` compiles this shared
graph for the standalone backend. Generated stale modules are removed; no SQLite
kernel or repository-source fallback is shipped. The relocation test exercises
actual command bytes and mTLS after copying the compiled adapters elsewhere.

## Retired implementation

The custom SQLite kernel, its migrations, old API/worker/browser applications,
clients, examples and associated harness are removed under ADR-0093. Historical
feature documents, planning and work records remain specifications/reference.
They do not establish that every old scenario is available in Medusa. Develop
missing functionality in the active application instead of keeping two engines.
