# M17 image-assistance recovery checkpoint

Date: 2026-10-19. Authority: [ADR-0051](../../docs/decisions/0051-m17-recovery-image-assistance.md).

**The M17 local diagnostic recovery checkpoint is complete. Formal M17 acceptance
remains blocked.** Two independent nonauthor reviewers approved the exact corrected
candidate after a focused 59-case pass. This is the assigned stopping point;
M18, live inference, production deployment and public release were not started.

## Exact source and recovery boundary

| Identity | Value |
|---|---|
| Recovered base and preserved main | `a33c4ad57d13223c05ca985e5728404b671ab21a` |
| Recovered base tree | `2cbdf523001ebebb97897bcf71d425a6e1fcb6f6` |
| Branch | `recovery/M17-images` |
| Executed and independently approved product candidate | `0fa3b7ebe7c41b880077d4a40619a84dbfd4ed6a` |
| Approved candidate tree | `bf77737a55e57068cdbfca05cfdcff67c2ee1aaa` |
| Reader author branch | `recovery/M17-reader` at `7621c4fe71b694130a8dc9aa579b4e1d7b1bf419` |
| Isolated wire fault branch | `recovery/M17-fault-image-wire` at `b735ff1a0a6c08a00308af48d71ddea97de58960` |

The closing commit updates only this record and the image-assistance documentation
after review. The delivered manifest identifies that final documentation commit
and records the exact product candidate above. Product, tests, contracts, pins,
fixtures and registry bytes remain those of the executed candidate; the closing
source comparison records the documentation-only difference.

The restored source came from `Rifare-M23-M25-worker-roadmap.zip`, 80,960,660 bytes,
SHA-256 `b84ea4092006733f263c03e5646d5e5ca0cd57bd32ed43298a4589c43483f72c`.
The archive passed CRC, path and symlink checks; all 1,755 recovered source hashes
matched the native Git tree, 101 native refs were restored, and Git integrity
verification passed. It contains M14 and the expanded M23–M25 roadmap.

The later M15/M16/M23 product checkpoints were unavailable. This branch does not
reconstruct or supersede their implementation and does not inherit M16 managed
isolation. Recovered main remains at the saved base. Reconciliation with that
actual missing history is a prerequisite for later integration.

## Goal progress workers can use

These are the ADR-0051 local development outcomes. Canonical goal cards and the
accepted-goal ledger remain unchanged because their formal dependencies and
qualification gates are not satisfied.

| Goal | Local work completed | Remaining formal obligation |
|---|---|---|
| M17-G01 — Image intake | One declared return-evidence purpose, default/manual status, explicit merchant and ordinary customer opt-in, restricted PNG intake, existing quarantine and exact evidence identity. | Qualify actual intake/processing and required M13/M14 entry gates. |
| M17-G02 — Exact media authority | Current case owner/operator, exact customer approval, case/task/configuration/version/hash bindings, short expiry, before/after asynchronous authority checks, cancellation and reader provenance. | Reconcile missing history and qualify the actual deployed media/provider path. |
| M17-G03 — Privacy lifecycle | Scoped source/receipt erase and retention, subject and gift residue export/erase, held withdrawal/uninstall preservation, restore/import refusal for held content and invalidation of unheld image authority. | Individual-image backup suppression, external retention/deletion and target-host evidence. |
| M17-G04 — Return skill observations | Version 2.0.0 of the existing skill identity with optional image questions; bounded image transport, complete text context, advisory observations, cannot-assess and disagreement handling. | Actual authorized image inference and qualified model behavior. |
| M17-G05 — Qualification | Protocol preparation and semantic digest fixed before implementation; modality restrictions and honest assessment API implemented. | Freeze actual authorized cohort members and independent references, execute the declared evaluation, measure the fixed denominators, and satisfy qualification gates. |
| M17-G99 — Integration assessment | Local evidence and independent reviews recorded with explicit blocked formal assessment. | M13-G99 and M14-G99 acceptance, all required M17 goal evidence, current applicable integrated regression, connected/target-host qualifications and trusted acceptance. |

Native service evidence is in `tests/development/image-assistance.test.mts`:
intake cases 01–02; authority/provenance cases 04–06, 08–10 and 20; privacy cases
11–16; advisory/context/review cases 03, 07, 17–18; and qualification/modality
case 19. The ten reader cases are in `image-reader.test.mts`. These are concrete
native development IDs, not claims that the proposed formal CASE-M17 goals ran.

## Resulting behavior

The service uses one exact validated PNG identity copy, limited to 262,144 bytes
and four million pixels. The current operator enables the declared purpose;
the ordinary verified customer approves the precise image ID and SHA-256 for
the current case, task and configuration. Approval expires within 60 seconds.
Only the current support owner with operator authority can initiate processing.
Legacy worker grants do not gain media authority.

