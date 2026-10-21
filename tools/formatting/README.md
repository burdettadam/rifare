# Optional source formatting

This directory pins Prettier for ten selected commerce and demonstration modules.
It has its own dependency manifest and lockfile. The root demo installation stays
dependency-free and works with `npm ci --offline --ignore-scripts`.

From the repository root:

```sh
npm ci --prefix tools/formatting --ignore-scripts --no-audit --no-fund
npm run check --prefix tools/formatting
npm run write --prefix tools/formatting
```

The first command downloads the exact locked formatter if it is not already in
your npm cache. The other commands use only that local installation. They do not
download tools, run product tests, or call providers. `check` reports formatting
differences; `write` applies the layout. Review a formatting-only diff separately
from behavior changes. A clean format check does not replace behavioral tests
when making a functional change.

The explicit file list is in the two package scripts. It covers the commerce
kernel, authorization, action gateway, operation store and receipts, resolution
execution, support service/delivery/conversations, and the support fixture demo.
It does not recursively reformat the repository. Expand the list deliberately
alongside a reviewed formatting-only change; keep both lists aligned.

Prettier preserves import order. No import-sorting plugin is installed. The shared
configuration uses two-space indentation, semicolons, single quotes, LF endings,
and a 100-column print width. Long string literals can exceed that width.

## Dependency provenance

Prettier **3.9.10** is the sole optional development dependency, pinned without a
version range. The npm lockfile records its official registry URL and SHA-512
integrity. The package is licensed under MIT; its installed `LICENSE` and
`THIRD-PARTY-NOTICES.md` retain the package and bundled-parser notices. Dependency
bytes under `node_modules/` are ignored and are not part of Rifare's source handoff.
Do not include them in a source archive or assume this source inventory reviews
a future binary/container distribution.

Upstream: [installation guidance](https://prettier.io/docs/install),
[CLI checks](https://prettier.io/docs/cli),
[source and notices](https://github.com/prettier/prettier/tree/3.9.10).
