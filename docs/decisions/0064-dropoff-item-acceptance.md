# ADR-0064: Assign local item-level drop-off acceptance

## Prior authority and scope

The owner renewed the instruction to proceed toward the next milestones while
minimizing test execution. Under the existing delegated maintainer authority,
this records the prior bounded M20-G03 assignment from G02 closure
90e857dcc80794bdb43033a9a6e7c027d08861ea. Formal accepted M07/M08/M10 and G02
prerequisites remain absent. This is local synthetic preparation, not formal
goal/milestone acceptance, connected qualification or release authority.

Root is sole runtime writer/executor on goal/M20-dropoff-handoff in
Rifare-M20-handoff. The independent author owns only the three new test artifacts
in a separate worktree. Independent authority/privacy and regression reviewers
are read-only nonauthors. Freeze their assertions before runtime implementation.
No external provider, live send, payment, publication or production is assigned.

## Native ownership and allowed paths

InternationalHandoffs remains the custody owner. Add importDropoff and
readDropoff methods and an optional third constructor argument {dropoff: source}.
Store one typed dropoff_event row per original event in the existing
commerce_international_handoffs table. Preserve legacy plan/import/read and its
exact sent/received/whole-leg-rejection behavior. Reserve the new dropoff_event_
record ID prefix for this typed seam. No fabricated sent event or warehouse scan.

The new seam uses the exact original G02 credential context; it does not claim
international_handoff account/readiness equivalence with reverse_hub. The actual
partner handle must be the credential source's directory.partner. Historical
import does not refresh readiness, eligibility, customer proof or original owner.

Assigned new runtime paths are packages/adapters/dropoff-handoff-fixture-source.mts,
packages/commerce/dropoff-handoff-{values,records,privacy}.mts and
packages/commerce/dropoff-handoffs.mts, plus the versioned contract
packages/commerce/contracts/dropoff-handoffs.v1.json. Narrow existing hooks are
international-handoffs, partner-privacy, privacy-lifecycle, safe-recovery and
merchant-portability. ExecutionStops may add diagnostic.dropoff.handoff to the
existing stop-action list. Existing credential implementation, source and tests
remain unchanged. No core schema migration, new stock/consolidation ledger,
operation stream, worker grant, scheduler, endpoint or deployment credential.

The existing metadata files may add the assigned source/test/capability paths and
refresh affected hashes without removing prior objects or changing prior tests.
Documentation is this ADR, docs/DROPOFF-HANDOFFS.md, PLANS.md and the M20 record.
The fifteen privacy surface IDs and core schema remain unchanged.

## Public APIs

DropoffHandoffFixtureSource(credentials: DropoffCredentialFixtureSource) binds
the actual native private-branded G02 source, stable database, identities and
clock before any DDL. It adds only fixture_dropoff_handoff_events in the existing
separate provider database: event_id primary key, family_ref, sequence, canonical
body and digest, with unique family/sequence and immutable UPDATE/DELETE guards.
Its source identity is the digest of schema version, this contract,
credential_source_identity, original account, directory identity and tenant/store.
The wrapper is frozen and revalidates actual parent handles/identity on use.

The synthetic fixture administration API is:

- recordAcceptance({event_id,issue_operation_id,payload,items,units}). items is
  the complete original G02 item manifest. Each explicit unit is
  {line_id,ordinal,disposition,reason}. No caller time, sequence or account.
- recordCorrection({event_id,parent_event_id,units}). Correction units are
  {unit_ref,disposition,reason}; only units present in that exact current parent
  may be corrected. This is authenticated fixture administration of retained
  evidence, not a new physical scan or credential invocation.
- event(event_id) returns immutable secretless historical evidence or null.
- journal() returns bounded complete secretless history.
- mode('apply'|'timeout_after_effect') and lookupAvailable(boolean) inject only
  the assigned local response/lookup failures; these are fixture controls.
- assertAttached(core) verifies actual brands and physical database separation.

Native custody APIs are:

- new InternationalHandoffs(k, partner, {dropoff: source}). The old two-argument
  constructor remains valid. Fresh core owners must be constructed after reopen.
- importDropoff(scope,{issue_operation_id,event_id}). Caller supplies only
  original IDs, never quantities, customer, event body or alternate source.
- readDropoff(scope,issue_operation_id). This is a core-only historical read;
  it works with the old two-argument constructor without an attached G03 source.

Import resolves strict G02 records and requires an original issue in issued
state. G03 never implicitly reconciles an unknown issuance. The actual source
may already have its event; G02 must first reconcile its original operation.

