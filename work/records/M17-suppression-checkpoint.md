# M17 individual-image suppression — verified diagnostic checkpoint

## Outcome and authority

The bounded ADR-0052 continuation is implemented and locally verified. An image
erased individually or by retention remains suppressed when an older native
backup or merchant transfer is replayed with an independently retained current
checkpoint. Absent-source deletion records survive later exports and smaller
repeat checkpoints. Both independent reviewers approved the exact tested
candidate with no corrective findings in round 1.

This follows the owner's 2026-10-19 instruction, "Continue developing towards
milestone", under standing delegation. Root assigned the work before runtime
changes and remained the sole product executor. The independent test author
owned a separate branch; the authority/security and regression reviewers were
nonauthors and performed no product execution.

This closes the local portable individual-image suppression gap in M17-G03.
Formal M13/M14/M17 acceptance is still blocked. The acceptance ledger, original
goal packets and qualification claims have not been advanced. M18 remains
unassigned because its M15 remote authority prerequisite is absent from the
recovered source. This record does not substitute loopback authority for that
missing implementation.

## Exact source and tests-first order

| Role | Commit |
| --- | --- |
| Previous saved M17 checkpoint | 26587c94925a1693060236824b74f128f8eac644 |
| Prior bounded assignment | 45a0ca6a30bfdc3e94343e4003595e227ecb41c5 |
| Independent initial test author | ab99860499873b834f2315c1312504c45a2dca04 |
| Integrated tests-first behavioral red | 3bf4fec029a1873ee1847c3be2e398365a42d916 |
| Independent fixture correction | 80cfc1aa46ea4065df047b3d559115b0070d5a39 |
| Executed and independently reviewed product | 949e0c14787febee9ced799b526daaa3ee57eed7 |

The reviewed product tree is b981203db6c73e000c936829a3e6abcb0ab754bb.
Its clean source snapshot contains 1,797 tracked files; all report hashes match
that candidate. This record and associated milestone documentation are a
subsequent documentation-only closure. The package manifest supplies the final
checkpoint commit and tree and the comparison against the reviewed product.

Root worktree: recovery/M17-suppression. Test author branch:
recovery/M17-suppression-tests. The preceding recovery/M17-images branch stays
at 26587c9. Recovered main stays at
a33c4ad57d13223c05ca985e5728404b671ab21a, tree
2cbdf523001ebebb97897bcf71d425a6e1fcb6f6.

## Implemented behavior

Media-free checkpoints preserve exact v1 shape. Image-bearing state uses v2
with a minimized exact image identity and no media bytes, notes, scanner text,
customer/session data or invented erasure timestamp. Canonical erased rows must
already have null bytes, an empty note and null scanner.

The existing support-document table retains image_suppression controls whose
source is absent. Strict metadata/body/digest/identity/time checks apply to both
recorded and revoked states. Incoming duplicate identities are rejected;
conflicting source tuples refuse before subject replay; the merged union is
bounded and monotonic. Original merchant-package deletion records are validated
and retained on repeat import without recreating original content or authority.

Current subject and exact individual-image suppression precede held-image
invalidation inside the existing transaction. Already-authorized source deletion
supersedes obsolete copied holds for selected images. A different held image
receipt still refuses the entire restore/import. Existing quarantine, revoked
configuration and credentials, unknown operation identities and replay
prevention remain in force. No new table, migration, adapter, grant, HTTP route,
decoder, dependency or business operation is introduced.

See docs/IMAGE-SUPPRESSION.md and the versioned image-suppression contract for
the precise format, limits and trusted-checkpoint responsibilities.

## Actual behavioral evidence

The first run executed all 12 new native cases on the old runtime. All failed.
The primary individual-erasure assertion observed a restored 69-byte PNG where
null bytes were required. Merchant repeat case 04 observed the same real gap.
This is valid behavioral red, not a missing-import or filename-only wrapper.