Complete required customer text and corrections remain in context. The service
rechecks sessions, source, approval, configuration, ownership, stop state,
credentials and task/skill/policy context around asynchronous work. Erasure,
cancellation or any intervening authority/context change prevents a late
observation from being persisted. Raw results must carry the private identity
of both the configured reader and the exact invocation passed through the vault.

The optional skill resource asks whether the relevant item is visible, image
clarity is usable and the requested detail is visible. Answers are bounded to
yes/no/cannot-assess. Every observation remains advisory and requires review;
it cannot authorize a refund, financial action, eligibility, receipt or inventory
change. Disagreements use four fixed review reasons.

Only explicit synthetic fixture transport is available. There is no global
fetch fallback or live activation flag. Account/model destinations, response
bytes, context, total deadline and cancellation are bounded. Unknown usage keeps
its original reservation identity, and usage above that invocation's reservation
is unavailable with the full unknown reservation held.

Image configuration and receipts reuse existing storage. Export projects only
case-bound fixed fields and excludes customer session hashes and purchaser gift
facts. A receipt's body timestamp must be a nonnegative safe integer equal to
the canonical row's created_at, even if an imported body has a recomputed digest.
Held content is preserved while authority is revoked. No table, migration,
dependency, HTTP route or general attachment channel was added.

See [IMAGE-ASSISTANCE.md](../../docs/IMAGE-ASSISTANCE.md) and
[IMAGE-READER.md](../../docs/IMAGE-READER.md) for the full workflow and bounds.

## Actual validation

Root was the sole product executor. The reader author and both independent
reviewers executed no product code. The candidate used Node v24.19.0 and the
existing development runner with its unchanged limits: at most 60 cases,
four whole files and one 60-second deadline. Local Node child-process IPC
required the approved execution environment; no provider call or real customer
media was used.

Final command:

```sh
python3 tools/dev_tests.py --files tests/development/image-assistance.test.mts tests/development/image-reader.test.mts tests/development/return-evidence.test.mts tests/development/privacy-coverage.test.mts --output evidence/M17-recovery/attempt-05
```

| Final selected file | Native result | Elapsed |
|---|---:|---:|
| image-assistance.test.mts | 20/20 pass | 15.616 s |
| image-reader.test.mts | 10/10 pass | 0.315 s |
| return-evidence.test.mts | 20/20 pass | 4.579 s |
| privacy-coverage.test.mts | 9/9 pass | 15.058 s |

**Final result: 59/59 passed in 35.664 seconds**, zero failures, errors, skips,
cancellations or todos. All four processes exited zero without timeout. Root and
both independent reviewers inspected the native XML identities and matched all
1,791 recorded source hashes to the exact clean approved candidate. This is a
focused development result; the full product suite and the broader 262-case
adapter catalog campaign were not executed.

Every actual attempt is retained under `evidence/M17-recovery/`:

| Attempt | Candidate | Actual observation | Interpretation |
|---|---|---|---|
| attempt-01 | 0d1ed88 | Filename-level IPC wrapper; zero usable native cases | Invalid evidence, excluded. |
| attempt-02 | 0d1ed88 | 59/59 native pass, 37.480 s | Initial product green; superseded by corrected candidate. |
| fault-image-wire | b735ff1 | Ten native cases, eight pass/two fail | Deliberate isolated fault. WIRE-01 detects omission of the approved image; CONTEXT-04 TypeError is secondary fallout. |
| attempt-03-timestamp-red | 21e9406 | Twenty native cases, nineteen pass/one setup failure | Added fixture selected nonexistent SQL observed_at; excluded as behavioral proof. |
| attempt-04-timestamp-red | a8e77a8 | Twenty native cases, nineteen pass/one assertion failure, 14.795 s | Valid behavioral red: GIFT-RESIDUE-14 is missing the expected integrity exception for an imported private object timestamp. |
| attempt-05 | 0fa3b7e | 59/59 native pass, 35.664 s | Final corrected and independently reviewed product evidence. |

The fail-fast development runner reports zero aggregate passing cases for a
failing whole file. The native XML still contains the actual case counts shown
above. Failed runs are not counted as positive candidate acceptance.

The valid wire fault is a one-line omission in a separate child of the initial
green candidate. Its independently declared expected wire body catches the
missing image. The fault was never integrated. Reader implementation, tests
and expected fixture bytes are unchanged in the final candidate.

Tests-first source history includes the initial service/fixture freeze c1d32ed,
reader tests 74db5fb before implementation c7147d7, reader provenance tests
b7d221e before fix 43f472a, and the timestamp assertions 21e9406/a8e77a8 before
the runtime fix 0fa3b7e. Native history preserves the author's original commits
and all actual correction commits.

## Independent reviews and correction

