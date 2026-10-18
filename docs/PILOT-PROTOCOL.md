# Pilot outcome protocol and readiness preparation

M07-G17 adds bounded, durable **caller-owned artifact instrumentation**. M07-G18
adds evidence-intake checks and an empty real-observation register. The real pilot
has not started. Merchant consent, actual source observations, elapsed exposure,
independent adjudication and formal milestone prerequisites remain unperformed.
The assignment is [ADR-0035](decisions/0035-locale-pilot-and-carrier-preparation.md).

The implementation imports the unchanged
[`tools/check_release_benchmark.py`](../tools/check_release_benchmark.py).
It pins the existing benchmark, support envelope, scenario inventory, scorer,
support validator and hand-calculated fixtures. It uses that scorer's existing
formulas and validation rules; it does not introduce another quality or economics
scorer. Thresholds remain the frozen proposal, not new approved release targets.

## What is stored

Each registration creates a new private directory supplied by its caller:

- `manifest.json`: exact frozen enrollment bytes, with their supplied SHA-256.
- `registration.json`: source commit/tree/artifact digests, six configuration
  material digests per stratum, owner/consent/privacy/retention references, pinned
  controls and implementation bytes, and the actual artifact creation time.
- `events/00000001.json`, etc.: append-only event batches. Each batch binds the
  registration, its predecessor's exact bytes, a sequence and actual recording
  time. Original evidence references and supplied evidence hashes stay attached.

The caller retains the returned `registration_sha256` and complete `head` outside
the directory, preferably in independently controlled evidence storage. Every
read and append requires those pins. This detects changed enrollment, modified
events, missing earlier batches, truncation after an externally retained head,
unknown files and stale concurrent appends. A caller supplying a fabricated
directory and matching fabricated pins can fabricate declarations; byte equality
does not authenticate the merchant, approval, source receipt or adjudicator.

There is no commerce table, schema migration, hosted service, scheduler, provider
integration or data download. This is an explicit local artifact tool using the
existing Python standard-library scorer, called from TypeScript. It does not
execute a refund, send a message, purchase a label or activate live workers.

## Enrollment and observation rules

The predeclared manifest fixes unique case membership, source kinds, platform and
configuration strata, supported scope, expected handling, currency and the UTC
cutoff. An observation cannot add a case, relabel its source, rewrite its scope or
move the cutoff. Every enrolled member produces a result row, including members
with no observation. Missing observations project to explicit pending/unassessed
rows; their scorer-required cutoff timestamp is a placeholder, not an assertion
that an observation happened then. `case_status.observation_recorded` distinguishes
them from actual submitted observation records.

Registration precedes appending results in this artifact. Its creation timestamp
and the manifest's claimed freeze timestamp are reported separately. Retained
external evidence is still needed to establish that the enrollment was genuinely
frozen before outcomes were known. Historical evidence intake and synthetic replay
do not prove pre-enrollment timing.

Pending, failed, unassessed, cancelled, censored, unavailable and withdrawn members
retain the original enrollment and in-scope denominators. Censoring or withdrawal
flags remain visible alongside any earlier outcome; they never erase the event
history or turn an incomplete case into a qualified live outcome. Withholding or
erasing legally impermissible data is a separate caller duty, described below.

Each event has `id`, `kind`, `case_id`, `evidence_ref`, `evidence_sha256`,
`happened_at` and an exact-shape `payload`. Timestamps use UTC seconds. Unknown
fields, unknown cases, duplicate event IDs and events before the frozen window or
after their actual recording time are rejected. Payloads are:

| Kind | Payload | Projection rule |
| --- | --- | --- |
| `observation` | `disposition`, `actor`, `agent_attempted`, `completed_at` | A pending member may receive an outcome. A terminal completion cannot be rewritten; attempted agent work cannot be hidden. |
| `adjudication` | `oracle_verdict`, `oracle_ref`, `autonomous_resolution`, `supersedes` | Requires an observation. Initial `supersedes` is null; a correction names the previous adjudication event. The unchanged scorer validates consistency with expected handling and autonomy mode. |
| `followup` | `through`, `repeat_contact`, `repeat_ref` | Resolutions only. Observation coverage cannot retreat, and a known related repeat contact cannot be cleared. Missing follow-up stays missing. |
| `reopen` | `related`, `occurred_at` | A related contact through the inclusive seven-day boundary updates repeat contact without rewriting original correctness or completion. Later/unrelated contacts remain in exception history and do not enter the seven-day numerator. |
| `cost` | `minor`, `operator_seconds` | One initial record per member. `minor` is null or the exact five-category integer object; operator seconds may independently be null. Missing amounts are never zero-filled. |
| `cost_adjustment` | `category`, `delta_minor`, `incurred_at`, `base_cost_event_id` | Requires a known original cost. The delta may be negative, but totals must stay within the original nonnegative integer bounds. Incurred time stays inside the cohort window; late arrival is retained and reported. |
| `exception` | `code`, `severity` | Retains every finding and its evidence. Highest recorded severity remains visible. Duplicate or unauthorized effects require SEV0/SEV1 and remain blocking, including excluded cases. |

The five unchanged cost categories are `model`, `messaging`, `shipping`, `hosting`
and `operator`, in integer USD minor units. Late cost events can arrive after the
outcome cutoff; they cannot enroll additional cases or alter the scoring window.
`cost_adjustment` applies only to a known initial cost, so an unknown cost plus a
partial adjustment cannot silently become a complete total. To fill a case whose
cost was never submitted, append its initial `cost` event once. An explicitly
submitted null initial cost remains unavailable in this version; replacing a
declared missing-cost record needs a separately reviewed extension, not an overwrite.

Scoring preserves source separation (`synthetic`, `connected_test`, `live`) and
per-configuration quality. Required handoffs count as correctly handled when
adjudicated correctly but do not become autonomous or correctly resolved cases.
Failed/pending case costs stay in the cost numerator. Mature incorrect resolutions
remain in the repeat-contact denominator. These are the retained benchmark's
semantics, not alternate formulas in the event tool.

## TypeScript and command-line use

The public functions are `registerPilot(request)`, `appendPilotEvents(request)`,
`projectPilot(reference)` and `assessPilotReadiness(request)` from
[`packages/pilot/protocol.mts`](../packages/pilot/protocol.mts).
They spawn the fixed local Python bridge without a shell or provider credentials.
Invalid input throws a bounded `PILOT_*` code without echoing case payloads.

Commands take one explicit local JSON request file:

```sh
node --experimental-strip-types tools/pilot-protocol.mts --describe
node --experimental-strip-types tools/pilot-protocol.mts register REGISTER.json
node --experimental-strip-types tools/pilot-protocol.mts append APPEND.json
node --experimental-strip-types tools/pilot-protocol.mts project PROJECT.json
node --experimental-strip-types tools/pilot-protocol.mts readiness READINESS.json
```

The registration request is an exact-shape object:

```json
{
  "version": 1,
  "directory": "/absolute/new/private/cohort-directory",
  "manifest": { "path": "/absolute/frozen-manifest.json", "sha256": "<64 lowercase hex characters>" },
  "benchmark_sha256": "4b53de08f4af8b915eead29394fa0467d257beb30047347f8fd793648fd9d5ed",
  "source": { "commit": "<40 lowercase hex characters>", "tree": "<40 lowercase hex characters>", "artifact_sha256": "<64 lowercase hex characters>" },
  "configurations": [{ "stratum_id": "STRATUM-A", "materials": {
    "profile": "<sha256>", "skill": "<sha256>", "policy": "<sha256>",
    "runtime": "<sha256>", "model": "<sha256>", "adapter": "<sha256>"
  } }],
  "authority_refs": {
    "owner_ref": "custodian:opaque-reference", "consent_ref": "consent:opaque-reference",
    "privacy_review_ref": "privacy:opaque-reference", "retention_ref": "schedule:opaque-reference"
  }
}
```