## Unit accounting and event protocol

The complete G02 items array must hash exactly to the immutable issued command's
items_digest. Limit it to the existing twenty lines and at most one hundred
summed units, checked before expansion. A G02 credential above this G03 bound
remains valid for G02 but cannot use this local importer.

Stable unit_ref is contentDigest(['rifare-dropoff-unit-v1',family_ref,line_id,
ordinal]). family_ref already binds tenant/store/original request. Ordinals are
one-based and cannot exceed the original line quantity. Thus new credentials and
event IDs cannot reset physical unit identity. Unit arrays are nonempty, unique,
bounded and ordered canonically by unit_ref. Unmentioned units remain outstanding.

disposition is accepted or rejected. Accepted requires reason accepted. Rejected
reasons are wrong_item, damaged, unsupported or not_present; no free text. A new
acceptance may mention only previously unobserved units. A new event ID repeating
an observed unit fails without a second quantity. Exact same-ID/same-content
replay returns the original event. Changed content at that ID conflicts.

Source assigns a monotonically increasing sequence per family and observed_at
from its actual clock. All history is bounded to 1000 events; no truncation.
Acceptance verifies the original payload and current active credential inside
the source transaction, including original issue/credential/generation binding.
admitted_at equals observed_at and must be within original issue and expiry.
No caller-provided backdating. Payload and manifest are discarded after validation;
the source journal retains opaque unit references and necessary original digests.

The event envelope has schema_version, contract, event_id, kind, sequence,
tenant_id, store_id, source_identity, credential_source_identity,
source_account_id, directory_identity, family_ref, subject_ref, resource_id,
issue_operation_id, command_digest, credential_id, generation, items_digest,
method_digest, site_id, destination_id, method_id, credential_kind,
credential_expires_at, admitted_at, observed_at, parent_event_id, units,
qualification, physical_handoff_qualified, warehouse_effect, financial_effect,
and digest. kind is acceptance or correction; qualification is synthetic_only;
all three effect/qualification booleans are false. digest hashes all other fields.
contract is rifare-dropoff-handoff-fixture-v1. No payload, proof/session hash,
customer ID, raw item manifest, fee or arbitrary extension is retained in source.

Every event validates against the original immutable issued command and result.
A family's source/account/items/site/destination/method remain consistent across
credential generations. Each event retains its own exact method digest and issue
generation. New eligibility/configuration changes cannot rewrite historical facts.

## Corrections, delayed evidence and projection

A correction copies its parent's credential/family/source/site bindings, inherits
its admitted_at and receives a new actual observed_at and sequence. It may be
recorded after credential expiry/revocation, since it corrects historical evidence
and cannot add a previously unobserved unit. Every affected unit must still have
that parent as its current observation. Orphan, stale, branching, foreign or empty
corrections fail atomically. Original source/core events stay immutable.

Core import accepts a genuine pre-expiry event after expiry, revocation or loss
of the delivery key. It relies on immutable source admission, not current payload
usability. No provider effect, new scan or source mutation occurs during import.
Source response loss after recording leaves the original event available; retry
uses that same ID. Core rollback leaves source evidence intact; retry uses the
same original event. A missing/unavailable lookup creates no core acceptance.

Import requires the complete prior sequence and current correction parents.
Missing prefix/parent fails without writes until those events are imported.
No background fetch, timer or estimated interval advances anything. Exact duplicate
import returns the original projection without appending another record.

Projection derives effective state from explicit unit observations. It returns
per-line expected, accepted, rejected, disputed and outstanding counts; total
counts; current per-unit state, site and original/current event references; and
the bounded original event history. outstanding = expected - accepted, including
rejected and disputed units. A previously accepted unit later rejected becomes
disputed, preserving its last accepted site and uncertain custody; this does not
claim goods returned to the customer. A later linked accepted correction resolves
the dispute without adding another unit. Never-observed units are outstanding.

The projection explicitly reports stage dropoff_acceptance, qualification
synthetic_only, physical_handoff_qualified=false, warehouse_received=false,
inspection_complete=false, stock_effects=0 and financial_effect=false. These are
the stages established by this importer; downstream native state is unchanged.
No warehouse receipt, inspection, disposition, fee, refund or settlement is inferred.

## Core records, authority and atomicity