| Reviewer | Round 1 | Round 2 at 0fa3b7e |
|---|---|---|
| /root/m17_recovery_security | One medium issue R1-SEC-01: imported observed_at could copy an arbitrary object into subject export. Needs changes. | Issue closed. Approved for local synthetic diagnostic recovery only; no remaining security findings in scope. |
| /root/m17_recovery_regression | Approved for local diagnostic checkpoint; no corrective regression finding. | Corrected candidate approved; old assertions, registration objects, catalog objects and pins preserved. |

The correction required a scalar timestamp matching the actual SQL created_at
column. The added test checks both a private object and a different numeric
timestamp with recomputed digests, restores the valid body, and retains the
original export, erasure and purchaser-preservation assertions. The actual red
ran against the unfixed runtime; the same test bytes passed after the runtime
fix. Reviews closed in Round 2 of the maximum three corrective rounds.

The returned review assessments are preserved in `evidence/M17-recovery/reviews/`.
They are independent local review decisions, not formal milestone or release
acceptance. The documentation closing commit introduces no new runtime scope.

## Protected baseline and metadata

| Inventory | Recovered base | Candidate | Preservation |
|---|---:|---:|---|
| Source paths | 1,755 | 1,791 | Every old path retained; 36 additions |
| Registered tests | 3,048 | 3,078 | Every old registration object unchanged; 30 new native IDs |
| Capabilities | 206 | 208 | Every old object unchanged; new capabilities proposed/unaccepted |
| Protected paths | 482 | 512 | No removals |
| Runtime pins | 297 | 301 | Four new runtime files; exact current hashes |
| Database tables | 262 | 262 | Schema/migrations unchanged |
| Catalog adapters | 37 | 38 | All old adapter objects unchanged |
| Catalog operations | 198 | 199 | One new diagnostic image operation |
| Catalog native references | 252 | 262 | Ten new reader references |
| Catalog declarations | 62 | 63 | One new reader declaration |
| Catalog oracle pins | 569 | 599 | No removals; exact changed hashes |

Independent regression review approved the nine arithmetic-only old catalog
test substitutions before they changed, recorded in ADR-0051 at 9354d39.
The existing 47 direct fixtures and 25 participating factories remain unchanged.
Old runtime edits are confined to the four assigned privacy/restore hooks.
The original text readers, text contract, skill bundle, worker grants, canonical
goals, milestone cards and acceptance ledger remain unchanged.

## Qualification still required

The protocol semantic digest is
`07dcdda89316fa8825fdf31b311e05159a95bac326f62b608e5be6f62d47fe8f`.
It fixes the image purpose, question/options, preprocessing, calibration and
held-out roles, eight strata, denominators, review handling and proposed metrics
before implementation. The proposed design requires ten images per stratum per
role, at least 160 images, with independent human references and adjudication.
Actual membership is empty and must be frozen with authorized image identities
and independent labels before evaluation.

There were zero actual hosted image inferences and no measured image accuracy.
The assessment returns qualified:false and pending quality. Synthetic transport
answers cannot satisfy the cohort gate. Audio/video and gift-recipient image
inference remain unavailable.

The remaining gates are concrete:

1. Recover and reconcile the missing M15/M16/M23 product history without moving
   recovered main over it; validate all shared boundaries on the integrated source.
2. Complete the required formal M13-G99/M14-G99 entry evidence and acceptance.
3. Qualify the actual image intake, processing, provider-purpose, retention,
   deletion and target-host route. Text DLP does not establish encoded-media
   coverage, and application limits do not establish managed OS isolation.
4. Implement and qualify portable individual-image backup suppression; current
   authority invalidation does not prove erasure of every stored byte/copy.
5. Freeze the actual authorized cohort and independent references, perform the
   declared image evaluation, and assess its unchanged fixed denominators.
6. Run the applicable integrated regression and connected/target-host checks on
   that qualified candidate, then obtain trusted formal M17 acceptance.

## Delivery, continuation and rollback

The deliverable is a new incremental M17 package, requiring the exact already
saved base archive named above. It contains changed source, a binary-capable
patch, the M17-only native Git bundle, all focused attempts and independent
reviews, and an identity/hash manifest. It does not contain a merchant database,
real customer media, live credentials, the prior full archive or missing history.
The packaging process verifies the bundle by importing it into a fresh native
repository containing only the recovered main baseline, checking the restored
tree and changed bytes, and running Git and ZIP integrity checks. The manifest
records the actual result of that verification.

Resume on a separate integration worktree after the missing history is available;
preserve all recovery and author refs. Reconcile the shared privacy/restore edits
explicitly. Do not integrate the deliberate wire fault branch.

Rollback begins by disabling image configuration and revoking authority while
preserving held content. There is no schema rollback because no migration was
added. Use the existing privacy owner for unheld records; never delete held
records as a shortcut. Recovered main remains the exact saved base throughout.
