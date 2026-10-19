# Verified shopper memory

M18-G01's local foundation lets a currently verified customer explicitly save
bounded preferences for an existing support case. The same customer can view,
correct or forget them through another verified channel link for that case.
The contract is [shopper-memory.v1.json](../packages/commerce/contracts/shopper-memory.v1.json),
assigned before implementation in [ADR-0053](decisions/0053-m18-verified-shopper-memory.md).
This is local preparation; formal M18 acceptance and connected-channel,
remote-client and target-host qualification remain open.

## Customer workflow

Use `new ShopperMemory(kernel)` directly or the existing `SupportService.post`
dispatcher. `memory-record` and `memory-forget` use the authenticated customer
scope. `memory-context` accepts exactly `{customer_token, context}`; the server
authenticates that proof and retains neither the token nor its session hash.
There is no new HTTP route or model dependency.

For `record`, supply an existing `case_id` and verified `link_id`, the current
support `expected_generation`, the latest memory `expected_version` (zero if
missing), a new `request_id`, purpose `support_journey`, preferences, and an
integer `expires_at` after the current time and no more than 30 days ahead.
Preferences replace the previous object completely. At least one of these two
fields is required:

| Field | Allowed values |
| --- | --- |
| `fit_preference` | `close`, `regular`, `relaxed` |
| `response_style` | `concise`, `detailed` |

`forget` uses the same identity, version and request fields without preferences
or expiry. Forgetting appends an empty revoked version. A later fresh customer
statement can create a new version. Reusing any prior request ID for that memory
is rejected even when the caller supplies the latest version.

`context(scope, customerProof, input)` accepts only the case, link, generation
and purpose. A human or built-in agent reader must own the current support
generation and supply a current verified customer proof. Customers can read
their own case with that generation. Existing worker grants remain unchanged.
Unknown keys, accessor properties, arbitrary preference text, transcripts,
inferred preferences and other purposes fail before a write.

## Provenance and freshness

Every ordinary access rechecks the case, current order ownership and current
customer contact proof. A source contact change invalidates the old proof. A
newly verified proof can inspect the resulting `source_changed` status, but
another explicit customer statement is needed to supply a usable preference.
Changes to the original source payload, source revision or original verified
link revision also invalidate the saved value. Changing channel views does not
merge unrelated orders or identify shoppers by similar names.

An available response contains only finite preferences and explicit provenance:
the scoped request hash, original statement link and revision, server observation
time and stored source digest. The statement represents an authenticated local
customer request; it is not evidence that an external provider observed or
delivered a message.

The selected channel's history is reported as `complete`, `partial` or
`unavailable`, with its current source revision and
`missing_history_is_explicit:true`. The context digest binds the current view
and ownership generation. It is not an action approval. Every response declares
`model_thread_required:false`, `execution_authorized:false` and
`production_qualified:false`.

| Context status | Meaning |
| --- | --- |
| `available` | The latest value has a current source, valid expiry and active state. |
| `missing` | No memory version exists for this exact case and subject. |
| `expired` | The latest statement reached its expiry. |
| `source_changed` | The current verified source or original link revision differs. |
| `forgotten` | The customer explicitly forgot the latest memory. |
| `restored` | A recovered personal value was scrubbed before exposing the restored database. |
| `unavailable` | The latest record is otherwise revoked or suppressed. |

Every status other than `available` returns empty preferences and null provenance.
There is no fallback to an older version. A retained preference digest is not
included in the context digest when a held personal value is unavailable.

## Retention, export and erasure

The existing `commerce_support_documents` table stores kind `shopper_memory`.
Its deterministic identity binds tenant, store, case, resource, scoped subject
hash and purpose. All versions are checked for exact shapes, metadata, normalized
digests, monotonic versions and unique scoped request hashes before cleanup or
append. Documents are limited to 32 KiB and scans to 10,000 memory records;
exceeding a bound fails without a partial update.

Correction retires all earlier personal versions. Expiry or a changed source
retires the latest value. Without a hold, retirement replaces personal values
and source references with a minimized revoked record; it also removes the old
preference digest. Whole-subject erasure marks every version `subject_erased`.
Request hashes remain solely to prevent replay of an earlier statement.

An active hold retains personal bytes in revoked historical versions while
keeping them unavailable to ordinary context. A current explicitly corrected
value may remain active. `retained_under_hold` makes retained personal content
explicit. After hold release, the next authorized access or mutation cleans
retired values. Uninstall invalidates memory, retains held content and uses the
existing store disconnection flow.

Privacy export adds a subject-filtered `shopper_memory_records` allowlist.
Retained data remains attributable to the original subject even if its source
has disappeared or its order now belongs to someone else. Export and erasure
therefore also work when that subject owns zero current resources. Export does
not authorize use of a stale preference as live context. Held historical values
have explicit revoked and retained states. Released historical values can be
scrubbed during export without looking up their former sources.

Erasure selects memory by exact tenant/store/subject hash and does not follow a
reassigned order into its new owner's memory or case data. The existing privacy
lifecycle still conservatively clears unbound store text and caches. These are
logical data controls; physical, forensic and previously exported external-copy
erasure are not qualified.

## Recovery and merchant transfer

Native restore and merchant import validate memory before applying subject
suppression, so malformed records cannot be concealed by later cleanup. Repeat
import validates both the original package and current destination independently.

All restored personal preferences are scrubbed and revoked, including values
reintroduced before a repeat import. Current subject suppression is applied
first, even for a subject with no resource entries. It supersedes an obsolete
copied hold. Any remaining held personal memory refuses the restore or import
atomically, preserving the source and leaving no partial destination.

This conservative boundary prevents an older backup from reviving an individually
forgotten preference without adding a new suppression checkpoint format. A fresh
verified customer statement is required before any future usable memory. Existing
recovery quarantine, blocked customer verification egress, revoked authorities,
and original operation and receipt identities remain in force; this feature does
not enable live recovery activation.

## Development evidence and remaining goals

The independent 25-case source is
`tests/development/shopper-memory.test.mts`. It covers exact scope and current
authority, source changes, all-version lifecycle, privacy export, historical
ownership, held data, restore/import atomicity and manual/agent ownership
handover. The assigned coherent regression selection adds the seven existing
conversation cases, 14 native recovery cases and 14 merchant portability cases.
Actual execution and reviews are recorded in
[M18-memory-checkpoint.md](../work/records/M18-memory-checkpoint.md).

M18-G02 readiness, G03 composed intents, G04 follow-ups, G05 independent remote
callers and G99 formal acceptance remain later work. Formal dependencies and
missing later M15/M16/M23 source history must be reconciled before integration
into the protected recovered main branch.