Native row ID is dropoff_event_ + contentDigest([source_identity,event_id]).slice(0,40).
Typed body retains kind dropoff_event, schema version, native scope/resource/subject,
original issue and quote digests, the exact source event, original expected unit
references, personal mapping, imported actor/time and authority/minimization flags.
Personal mapping contains only original request/case/native-return/item bindings;
no customer proof, credential payload or original operator session is copied.

Core-only validation checks shape, canonical hashes, row IDs/scope/state, original
G02 issued command/quote/result, event binding, expected units, complete family
sequence and correction graph. Personal mappings must agree with original terms;
each core event unit must belong to the original expected set. Original native
return/request/case mapping is checked before fresh import. Bad typed kinds or
reserved IDs fail closed rather than falling into the legacy custody projection.

Only actual owner/operator/reviewer humans may call new APIs, with current
operation.read and resource permission; import also requires operation.reconcile
and the current canonical return/resource/subject relationship. Customers, agents,
workers and fabricated scopes are denied before any original-proof renewal.
The native transaction encloses authentication and all writes. Import additionally
checks assertReturnWritable and diagnostic.dropoff.handoff execution/recovery
controls. Recheck current authority, source event identity, original mapping and
control stamp immediately before insert. Any failure rolls back the entire import.

New import is denied after G02 authority retirement, erasure, held erasure,
uninstall or restore/quarantine. It cannot repopulate minimized terms. Historical
read after retirement requires actual human privacy.manage plus original-resource
operation.read permission and reports revoked/minimized status. It uses no source,
key, current customer session or eligibility. No fresh ingestion in retained mode.

## Privacy and recovery

Use native partner subject export, including historical subject hashes and
original/current case-linked resources. Export has no payload/session material or
effect authority. Preserve secretless event/correction/unit references and exact
quantities on minimization, while removing personal request/case/native-line copies.
Opaque expected unit references permit a retained aggregate projection.

Explicit hooks must cover ordinary and repeated erasure, retained resource
markers after ownership redaction, current linked-case resource suppression,
held erasure, uninstall, file restore and first/repeated merchant import.
Holds retain evidence but do not preserve ingress authority after erasure.
Current suppression overrides copied holds. Source admission records contain no
additional direct customer/payload fields and remain original synthetic evidence;
local minimization does not claim deletion of source media or delivered copies.

Validate the original and destination graphs independently before suppression or
mutation. Copied records become read-only; minimize personal mappings unless an
actual current hold retains them, with current suppression taking precedence.
Restore calls no provider and creates no acceptance, receipt, stock or money event.
If a canonical historical personal copy is replayed beside already-minimized G02
records, only an actual suppression path may normalize it after full virtual graph
validation. Ordinary active validation is never weakened to permit that repair.

## Independent specification and focused evidence

The author owns tests/development/dropoff-handoffs.test.mts,
tests/development/dropoff-handoffs-helpers.mts and
tests/fixtures/dropoff-handoffs/independent-values.json. Reuse existing G02 helpers
unchanged. Their two original lines contain THREE units: alpha/shirt quantity two,
beta/hat quantity one. CASE01 accepts both alpha units, leaving beta outstanding.
CASE03 accepts one alpha unit, requiring literal accepted=1/outstanding=2.

Freeze exactly twelve IDs CASE-M20-G03-01 through -12, covering partial acceptance,
duplicates/wrong return, the targeted oracle, rejected/malformed units, linked
corrections/order, actual source identity/integrity, historical validity/generation,
human authority/secrets, transactional rollback/final recheck, reopen/unknown G02,
export/holds/erasure and file restore/first/repeated merchant import.

The planned whole-file batch is twelve new cases, fourteen unchanged credential
cases and twenty-two unchanged partner-service cases: 48 across three files,
within the unchanged 60-case/four-file/60-second default. Use
NODE_OPTIONS=--test-isolation=none. Repeat only for a concrete failure or material
candidate correction. No full suite, new browser run or unrelated warehouse sweep.

After the candidate passes, one isolated exact-parent fault changes the importer's
materialization to copy every expected unit as accepted for its first one-unit
acceptance, recomputing the altered local event digest before native storage.
The independent source still reports one actual unit. The unchanged CASE03 must
observe three native accepted units where one is required, plus wrong outstanding
quantity. The fault must reach native storage/projection, not fail at syntax or
fixture setup. Keep tests/oracles unchanged, record actual hashes, retain its branch
outside product ancestry and never merge it. No repeated fault campaign.

Independent authority/privacy and regression review, exact evidence, preserved
inventories and a complete recoverable checkpoint close this local assignment.
G04 consolidation/custody continuity and G05 shopper experience remain separate.
