# Rifare local development environment

## Current qualification boundary

M00-G05 is **partially implemented, not accepted**. The runnable profile is named
`smoke-sqlite`. It uses real, separate Node API, worker and web processes; a real
persistent SQLite database; migrations; and local attachment files. Its browser
shell is plain JavaScript/HTML, **not React**. SQLite is not claimed to establish
PostgreSQL compatibility. No commerce action, payment, real customer, model,
carrier or warehouse integration exists in this profile.

The selected target remains TypeScript/Node + React + PostgreSQL. The current
execution host cannot resolve package-registry downloads and supplies neither
PostgreSQL nor Docker. Target dependency installation/lock generation, React
build/rendering, PostgreSQL migrations/concurrency and container-level egress
isolation are not executed or qualified. No speculative application lockfile,
Docker image digest or installed dependency has been fabricated.

`npm run dev` deliberately exits 2 and names this gap. There is no automatic
fallback. `npm run dev:smoke` explicitly selects the limited profile.

## Prerequisites

Git, Node.js and its bundled npm are the only runtime prerequisites. Python 3.10+
runs the retained planning checks. The **observed smoke host** is Linux with
Node 22.16.0 and npm 10.9.2. `.node-version` pins that observed version for
reproduction; it is not a claim that this older patch is suitable for deployment.
Node's type stripping and SQLite API are experimental in that observed version.
No separate TypeScript compiler or global JavaScript package is needed to execute
the smoke code. Static TypeScript checking is not claimed. macOS/Windows runtime
qualification remains unperformed.

## Install and start

From this Git checkout or an assigned linked worktree:

```sh
npm ci --offline --ignore-scripts
npm run dev:smoke
```

The root lockfile contains zero third-party packages. The install command verifies
its consistency without network access; it is **not** the future target-stack
lockfile. Read the JSON `ready` line for the actual API and UI URLs. Open the
`http://127.0.0.1:...` UI URL, not a rewritten `localhost` or LAN address.

The default port value is zero: the operating system assigns free loopback ports
for API, UI and control. To use fixed ports, set `RIFARE_API_PORT`,
`RIFARE_UI_PORT` and `RIFARE_CONTROL_PORT` to different unprivileged port numbers
before starting. For example in Bash:

```sh
RIFARE_API_PORT=31001 RIFARE_UI_PORT=31002 RIFARE_CONTROL_PORT=31003 npm run dev:smoke
```

Reserved or conflicting ports fail; there is no automatic takeover of another
service. Unreviewed `RIFARE_*` settings, external database/queue settings and
`NODE_ENV=production` fail before startup.

The starter applies the current migration before launching children. An explicit
idempotent migration check is also available:

```sh
npm run db:migrate:smoke
```

Migration filenames must be contiguous. Applied SQL checksums are immutable;
missing, changed and unknown-future migrations are errors. There is no automatic
destructive rollback or reset command.

## Use the diagnostic UI

Save a marker with an ID and a short synthetic value. Queue an attachment using
the same form. The worker leases the durable synthetic job, writes a local JSON
attachment and records completion. Repeating an ID with the same value is an
idempotent retry; different content produces a conflict. No fixture is a real
order, return or payment. Values are rendered as text, not executable HTML.

The UI proxies only the enumerated local diagnostic routes. The API requires a
random per-run credential for data/mutations. That credential remains in the
private run file and child IPC, not browser JavaScript, process arguments or
normal startup output. Health endpoints reveal only service/profile identity.

## Stop and recover

In a second terminal in **the same worktree**:

```sh
npm run stop:smoke
```

Alternatively use Ctrl-C in the owning foreground terminal. Shutdown uses an
authenticated, instance-bound control request or owned child handles. It never
kills a PID loaded from a file and never runs a global process kill. Data and
completed attachments remain for the next start; the owned run file and start
reservation are removed after clean shutdown.

An interrupted process can leave `start.lock` or `run.json`. Do not blindly remove
them or assume a stored PID is current. Inspect the owning terminal/process and
its live endpoints first. After establishing that no owned instance remains,
remove only that instance's stale reservation files. Preserve the database and
attachments unless a separate intentional reset was authorized. The program
refuses an ambiguous takeover instead of stealing another writer's resources.

## Worktree isolation

The canonical real Git worktree root determines a 96-bit instance identifier.
Each worktree has separate `runtime/instances/<instance-id>/` data, SQLite/WAL
files, queues, attachments and run-control state. The database contains an owner
sentinel and rejects a different instance identity. Runtime paths reject symlink
redirection and linked files. Moving a checkout creates a new instance identity;
no implicit migration or copying of old runtime data occurs.

Use native Git to create another assigned worktree. Run the same start command
there. Do not copy `runtime/`, a run credential, or a database between worktrees.
The acceptance smoke exercises two real linked worktrees with the same source
commit, distinct data under identical fixture IDs, independent queues, stop-one/
continue-the-other behavior, and restart persistence.

## Tests and target-stack gate

```sh
python3 tools/verify.py             # retained planning checks and Python helpers
python3 tools/verify.py --runtime   # also runs native Node smoke acceptance tests
npm run test:runtime               # native Node cases directly
npm run dev                       # exits 2: target stack is not qualified
```

Full smoke verification rejects failed, skipped, cancelled and zero-test runs.
The three original goal case IDs identify the corresponding **smoke subcases**;
they do not close the full goal while its target-stack obligations are missing.
See [test/evidence mapping](RUNTIME-TESTS.md).

The external-effect adapter rejects every target before making a network call;
its trap-server test verifies zero observed effects. There are no provider
implementations to activate. This is **not an OS network sandbox**: arbitrary
trusted developer code can still import Node networking. Container/firewall-level
egress isolation belongs to the still-unqualified target setup. Do not load
untrusted code, real customer data or production credentials into this profile.