This illustrates shape; placeholder digests are not valid inputs. There must be
exactly one material set for every manifest stratum. These supplied byte pins
identify the declared candidate/configuration; the tool does not build that
candidate, inspect a remote model or establish authentic approval.

A project reference has `version: 1`, the same `directory`, the retained
`registration_sha256`, and `head: { sequence, sha256 }`. An append request adds
`events` to that reference. Keep the returned updated head only after a successful
append; stale heads fail. Projection emits the scorer report, projected result
rows, case status, retained exceptions, control pins and event/head identities.

The CLI prints JSON to stdout. Register, append and project exit zero on valid
local work. Readiness prints its blocked report and exits **1** even for valid
input. Malformed input exits 1 with a bounded error code. Neither exit zero nor
an arithmetically good cohort authorizes a pilot or release.

## M07-G18 readiness and the real register

[`work/qualification/M07-real-observations.json`](../work/qualification/M07-real-observations.json)
is intentionally empty. It contains zero merchants, observations, exposure days,
approvals or reviewer records and has `qualification: "unperformed"`. Do not
replace it with simulator output. Authorized future intake belongs in a private,
caller-owned copy; no customer-level pilot data goes into Git.

A readiness request has `version: 1`, `register: { path, sha256 }`, a `protocols`
array of complete retained protocol references, and `assessed_at` in exact UTC
seconds. The assessment time cannot be in the future. The register has these
exact collections:

| Collection | Fields per entry |
| --- | --- |
| `merchant_profiles` | `id`, `independence_ref`, `consent_ref` |
| `observations` | `id`, `merchant_id`, `cohort_id`, `case_id`, `source_kind`, `source_ref`, `source_sha256`, `adjudication_ref`, `adjudication_sha256`, `completed_at`, `followup_through` |
| `exposure_days` | `merchant_id`, `date`, `source_ref`, `sha256` |
| `approvals` | `merchant_id`, `kind` (`merchant` or `maintainer`), `scope_ref` (cohort ID), `source_ref`, `sha256`, `issued_at`, `expires_at` |
| `reviews` | `role` (`authority` or `regression`), `source_ref`, `sha256`, `candidate_commit` |

The source/adjudication fields and completion/follow-up fields in an observation
may be null to report missing evidence explicitly. Missing evidence produces
blockers; it never supplies a successful default. Other references are bounded
opaque tokens. A supplied evidence hash is a declaration, not an authenticated
receipt. No file or URL named by a reference is automatically fetched.

Readiness compares submitted observations to the retained cohort membership,
original source kind, receipt reference/hash, current adjudication reference/hash,
completion and follow-up. It rejects simulated substitutions, missing merchant or
source evidence, wrong candidate reviews, missing/cohort-mismatched approvals,
approvals issued after the observation, insufficient counts and exposure, future
exposure days, incomplete seven-day resolution follow-up and duplicate identities.
Dates are counted once per merchant. The longest consecutive declared pilot
calendar period and each merchant's exposure count are reported separately.
Repeated independence references cannot manufacture independent merchant evidence.

The existing benchmark supplies the **3 merchant / 100 in-scope live outcome /
30 consecutive day / 7 follow-up day** targets. Structurally matched declared
outcomes include adjudicated failures and required handoffs as well as resolutions;
they do not select only successes. Resolutions are reported separately and receive
the existing seven-day follow-up requirement. Pending, cancelled/unassessed,
censored, unavailable, withdrawn and synthetic members cannot be promoted into
that completed-live declaration count. All enrolled members remain in the scorer's
denominator. Quality and safety checks come from each existing scorer stratum.

Every readiness result remains `status: "blocked"`, `qualified: false`,
`pilot_authorized: false`, `verified_live_observations: 0` and
`live_pilot_started: false`. Independent authentication, pre-enrollment evidence,
formal prerequisites and actual qualification remain required even when all
supplied records are structurally complete. This tool has no signing, merchant
authentication, independent reviewer authentication, calendar-exposure observer
or release decision channel. It does not label a release beta/RC or grant an
exception to missing observations.

