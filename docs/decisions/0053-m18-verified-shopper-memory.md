# ADR-0053: M18 verified shopper memory and lifecycle

## Prior owner authority and bounded assignment

On 2026-10-19 the owner instructed, "Proceed working on goals for the next
milestone." Standing delegation authorizes the maintainer to choose and integrate
bounded local development. The next milestone is M18, Persistent commerce
journeys. Its local-preparation clause permits this assignment without accepting
the missing M15 remote-client implementation or any formal dependency gate.
This supersedes ADR-0052's decision to leave M18 unassigned for that earlier turn;
it does not change the original milestone, goal packets or acceptance ledger.

Root assigns a complete local M18-G01 memory increment before implementation.
Readiness (G02), composed business intents (G03), follow-ups (G04), independent
remote callers (G05) and formal M18-G99 remain later work. Memory's privacy and
recovery behavior belongs in this increment because a persistent preference
without those controls is not a useful completed foundation for later goals.

Base is the saved, clean M17 checkpoint
`1534f5e163aeab9f3c252a8ff88b7a819913a991`, tree
`2f2eb35524c4c7da9a138735478e9ee6f0af6190`. Root owns
`recovery/M18-memory` in `Rifare-M18-memory`. Preserve every prior worktree/ref,
including recovered main `a33c4ad57d13223c05ca985e5728404b671ab21a`.
The later missing M15/M16/M23 source history is not reconstructed by this work.

Independent read-only scope assessments by /root/m18_authority_scope and
/root/m18_regression_scope support local preparation. Those agents remain
nonauthors for final security and regression review. Root is the sole product
executor; at most three corrective review rounds apply.

## Outcome and reuse

A currently verified customer can explicitly save two bounded preferences for
one existing case and the fixed purpose `support_journey`, then retrieve them
through another exact verified link for that same case/customer/resource.
Correction, expiry, forgetting, current source changes, subject erasure and
old-backup replay must never expose an older value as current memory.

Reuse `SupportConversations`, `supportCase`, current `SupportOwnership`,
`growthCustomerProof`, and versioned `commerce_support_documents`. This adds no
case, consent, financial, operation or identity ledger, migration or table. It
does not aggregate other orders, infer identity from names/handles, persist a
transcript, confer policy/payment authority or depend on a model provider.
An explicit memory request is its own authenticated source statement. A channel
link identifies the verified context; it does not assert a connected provider
observed or delivered the request.

## Public contract fixed before implementation

`ShopperMemory` has the following local API, also exposed through the existing
`SupportService.post` dispatcher without adding an HTTP route:

- `record(customerScope, input)` accepts exactly `case_id`, `link_id`,
  `expected_generation`, `expected_version`, `request_id`, `purpose`,
  `preferences`, and `expires_at`.
- `forget(customerScope, input)` accepts the same identity/version fields,
  `request_id` and `purpose`, without `preferences` or `expires_at`.
- `context(scope, customerProof, input)` accepts exactly `case_id`, `link_id`,
  `expected_generation`, and `purpose`. A current verified customer proof is
  required even when the current human or built-in agent owner reads context.
- Dispatcher actions are `memory-record`, `memory-forget`, and `memory-context`.
  The context dispatcher accepts exactly `customer_token` and `context`; the
  token is authenticated and is never retained in a memory record or response.

Only purpose `support_journey` is implemented. Preferences are a complete
replacement object with one or both keys: `fit_preference` in
`close`, `regular`, `relaxed`; `response_style` in `concise`, `detailed`.
Unknown keys, empty values, arbitrary text, inference declarations, transcript
fields and marketing purposes fail. Expiry is a safe integer after the current
clock and at most 30 days ahead. IDs and versions use existing validators.

Writes require the customer role and existing `support.customer_message`
authorization. Every access checks the exact current case, tenant, store,
resource, customer proof and verified link. `growthCustomerProof` rechecks the
original verification against the current order/customer source ownership and
contact revision. A staff/agent read additionally requires the current support
owner; all reads/writes bind the supplied current ownership generation. Existing
work-grant action lists remain unchanged and cannot acquire `support.read`.

The context response is an allowlist: `schema_version`, `case_id`, `resource_id`,
`purpose`, `version`, `context_digest`, `status`, `preferences`, `provenance`,
`history`, `ownership_generation`, `retained_under_hold`,
`model_thread_required:false`, `execution_authorized:false`, and
`production_qualified:false`. Status is `available`, `missing`, `expired`,
`source_changed`, `forgotten`, `restored` or `unavailable`. An unavailable status
has empty preferences and null provenance, never a fallback to an earlier row.
History exposes the selected link's current `status` and `source_revision` plus
`missing_history_is_explicit:true`. It does not assert missing history had no
messages. No provider thread ID is required or stored.

Available provenance is exactly `kind:'explicit'`,
`source:'verified_customer_request'`, `reference` (a scoped request hash),
`link_id`, `source_revision`, server `observed_at`, and `source_digest`.
The digest covers the stored preference and its source binding. A context digest
also binds the selected current link/history and ownership generation; it grants
no action permission and changes when its memory or current context changes.

## Storage, correction and freshness

Use support-document kind `shopper_memory`, one deterministic ID for exact
tenant/store/case/resource/subject/purpose and monotonic document versions.
Author is the fixed identifier `verified_customer`; reviewer and review digest
are null. The existing 32 KiB document normalization limit applies. All retained
records must have valid normalized bodies, matching digests, exact metadata and
canonical case/resource/subject identity. Bound scans to 10,000 records and fail
without truncation or partial writes if the limit is exceeded.

