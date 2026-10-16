# Runtime test and evidence map

Every native case is in `tests/development/`. Run `npm run test:runtime` or
`python3 tools/verify.py --runtime`. Native TAP results identify the exact executed
case titles. Empty, skipped, cancelled and failing runs are not accepted.

| Goal obligation | Executable case | Current evidence boundary |
| --- | --- | --- |
| CASE-M00-G05-01 | Two linked worktrees, independent marker/job/attachment data, stop one, keep the other working, restart the first | Real local processes and SQLite; not PostgreSQL |
| CASE-M00-G05-02 | Start with sanitized child environments, submit external requests to a trap server and a remote-shaped URL, observe denial and zero trap hits | Real local denial path; not host/container-wide firewall enforcement |
| CASE-M00-G05-03 | Clone a clean source fixture, install the zero-package lock into an empty npm cache offline, migrate and start the services | Actual smoke lock/Node stack only; not target React/PostgreSQL installation |

Additional tests preserve migration checksums and rollback, database ownership,
idempotent input, durable queues, competing claims, lease expiry and stale-worker
rejection, effect-before-commit recovery, immutable attachments, path and symlink
checks, HTTP credential/origin/host protections, proxy route restrictions, startup
collision handling and instance-bound shutdown.

The Python intake tests allow only the explicitly pinned zero-dependency command
manifests. New dependencies, optional packages, changed command bytes, new lock
entries and self-listed manifest paths remain blocked pending real intake.

## Deliberate fault obligations

Change the namespace function to return a common identifier; the two-worktree
identity test must fail. Redirect a second configuration to another instance's
database; the database-owner test must reject it. Remove the external-effect
throw; the denial test must fail. Ignore an applied migration checksum; the
checksum test must fail. Permit completion with a stale lease; the lease test must
fail. Ignore Host/Origin validation; the raw HTTP security tests must fail.

Fault demonstrations are temporary candidates, never production switches. Keep
actual diffs and TAP results in ignored evidence, bound to the tested source. An
import error or syntax error is not a successful targeted-fault demonstration.

## Retained test adaptations

The existing Python source-fixture copy excludes ignored runtime data so running
local services cannot be copied into a source distribution fixture. No assertion
is removed. The existing unknown-lockfile rejection fixture moves from the now
reviewed root lockfile to `unreviewed/package-lock.json`; it still requires rejection.
This is not permission to import arbitrary lockfiles or add dependency packages.
All other historical test expectations, product specifications and example bytes
remain preserved. Source file-count oracles increase only for enumerated new paths.

## Still required for full M00-G05 acceptance

Install and inventory the real target dependencies and produce their genuine
lockfile; build and render React; execute the PostgreSQL migrations and competing
worker tests on two isolated target instances; qualify container egress and
shutdown; repeat from a clean target checkout; obtain independent authority and
regression reviews. The expired bootstrap exception is not reused.
