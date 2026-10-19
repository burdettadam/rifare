# M18-G01 verified shopper memory — completed local foundation

## Outcome and authority

The complete bounded ADR-0053 increment is implemented, independently reviewed
and locally verified. A currently verified customer can save explicit finite
preferences for an existing case, retrieve them through another verified link,
correct them or forget them. Every access rechecks current ownership and proof.
Old preferences cannot return as usable memory through source changes, expiry,
correction, deletion, old native backups or repeated merchant import.

This follows the owner's 2026-10-19 instruction, "Proceed working on goals for
the next milestone", under standing delegation. Root assigned the contract and
paths before implementation and remained the sole product executor. A separate
test author committed 25 native cases before root wrote runtime code. Both
final reviewers were independent nonauthors and performed read-only review.

This closes the assigned local M18-G01 foundation. It does not accept formal
G01/M18 or the M07/M09/M15 dependency gates. M18-G02–G05 and G99 remain open.
The original goals, milestones and acceptance ledger are preserved. M18's
explicit local-preparation clause permits this bounded work; it does not
recover or substitute for the missing later M15/M16/M23 implementation.

## Exact source and tests-first sequence

| Role | Commit |
| --- | --- |
| Previous saved M17 checkpoint | 1534f5e163aeab9f3c252a8ff88b7a819913a991 |
| Prior bounded assignment | b56a4006f5dcc1ebcc479101e05eb9aabe7d4e45 |
| Prior historical-subject clarification | ea8a68f7b6c1c220ae5a156e0ee0334900005182 |
| Independent tests-first author | 20df5d7b0480486911bf0fae7ca02930197dd1b2 |
| Tests integrated before implementation | 5d4c430737a3135bfd97a8bd25701e1712112630 |
| Executed and independently reviewed product | 90ee7d829149f78514e6cdd5e7fff05ac922f7b3 |
| Isolated source-freshness fault; never integrated | 255dedd0fcef54c57ad8f63a2a08f9e5871b3d3e |

Reviewed product tree: `6b47940caa9709ce2d52b1b3cd8771d02b4bc1b0`.
All 1,806 source hashes captured in the native report match that clean product.
This record and PLANS.md are a subsequent documentation-only closure. The
package manifest supplies the final checkpoint commit/tree and the exact
comparison against the reviewed product, without claiming another test run.

Product branch: recovery/M18-memory. Independent test branch:
recovery/M18-memory-tests. Deliberately faulty branch:
recovery/M18-memory-fault. The preceding recovery/M17-suppression branch remains
at 1534f5e. Recovered main remains
`a33c4ad57d13223c05ca985e5728404b671ab21a`, tree
`2cbdf523001ebebb97897bcf71d425a6e1fcb6f6`.

## Implemented behavior

The ShopperMemory API and three existing SupportService dispatcher actions
support record, forget and context. Only a currently verified customer can
write, using support.customer_message. Reads bind exact tenant/store/case/
resource/customer/verified link/current ownership generation. A staff or
built-in agent reader must also own the current support generation and supply
the current customer proof. Old worker grants are unchanged.

The fixed support_journey purpose accepts only fit_preference (close, regular,
relaxed) and response_style (concise, detailed), with one or both fields as a
complete replacement and expiry no more than 30 days ahead. Unknown fields,
accessors, transcripts, inferred preferences and arbitrary purposes are rejected.
Available provenance identifies an explicit verified customer request through
a scoped hash, original link/revision, observation time and source digest.

The existing support-document table stores shopper_memory versions with a
deterministic case/resource/scoped-subject identity, fixed author, exact schema
and bounded scans. All historical versions are validated before mutation.
Current proof and source checks are separate from retained integrity: a valid
new proof may observe source_changed, but an invalid old proof cannot read or
rewrite the record. Memory never confers action authority or requires a private
model thread.

Correction and forgetting use latest-version checks and reject any request hash
already used in that memory. Retirement scrubs personal values, source links and
prior preference digests when unheld. An active hold retains personal bytes in
revoked historical versions, excludes them from ordinary context and makes
retention explicit. After hold release, authorized access or lifecycle work
cleans retired values. Expiry and source changes never fall back to old values.

Privacy export adds the subject-filtered shopper_memory_records allowlist.
Export and whole-subject erasure still select the original subject's memory
after order reassignment and source removal, even with zero current resources.
They do not follow the order into its new owner's case data. Every subject
version is scrubbed as subject_erased. Existing conservative cleanup of unbound
store text remains documented. Uninstall invalidates memory, preserves held
content and disconnects the store.

Native restore and merchant import preflight memory before suppression can hide
malformed content. Repeat import independently validates the original package
and current destination. All recovered personal preferences are scrubbed and
revoked, including reintroduced destination memory. Current subject suppression
precedes held-content refusal so completed erasure supersedes an obsolete copied
hold. Any other held personal memory refuses the operation atomically.

Quarantine, revoked authorities and exact original operation/receipt identities
remain intact. A fresh verified statement is required before any future usable
memory; the existing recovery customer-verification egress restriction is not
lifted. No new table, migration, HTTP route, adapter, worker grant, provider
dependency, case ledger or financial operation is added.

## Actual native and fault evidence

The first implementation selection passed on the clean candidate:

| Whole native file | Cases passed | Elapsed |
| --- | ---: | ---: |
| Shopper memory | 25 | 5.431 seconds |
| Existing support conversations | 7 | 1.168 seconds |
| Existing safe recovery | 14 | 2.926 seconds |
| Existing merchant portability | 14 | 4.087 seconds |
| Total | 60 | 13.703 seconds |

