# Recovery rehearsal and measured inbox capacity

M07-G11 and M07-G12 add local operations preparation under ADR-0034. The original
external qualification requirements and blocked M05/M06 dependencies remain.
These commands use disposable SQLite and synthetic source ledgers on the current
host. They do not establish an approved deployment profile or production capacity.

## Recovery

`packages/operations/recovery-rehearsal.mts` wraps the existing safe-recovery
implementation. Supply the independently retained snapshot manifest hash and a
current, separately pinned suppression checkpoint. The existing path checks,
schema/history checks, atomic staging, credential revocation and quarantine remain
the restoration authority. The source database and target must be quiescent during
the rehearsal; filesystem/DB administration is already a privileged local action.

The reconciliation checks resource data at the declared snapshot point, applies
current subject suppression, preserves nonsuppressed embedded attachments and
encrypted credential envelopes, and compares durable operation identities and
states. The existing conversion of interrupted `sending` operations and leased
work to `unknown` is explicit. Copied sessions must be revoked or removed; new
local read sessions do not grant write authority. The inspection also checks
disabled webhook routes, grants, credential slots, approvals, execution settings,
case leases and gift grants, permanent replay markers, and the existing write and
egress guards. It never clears quarantine or performs activation.

```sh
node --experimental-strip-types tools/rehearse-recovery.mts --describe
node --experimental-strip-types tools/rehearse-recovery.mts --run-local --output evidence/recovery-local.json
```

The fixed drill creates an approved but undispatched refund, an approved but
unpurchased label and a queued customer message through existing commerce APIs.
It adds an embedded attachment, an encrypted credential and a signed webhook
route. It restores and reopens the services twice, attempts each queued path,
and checks both calls and separate source ledgers for unchanged effects. No
scheduler is introduced. Fixture files are removed after the observation; the
report is not a backup. Output files are private and cannot overwrite an existing
file. Parent directories must already exist.

Restore and whole-rehearsal durations use actual monotonic time. Start/end wall
timestamps are recorded separately. The recovery-point gap is the application's
reference timestamp minus the snapshot timestamp; it is a snapshot-age measure,
not proof of the amount of data lost during a real incident. The fixed drill
labels its synthetic application clock. The API defaults to the application
wall clock. Targets are caller-declared local limits, and misses are reported.
External attachment stores, wrapping-key recovery, live authoritative
reconciliation, real RPO/RTO and an independently operated target host remain
unqualified. An inspection failure retains the freshly restored quarantined
directory for investigation; it does not activate or overwrite it.

## Inbox admission and backpressure

`WebhookInbox` accepts an optional server-local constructor limit:

```ts
new WebhookInbox(kernel, readWebhookKey, {
  max_pending_events: 8,
  max_pending_bytes: 16384,
  retry_after_seconds: 1,
});
```

The default without this option preserves the existing unlimited intake behavior.
Configured instances must all use the same limits for the shared database. The
immutable limit is process configuration, not merchant-supplied request data or a
persisted deployment setting. The measured profile explicitly requires the
frozen limit above. Local deployment owners must carry it to every intake process;
an old or differently configured binary is outside this capacity guarantee.

Signatures, routing, input bounds and JSON checks happen before admission. Inside
the existing `BEGIN IMMEDIATE`, the inbox first checks a persisted duplicate and
then counts unconsumed events and raw bytes across the merchant's routes. Both
quarantined and pending events consume the budget until a durable consumption
record exists. Other merchants have separate limits. A rejected delivery is not
inserted or acknowledged. An identical already persisted delivery still receives
HTTP 200 at capacity; a new persisted event receives 202. Capacity rejection is
HTTP 429 with `acknowledged: false` and `Retry-After`. Persistence failure retains
the existing 503 behavior. Restart and competing writers share the database count;
there is no process-local counter to reset or race.

Capacity covers pending intake, including raw bytes, and does not bound total
retained database history or disk usage. Consumption preserves the original inbox
record. No eviction, automatic deletion or new database migration was added.

## Frozen load observation

The versioned workload is
`packages/operations/contracts/load-workload.v1.json`: eight normal events in
single-item batches and twelve burst events in one batch. All twenty events have
fixed ordered identities and source versions; every fourth has an identical
duplicate delivery. The burst exceeds the eight-event pending budget. A rejected
event keeps its identity, waits the actual one-second retry interval, and has at
most three attempts. Exhaustion remains explicit and makes the envelope fail.
This one-shot loop is a diagnostic workload, not a production worker/retry service.

```sh
node --experimental-strip-types tools/measure-load.mts --describe
node --experimental-strip-types tools/measure-load.mts --run-local --output evidence/load-local.json
node --experimental-strip-types tools/measure-load.mts --run-local --baseline evidence/load-local.json --baseline-sha256 RETAINED_CANONICAL_SHA256
```

The tool writes the report's canonical SHA-256 to stderr. Retain that pin outside
the candidate being compared. A comparison requires the same workload, hardware,
runtime, capacity and accepted-event denominator. It reports a regression if any
specified p95 exceeds 1.5 times the pinned observation; the frozen local absolute
targets are reported separately. A changed workload or hardware is a different
qualification context, not an improved baseline. A hash binds supplied evidence;
it does not authenticate who approved a gate.

Reports include the actual OS, CPU model/count, architecture, visible memory and
available cgroup limits. They retain actual per-attempt intake times, processing
times, queue lag to processing, lag to durable consumption, real retry waiting,
counts and accepted/persisted/consumed delivery IDs. Raw persisted bytes and hashes
are reconciled against each acknowledgement; every consumption must have an
operation record. Failed persistence cannot become a successful acknowledgement.
External dependency waiting is `null` because none is measured. This small frozen
local workload does not qualify sustained order volume, multi-host PostgreSQL,
provider throttling, physical effects, paid hardware or connected services.

## Focused verification and rollback

The combined `tests/development/recovery-load.test.mts` has eighteen native cases:
seven recovery cases, ten load/admission cases and one bounded CLI-contract case.
It includes real restore/reopen checks, a deliberately enabled restored flag,
post-snapshot erasure, corrupt/stale pins, capacity and persistence failures,
duplicate acknowledgement, competing process admission and loopback HTTP 429.
A fabricated acknowledgement without a persisted ID and a degraded pinned
latency observation must fail their checks. These are local targeted faults.

The integration owner runs this file once with the other three assigned goal
files under the sixty-case, four-file, sixty-second development profile. No full
regression or old restore campaign is dispatched here. Independent reviews and
immutable native evidence are retained with the cumulative checkpoint. Local
implementation readiness does not record formal goal acceptance.

Rollback uses native Git to restore the prior source. There are no new migrations.
Keep restored data quarantined and reconcile unknown outcomes through the existing
workflow; do not drop replay markers, restore copied credentials to active state,
or turn capacity rejection into an acknowledgement to work around a backlog.
