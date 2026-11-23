# Optional delegated receipt verifier dependency

This separately installed runtime workspace pins `jose` **6.2.18** for local
compact-JWS verification. Its source/development intake is assigned in
[ADR-0068](../../../docs/decisions/0068-native-receipt-verification.md).
The root package, root lock and offline demo installation remain unchanged.
Installing this dependency does not configure an issuer, trust a signing key,
publish a provider route or authorize a commerce operation.

After the ordinary root setup, run this from the repository root with a
supported Node runtime and its bundled npm:

```sh
python3 tools/install_receipt_runtime.py
```

This command downloads the exact locked package if it is absent from the npm
cache. Once cached, require an installation without network access with:

```sh
python3 tools/install_receipt_runtime.py --offline
```

The helper reuses the reviewed manifest and graph validator, copies the exact
workspace manifests to an owned temporary npm prefix under repository-root
`node_modules/`, and runs `npm ci` with scripts, audit and funding requests
disabled. It checks the resulting one-package graph, original package manifest
and MIT notice, then atomically moves only JOSE to root `node_modules/jose`.
The workspace has no package scripts or install hooks; the library has no
runtime, optional or peer dependencies. Node resolves this package through
ordinary ancestor-directory ESM resolution without a custom loader.

Use the helper with no concurrent package-manager or filesystem mutations.
It preserves unrelated installed root packages, accepts an existing JOSE tree
only when every installed file matches the locked installation, and refuses
symlinks, special files or a differing destination. Resolve a reported conflict
explicitly in the owned checkout before retrying; the helper does not delete it.

Do not run `npm ci --prefix packages/adapters/delegated-receipts`. A nested
`node_modules` under `packages/`, `packages/adapters/` or this workspace would
shadow module resolution or enter the unchanged first-party privacy source
inventory, so the helper refuses any such directory. Installed third-party
bytes remain outside the `apps/` and `packages/` runtime source roots. A later
root `npm ci` can prune the optional JOSE package because the root lock remains
dependency-free. Run this helper again after that root installation.

## Provenance and retained terms

The package is published by the upstream `panva/jose` project:

- [Release 6.2.18](https://github.com/panva/jose/releases/tag/v6.2.18), published
  2026-11-18, source commit `a0267915e66439c20022f4255b71a3f6511d8b56`.
- [Official registry archive](https://registry.npmjs.org/jose/-/jose-6.2.18.tgz).
- Archive integrity:
  `sha512-doV4thUwgkrycJH4yLeqwTGIIZphHl+pk7CPReuMIhYhncmgzdko85MaCG4YQFTxqMFr1/oEH32tZuKKovcDEg==`.
- [MIT license and original copyright notice](https://github.com/panva/jose/blob/v6.2.18/LICENSE.md):
  copyright 2018 Filip Skokan. The installed repository-root
  `node_modules/jose/LICENSE.md` retains the full original license. It is not
  relicensed as Rifare material.

The checked-in package and lock are the complete one-package dependency graph.
The source inventory checks their exact reviewed bytes, version, official
registry location, integrity, license metadata and absence of extra packages or
installation hooks. A pin or graph change needs a new review. The npm cache and
installed bytes under `node_modules/` are ignored and excluded from source
exports. Keep the upstream license with any later redistribution of those bytes;
the existing binary/container release audit remains a separate requirement.

No upstream protocol vector or proprietary source is included in this workspace.
Separately obtained conformance fixtures must follow their own provenance and
redistribution constraints.