No failures, errors, skips, cancellations or todos. Every native process exited
successfully without timeout. Root used Node v24.19.0 and the unchanged native
tools/dev_tests.py runner, under one 60-case/four-file/60-second deadline. No
provider, browser or full-regression campaign ran. No corrective test fixture
or product round was needed.

The separately committed fault makes only #sourceCurrent return true, with the
two corresponding file pins refreshed. Its unchanged whole memory file ran
25 native cases: 22 passed and three failed because stale memory was available
where source_changed was required:

- CASE-M18-G01-03: changed canonical order source.
- M18-G01-CURRENT-CONTACT-PROOF: fresh proof after the customer contact changed.
- M18-G01-MISSING-HISTORY-AND-SOURCE-LINK-REVISION: changed original link revision.

These are behavioral failures, not missing imports, syntax or metadata failures.
The actual fault invocation took 5.871 seconds. Its aggregate runner credited
zero passing cases because the native file process failed; raw JUnit/TAP proves
the distinct 25-executed/22-passed/3-failed counts. The original failed report is
retained unchanged. The fault branch is not integrated or intended for use.

Evidence included in the checkpoint:

- evidence/M18-memory/attempt-01/: exact report, source hashes, all four native
  XML reports and TAP logs from the passing product.
- evidence/M18-memory/targeted-fault/: original failed report, JUnit/TAP,
  isolated patch and explicit native-count/source assessment.
- evidence/M18-memory/verification-round-1.json: exact source membership,
  previous-object preservation and actual runtime/oracle pin checks.
- evidence/M18-memory/reviews/: both actual independent round-1 decisions.
- evidence/M18-memory/closing-source-comparison.json: post-commit proof that
  only the two milestone documentation files differ from the reviewed product.

The older privacy-lifecycle, work-lease and M17 image files were not added to
this focused selection. The new memory file exercises affected privacy, holds,
erasure, uninstall, ownership, late request, restore and import paths. Existing
conversations/recovery/portability cover retained paths. Neither independent
review identified a concrete risk requiring a broader development selection.

## Independent decisions and preserved baseline

/root/m18_authority_scope approved the exact candidate for the bounded local
increment, with no corrective security finding. It reviewed authority, retained
integrity, historical subject selection, suppression-before-hold ordering and
the actual native fault. It confirmed no worker or business authority expansion.

/root/m18_regression_scope independently approved the same candidate, with no
corrective regression finding. It checked all actual native IDs and source
hashes, the tests-first/fault history, narrow integration points and preserved
baseline. Its requirement to replace the assignment-placeholder record and
update PLANS before delivery is fulfilled by this documentation-only closure.
Neither reviewer authored source/tests or executed the product.

All 3,090 prior test objects, 209 capability objects, 515 protected paths and
1,797 source members are retained. New totals are 3,115 test registrations,
210 capabilities, 521 protected paths, 1,806 source members, 305 runtime pins
and 608 oracle pins. All 38 adapter objects, 63 catalog source declarations,
declaration pins, old tests/helpers/fixtures, dependencies, 262 tables and
fifteen privacy-surface IDs are preserved. All current hashes match. Original
goal/milestone objects and the acceptance ledger remain unchanged.

## Next milestone goals

| Goal | Next bounded outcome | Status after this checkpoint |
| --- | --- | --- |
| M18-G01 | Verified explicit shopper-memory foundation and full assigned local lifecycle | Locally implemented and reviewed; formal qualification open |
| M18-G02 | Current merchant/platform/channel/actor/runtime readiness, reason codes and alternatives | Next development assignment; reuse the existing capability registry |
| M18-G03 | Durable journey references to existing intents, cases, previews and operation receipts | Pending G02 and applicable accepted dependencies |
| M18-G04 | Update or suppress follow-ups when purchases, returns, edits, preferences or consent change | Pending G03; reuse existing event rules and consent controls |
| M18-G05 | Continue the same declared journey across manual, built-in agent and independent remote callers | Pending earlier goals and actual M15 remote/client qualification |
| M18-G99 | Independent cumulative milestone assessment | Open; complete journey and real qualification still required |

G02 should project current readiness rather than create a second permission or
operation owner. Disabled, needs-configuration, unsupported, temporarily
unavailable and unverified states must remain distinguishable. Any new assignment
must bind concrete paths, independent tests and the current bounded runner before
implementation; the original worker packets remain the frozen specifications.

Formal M07/M09/M15/M18 gates, connected-channel evidence, remote-client support,
target-host qualification and missing later M15/M16/M23 source reconciliation
remain open. A context digest or local fixture is not evidence of those gates.
No release, deployment, paid/production effect or main-branch advancement is
claimed. Logical cleanup does not destroy old backup files, database free pages
or copies already held by callers or providers.

## Recoverable checkpoint

The cumulative incremental package includes earlier M17 diagnostic and image-
suppression work plus this M18 foundation. It requires the exact already-saved
Rifare-M23-M25-worker-roadmap.zip base (SHA-256
b84ea4092006733f263c03e5646d5e5ca0cd57bd32ed43298a4589c43483f72c), not the
intermediate M17 zip. Native incremental history, final changed source, patch,
actual evidence, both reviews and restore instructions are included.

The package is verified by importing its bundle into a fresh repository with
only the saved base, checking Git objects, exact restored tree and changed bytes,
and verifying archive members. Its manifest records that actual verification.
Preserve unrelated/newer branches and reconcile missing source explicitly before
any future integration. The isolated fault branches must never become product.

The package contains project source, synthetic development fixtures and evidence.
It contains no merchant database, live credentials, runtime environment or
complete M16 archive. No retry of the previously rejected complete payload is
part of this checkpoint.
