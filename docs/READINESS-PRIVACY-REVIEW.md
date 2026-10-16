# Readiness and data-lifecycle review

## Authority and source

ADR-0020 was committed before implementation from `aff14cc` and authorizes this
five-goal diagnostic integration. The same assistant performed implementation and
maintainer review under the owner's delegated authority. No independent reviewer,
legal decision, live merchant, production approval or formal milestone acceptance
is fabricated. All original executable tests and registration entries are retained.

## Findings with actual failing reproductions

1. Queued local case-record work could be claimed after its readiness proof was
   revoked. The gateway checked it but the later outgoing-work path did not. The
   added `M02-G23-READINESS-RECHECKED-BEFORE-QUEUED-DISPATCH` assertion failed before
   the fix. Claim, send start and immediate dispatch now recheck readiness.
2. Refund list IDs matched but a detail amount could disagree with the order's
   summary. `M02-G26-REFUND-AMOUNT-SUMMARY-CONFLICT` failed. Signed minor-unit
   comparisons now require exact agreement before exposing facts.
3. JavaScript normalized an impossible calendar day into another day and a truthy
   invalid payment timestamp implied payment. Two tests failed. Source dates now
   round-trip exactly and recorded payment time must be valid and no later than
   the order's modification time.

4. Resuming a draft kept the cleared token input marked required, preventing the
   browser from submitting another preview despite a valid in-memory session.
   The rendered component test failed at that usability assertion. Resume now
   updates the form requirement without persisting the token.

The five red assertions and corrected green runs are retained outside Git. During
implementation an import-cycle correction was needed for the readiness hook; its
module-initialization failure is retained but is NOT behavioral-regression proof.
Two initial new-test setup mistakes (pre-existing fixture record count and equal
policy activation timestamps) were corrected without changing any retained tests.

## Privacy and recovery judgments

Inventory unknown tables/columns before operating, preserve minimized append-only
receipts, suppress known subject/resource reimport, separate retention holds and
external cleanup, revoke copied authority and start restoration quarantined. A
snapshot contains private data; no snapshot, private wrapping key or runtime token
is part of the distributed source. A current independent erasure checkpoint is a
required restore input, not derived trust from the backup being restored.

Pseudonymous audit IDs and hashes remain data. Logical deletion does not erase
storage pages, other backups, operator logs or provider copies. Unattributed text
is conservatively purged in the current store but cannot be universally classified
on future ingestion. This is neither a legal compliance certificate nor a complete
automated data-subject request solution.

## Evidence and permanent regressions

Native test reports, source/configuration identities, old controller/baseline pins,
registered additions, fault patches and clean archive-restoration runs are retained
in the separate evidence package. Each original CASE-M02-G23..G27 ID maps to an
executable assertion. Added review checks cover two merchant profiles sharing one
skill, restart-persistent erasure and the HTTP owner boundary. No disabled or
renamed old test is accepted as a new denominator.

The five executed fault trials removed readiness rejection, left private attachments,
restored copied valid sessions, mislabeled manual refunds as settled, and allowed
unknown draft authority fields. Each produced an actual behavioral assertion failure, not a syntax/import error.
The exact patches and native outcomes are retained in the final evidence package.

## Integration decision

After the complete applicable native suite, pinned previous-baseline comparison,
review fixes and fault trials pass, local nonrelease integration is authorized.
No old scope, benchmark, original goal contract, dependency input or executable test
may be weakened by this decision. Product qualification, live effects, external
publication and target stack work remain outside this integration.