An active body has exactly `schema_version:1`, `case_id`, `resource_id`,
`subject_ref`, `purpose`, `request_hash`, `status:'current'`, `preferences`,
`source`, and `expires_at`. Source has exactly `kind:'verified_customer_request'`,
`link_id`, `link_revision`, `customer_resource_id`, `customer_source_version`,
`customer_source_digest`, `order_source_version`, `order_source_digest`, and
`observed_at`. Digests bind normalized current source payloads; source versions,
source ownership, source-link identity/revision and current customer proof must
still match before any value is returned. Timestamps come from the server clock.

Correction requires the latest expected version and a new scoped request hash.
Any request already present in retained versions is rejected, including an old
request resubmitted with the latest version. A new, explicit customer request
may supply preferences again after forgetting. Operators, workers and models
cannot manufacture such a customer request by referencing old text.

When no hold applies, retirement removes preferences and source links from every
affected historical version. Retained redacted bodies contain only
`schema_version`, `case_id`, `resource_id`, `subject_ref`, `purpose`,
`request_hash`, `status:'redacted'`, fixed `reason`, `preferences:{}`,
`source:null`, and `expires_at:null`; row state is revoked and expiry is null.
Do not retain old preference digests as a new low-entropy personal-data copy.
Request hashes preserve replay refusal without retaining the original request ID.
Fixed reasons are `corrected`, `forgotten`, `expired`, `source_changed`,
`subject_erased`, `restored`, and `uninstalled`.

Forgetting appends a revoked, redacted latest version. Expiry/source change
retires the latest value without restoring older versions. An active legal hold
retains personal bytes in revoked historical rows but suppresses them from
ordinary context after correction/forgetting/expiry. Return truthful
`retained_under_hold`; after release, the next current-context access or explicit
forget/correction cleans retired values. No claim of physical/forensic erasure
or removal of previously exported external copies is made.

## Privacy, recovery and portability

Add a subject-filtered, allowlisted `shopper_memory_records` export. Export no
session/token hashes, original request IDs, transcripts or other subjects' data.
Explicitly select this subject's canonical case/resource/subject identities and
validate retained record integrity. Historical personal values appear only when
actually retained under a hold, with their revoked/held state made explicit.

Subject erasure scrubs every version through the existing lifecycle transaction
after its hold decision. Uninstall invalidates memory and preserves held content.
The original subject suppression checkpoint is sufficient for subject deletion;
no checkpoint format expansion is assigned for preferences.

Individual correction/deletion uses a conservative portability boundary: every
restored/imported memory value is scrubbed and revoked, including repeated import
of the same package. Restored preferences require a new current customer request;
an old snapshot cannot silently restore a forgotten value. A remaining held
personal memory refuses restore/import atomically instead of discarding held
content. Replay current subject suppression before that held-content check so an
already-authorized source erasure supersedes an obsolete copied hold. Retain
quarantine, all revoked authorities and all original operation/receipt IDs.

## Assigned ownership and protected baseline

Root may add `packages/commerce/shopper-memory.mts`,
`packages/commerce/shopper-memory-records.mts`,
`packages/commerce/shopper-memory-privacy.mts`,
`packages/commerce/contracts/shopper-memory.v1.json`,
`docs/SHOPPER-MEMORY.md`, this ADR and the M18 memory work record. Root may modify
only the necessary wiring in `support-service.mts`, `privacy-lifecycle.mts`,
`safe-recovery.mts`, and `merchant-portability.mts`. Root may update PLANS.md with
actual progress and extend the existing registry, component inventory, privacy
storage contract, catalog oracle pins and licensing source-count metadata.
Existing runtime/oracle pins for those assigned paths may be refreshed to actual
bytes; no adapter object's prior contract or assertion is changed.

The independent /root/m18_memory_tests author owns only the new
`tests/development/shopper-memory.test.mts` and, if useful, its new
`shopper-memory-helpers.mts`, in `recovery/M18-memory-tests`. It writes and commits
25 native cases before runtime implementation; no old test/helper/runtime edits,
product execution, builds, probes or providers. Root integrates its commit before
implementing. Both final reviewers remain independent nonauthors.

Preserve all 3,090 existing test objects, 209 capabilities, 515 protected paths,
1,797 tracked source members, 302 runtime pins, 602 catalog oracle pins,
38 adapter objects, 262 tables, old migrations, fixtures, goal objects,
qualification denominators and acceptance entries. Do not modify authorization,
work leases, ActionMcp, financial/action handlers, old tests, native runners,
catalog assertions or dependencies.

## Verification and checkpoint

The focused coherent selection is new memory 25 + retained conversations 7 +
safe recovery 14 + merchant portability 14 = 60 native cases, four whole files,
one 60-second invocation deadline. New cases themselves cover subject export,
all-version erasure, holds, uninstall, source staleness, tamper rejection,
cross-channel correction, old request refusal and current ownership. Older
privacy-lifecycle and M17 image files are deferred; the unchanged recovery and
portability files retain the baseline path while new cases exercise memory hooks.
Keep every actual attempt, and rerun only to resolve concrete failures or review
findings. No full regression or provider campaign is assigned.

Missing-module failures are not behavioral red evidence. Because this is a new
API, use a separately committed targeted fault on an isolated branch after the
first implementation: remove the current customer source-proof check (or the
source correction invalidation) and show the independent native case detects
the forbidden old preference. Never integrate that faulty branch.

Bind native results and two independent reviews to one exact clean candidate.
Record bounded local development completion only after actual verification.
Save a verified cumulative recovery update with concise source/review records and
real evidence. Formal M18, G02-G05, remote-client interoperability, connected
channels, target-host qualification and missing prior source history remain open.
No push, release, deployment, paid/production effect, external message or retry of
the previously rejected complete M16 archive is part of this assignment.