## Privacy, storage and failure limits

The files belong to the existing `caller_export_artifacts` privacy surface.
Minimized case identifiers, references, timestamps, consent metadata and receipts
**can still be personal data**. Use pseudonymous case/merchant references, store
the actual identity map and source evidence separately under suitable access, and
avoid names, contact details, message text, credentials and source attachments in
the artifact. Schema bounds are not a personal-data detector or legal review.

The directory is created with mode 0700; artifacts use mode 0600. Input paths must
be absolute and cannot contain symlink components, traversal segments or hard-linked
files. Reads reject nonregular files, unexpected membership and unsafe store modes.
Writes never overwrite files. A short exclusive local lock prevents concurrent
writers/readers from observing a partially appended batch; it does not schedule
agents or workers. Files and containing directories are fsynced after writes.
This POSIX implementation has not been qualified on Windows, network filesystems,
another machine or under power-loss fault injection.

| Limit | Bound |
| --- | --- |
| Request and frozen manifest | 1 MiB each |
| Cases in one cohort | 1,000 |
| Events in one append / immutable batch | 100 / 512 KiB |
| Batches / total events | 256 / 10,000 |
| Cohort artifact bytes | 16 MiB |
| Readiness protocol references | 10 |
| Rows in each real-register collection | 1,000 |

No automatic retry, overwrite, truncation or stale-lock removal occurs. A process
crash can leave a lock or partial artifact. Preserve that artifact and the prior
retained pins; a responsible operator must inspect and restore a known prior
checkpoint or reconstruct a new artifact from separately retained evidence. Do
not delete a lock blindly, silently accept a truncated history or relabel a
reconstruction as independently authenticated original evidence.

The tool does **not** automatically erase or expire these files when a commerce
customer is erased, withdraws consent, uninstalls or restores a backup. The caller
owns the approved retention schedule, export access, identity mapping, whole-artifact
removal, filesystem snapshots, copies and downstream reports. The existing proposal
suggests 30 days for raw pilot evidence after review closure and 90 days for minimized
aggregate/reference records, subject to an actual privacy/retention decision; those
durations are not an implemented timer or a universal retention entitlement.

Append-only history never requires unlawful retention. If valid erasure/withdrawal
duties make case-level retention impermissible, quarantine and remove the affected
artifact and its copies under that duty. Retain only the permissible minimized
aggregate/cohort decision needed to explain the evidence gap. This version cannot
partially redact a cohort while preserving its old byte pins. Do not quietly
delete difficult cases and call the smaller dataset the original cohort. Artifact
erasure, old backups and independent identity storage need an actual operator
process; neither SQL erasure nor a synthetic fixture proves those copies gone.

## Focused evidence and remaining work

[`tests/development/pilot-protocol.test.mts`](../tests/development/pilot-protocol.test.mts)
contains 20 native cases. The three G17 obligations use the retained independent
twelve-case hand calculation, preserve pending/failed/cancelled cases, and append
a reopen at the inclusive seven-day boundary plus a late cost adjustment.
The [adjustment calculation](../tests/fixtures/pilot-protocol/ADJUSTMENTS-HAND-CALCULATION.md)
is literal arithmetic, not generated expected output.

The four `M07-G18-PREP-*` cases test readiness rejection and reproducibility only.
They do not execute or claim `CASE-M07-G18-01`, actual external adjudication, a real
merchant enrollment, an elapsed live observation campaign or formal acceptance.
Native reports and independent reviews are supplied by the integration owner in
the batch evidence; source documentation does not preclaim their pass status.

No old benchmark, scope, threshold, scorer, fixture, test, commerce schema or
accepted-goal record is changed. Rollback removes the added tool/module/records
through normal Git review and preserves caller-owned artifacts plus their exact
implementation revision for reproducible inspection. New runtime-source pins and
the caller-export privacy handling require integration review before this local
preparation is recorded as integrated.