That attempt also exposed PROFILE_STALE in the unrelated-text setup of case 11.
It is retained as a setup failure and is not counted as feature proof. The test
author corrected current case/task profile pins and added positive assertions
for an actual text fixture dispatch before runtime implementation. No original
test or feature assertion was weakened. The aggregate runner credited zero
passing cases from the failed file; the retained JUnit/TAP proves 12 actual
native executions. These distinct counts are intentional.

The final assigned selection passed on clean candidate 949e0c1:

| Whole native file | Cases passed | Elapsed |
| --- | ---: | ---: |
| Image suppression | 12 | 8.696 seconds |
| Existing return evidence | 20 | 4.941 seconds |
| Existing safe recovery | 14 | 3.275 seconds |
| Existing merchant portability | 14 | 4.228 seconds |
| Total | 60 | 21.240 seconds |

Zero failures, errors, skips, cancellations or todos; every process completed
without timeout. The unchanged budget was 60 cases, four whole files and one
60-second deadline. Root used Node v24.19.0 with native child-process IPC, and
the existing tools/dev_tests.py runner. No provider or browser campaign ran.

Retained evidence paths, included in the recovery package:

- evidence/M17-suppression/attempt-01-red/: original logs, native XML, source
  report and explicit red/setup assessment.
- evidence/M17-suppression/attempt-02/: complete passing logs, four native XML
  reports, selected native membership, commands and exact source hashes.
- evidence/M17-suppression/verification-round-1.json: source membership,
  baseline preservation, native membership and pin verification.
- evidence/M17-suppression/reviews/: both real independent round-1 reviews.
- evidence/M17-suppression/closing-source-comparison.json: documentation-only
  closure comparison, produced after the final source commit.

The existing 20 image-service and nine privacy-coverage cases were explicitly
deferred by ADR-0052. The new 12 cover the changed hold/restore, late-result,
scope and authority interactions; the independent regression reviewer found
no concrete reason to widen this development selection. Broad/full regression
and formal acceptance were not performed or inferred.

## Independent review and preserved baseline

/root/m17_suppression_scope approved the exact candidate for bounded local
diagnostic M17-G03 recovery. It independently inspected source, Git, all native
XML/TAP results, all 1,797 source hashes and the actual behavioral red. Its
review confirms strict minimized identities, monotonic absent-source replay,
downgrade refusal, copied-hold ordering, exact selection and existing authority.

/root/next_milestone_scope independently approved the same candidate, verified
the native case membership and source hashes, and compared the protected
baseline. It found no corrective regression issue and required completion of
this actual-state record before checkpoint delivery. Neither reviewer authored
product or test code or ran product tests. No review exception was used.

All 3,078 previous registered test objects, 208 capability objects, 512 protected
paths, 1,791 source members and 38 adapter objects are retained. All old native
tests/helpers, expected-coverage fixtures, migrations, canonical goal/milestone
objects and the acceptance ledger remain unchanged. New totals are 3,090 test
registrations, 209 capabilities, 515 protected paths, 1,797 source members,
302 runtime pins and 602 oracle pins. All hashes match. The 262-table schema
and the fifteen existing privacy-surface identities are preserved.

## Remaining milestone and recovery boundaries

Logical suppression on replay does not destroy older backup files, database free
pages, caller copies or provider copies. A digest does not authenticate a source
operator or prove the latest checkpoint was supplied. Trusted current delivery,
source quiescence and independent retention of deletion knowledge remain caller
or deployment obligations.

Formal qualification still needs real authorized image-cohort membership and
independent labels, actual model evaluation, connected retention/deletion
evidence, target-host processing/isolation and the outstanding M13/M14 gates.
Missing later M15/M16/M23 implementation history must be restored and reconciled
before integrating these recovered branches. No live image execution, audio,
video, external effect, release or main-branch advancement is claimed.

The recovery package carries native incremental M17 history relative to the
already saved Rifare-M23-M25-worker-roadmap.zip base, including the earlier M17
diagnostic work and this continuation. It includes exact changed source, every
retained M17 attempt and real review records. It contains no merchant database,
real customer media, live credentials, runtime environment or complete M16
archive. Restore the exact saved base first, import the incremental bundle with
native Git and preserve newer or unrelated history. A future integrated
candidate needs its own applicable validation and review.
