# Item return intake: delegated maintainer review

ADR-0021 and commit `5f9631d` precede implementation. The owner delegated review,
decisions and local merges; the same assistant performed this review. No separate
reviewer identity, live merchant or formal prerequisite acceptance is invented.
M02-G99 remains a blocked qualification assessment, not an excuse to lose prior work.

## Findings and implemented corrections

1. The mobile component displayed two decimals for yen. A rendered assertion failed;
   formatting now uses the validated source currency exponent and integer strings.
2. A delayed quote could repaint after item selection changed. The failing rendered
   scenario now passes using an independent intent revision in addition to session
   generation. Previous quote data cannot authorize the revised selection.
3. A native send could use source facts changed after local approval. Sending now
   compares exact original source version/digest, with no call on mismatch.
4. Read-only reconciliation required the original customer proof to remain active.
   A reopened operator session now reconciles through current read authority and
   retained approved intent; expired proof never authorizes a new send.
5. Requesting more evidence did not invalidate an old approved preview. Evidence
   review has a monotonic revision included in quotes. It gates local execution and
   native submission. Resolving review requires fresh evidence and re-quotation;
   revising retains one request ID and revokes the prior approval.
6. PNG validation ignored unused bytes after the zlib stream inside an otherwise
   valid IDAT chunk. A CRC-correct negative fixture reached a missing-exception
   assertion. Validation now requires complete compressed-stream consumption.

7. The final retention audit found that direct evidence deletion and expiry purge
   could bypass existing customer retention holds. A new, separate regression file
   exposed three failures. Both paths now respect current holds; bounded purge
   exposes a cursor so held items cannot block later pages. Release/expiry and
   ownership checks remain server-enforced. This review fix is integrated after
   the initial candidate and all final evidence is refreshed.

These corrections have actual failing-before/passing-after assertions retained
outside Git. Other initial failures due to test setup/import paths are not counted
as feature evidence. No previous test file was edited to make implementation pass.

## Threat and scope review

Uploads remain quarantined without a qualified scanner. Known allowed test hashes
are synthetic fixtures, not evidence of malware detection. Scanner deadlines are
bounded; in-process code is still trusted. Signed content is current-session/case
scoped and is never rendered as active HTML or forwarded to a model. Retention
expiry denies reads immediately; authorized bounded cleanup removes stored BLOBs.

Approval remains exact-preview and separate-actor. Overrides cannot waive stock,
identity, exclusion or financial authority. Quoted fees remain estimates, not
settlement. Native adapter mode is fixture-only and disabled by default. An unknown
source response is reconciled, never blindly recreated. Restored databases retain
existing execution quarantine. A hash chain or SQLite lock is not an OS sandbox.

## Evidence and integration policy

The external evidence package binds source commits, retained baseline/controller,
native outputs, review reproductions, five deliberately faulty worktrees, the demo
and clean restores. The five new groups keep the original CASE IDs and add exact
permanent registrations. Old registrations, test bytes, dependencies, branch heads,
benchmark thresholds and original goal contracts must remain unchanged.

The source-file-count fixture may increase only for enumerated additions under
ADR-0008; its other expectations do not change. New source and storage inventories
include the migration, not a silent bypass of privacy checks. Review of additions
permits refreshing the diagnostic regression baseline, not a product release.

Local integration is permitted when the accumulated suite and preservation checks
pass. Formal goal/milestone qualification remains open for the PostgreSQL/React,
direct-browser and connected development-store requirements. Next is M03-G06;
no refund execution or subsequent milestone is implemented in this batch.
