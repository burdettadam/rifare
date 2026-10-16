# ADR-0006 — M00-G05 profile and qualification boundaries

Status: implementation decision by the delegated maintainer; full goal acceptance
remains blocked. The assignment and qualification plan were committed before the
implementation at `6b65058`.

Keep the accepted PostgreSQL/React target. This execution host has Node 22.16.0,
Git and Python, but no database server or Docker; direct registry and binary
downloads fail at name resolution. Do not declare an uninstalled package or
unexecuted database test successful.

Implement a bounded, explicitly selected `smoke-sqlite` diagnostic slice using
Node's built-in HTTP, SQLite, test runner and erasable TypeScript support. It is
useful evidence for worktree identity, process lifecycle, persistent fixture
state, queue and attachment boundaries, but is not interchangeable with the
target-stack qualification. It introduces no agent framework or model dependency.

The root npm metadata has zero dependency packages and exact checked-in command
bytes. The inventory checker may recognize only this explicit empty-graph command
surface; all third-party dependency graph intake remains fail-closed. Preserve
notices, private-source classification and public-release blockers. This decision
does not grant a publication license or create a general manifest exemption.

Use a random local session credential, loopback-only listeners, strict Host/Origin
checks, scoped routes, no arbitrary proxy, bounded inputs and a deny-all external
adapter. Pass child startup credentials over IPC, not command-line arguments.
Do not claim those application controls sandbox arbitrary code on the host.

No independent reviewers are available in this execution. Do not invent them or
extend BOOTSTRAP-LOCAL-01. Keep the work on its goal branch, mark it partial/blocked,
and preserve exact evidence for target-stack continuation. Do not start M00-G06.

## Primary documentation consulted

- [Node release schedule](https://nodejs.org/en/about/previous-releases)
- [Node TypeScript execution](https://nodejs.org/api/typescript.html)
- [Node SQLite API](https://nodejs.org/api/sqlite.html)
- [PostgreSQL supported release notes](https://www.postgresql.org/docs/release/18.6/)
- [Docker Compose network isolation](https://docs.docker.com/reference/compose-file/networks/)

These sources describe upstream behavior, not an observation that the target
stack has been installed here. The older observed Node patch is retained solely
for reproducing this local smoke evidence, not recommended for production.
