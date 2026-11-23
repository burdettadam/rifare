# RCG-4A-NATIVE-INTENTS — Durable local checkout intent and receipt evidence

State: ready_for_review; local implementation and registration complete
Writer/integration owner: root development agent
Branch/worktree: `feat/rcg4-native-intents`, `rifare-rcg4-native`
Base: `bae37e8f55130328a5e5f4ba2a4a35549bf58388`
Assignment: [ADR-0069](../../docs/decisions/0069-durable-delegated-checkout-intents.md)
Independent reviews: `/root/rcg3_authority_review`, `/root/rcg3_regression_review`
Privacy implementation: `/root/rcg3_provider_contract` in `feat/rcg4-intent-privacy`
Formal acceptance: not requested or inferred

## Outcome and limits

Implement durable original identity, bounded verified evidence, local duplicate
refusal, cancellation, retained-status reads and complete privacy/recovery hooks.
Current-source and current-authority checks remain in the existing native owners.
Persistence does not consume provider authority or authorize commerce execution.
The provider transport remains unavailable; no public route or work is queued.

Preserve every prior test, oracle, accepted criterion and capability boundary.
Use real local signatures for recording cases and adversarial final-transaction,
restart, restore and repeated-import cases. Record actual candidate results here
before independent review; keep final exact review reports in the handoff.

## Starting evidence

The RCG-3 base has no durable delegated intent owner; previews and verification
provenance are process-local. Generic operation queues immediately create
dispatchable work and are not reused for this record. Native document-domain
owners already supply the storage and privacy pattern. GitHub publication is
technically blocked by previously observed CLI credentials and connector HTTP
403; user authorization to push persists, but successful publication is not claimed.

## Implemented candidate

The fixed candidate is the commit containing this source registration; its exact
SHA/tree and independent review dispositions are retained in the Codex handoff.
Prior assignment `3896219` and corrective assignment `aff450d` precede their
affected implementations. Core source starts at `43e6371`, correction `202180e`
adds final transactional claims and terminal/exact expiry, and `fdebc65` integrates
the isolated privacy implementation. No accepted ledger or original criterion changed.

The native owner now retains original identity, context/purchase binding digests,
one actual signature-verification observation, terminal local claims and revisions.
It accepts IDs and a compact JWS only. Private WeakMap provenance cannot be
recreated from persisted data. Source/proof/context/trust and deadline guards run
inside the final synchronous transaction, followed by inert SQL identity,
uniqueness and capacity checks. No provider consumption or dispatch is created.

Expiry observation is one-way and durable across owner/restart/clock rollback.
The original exact timestamp parser is reused unchanged, and the stored receipt
boundary is the first integer millisecond at or after exact expiry. Revoked held
personal content is visible only in the explicit privacy export, not ordinary
intent reads. Erasure, zero-resource subjects, reassignment, repeated suppression,
uninstall, backup restore and first/repeated merchant import have dedicated hooks.

## Focused evidence

- **42 new native cases pass:** 23 core identity/verification/atomicity cases and
  19 privacy/recovery/import cases. Integrated local report
  `evidence/development/20261120T040001.145866Z-a1d804/report.json`.
- **22 unchanged RCG-3 native receipt cases pass** after the shared guard and
  exact-time changes. The 45-case combined report is
  `evidence/development/20261120T035825.266611Z-3aee62/report.json`.
- **54 unchanged lifecycle/coverage cases pass:** 9 privacy coverage, 17 privacy
  lifecycle, 14 safe recovery and 14 merchant portability. Report
  `evidence/development/20261120T040410.410169Z-8962aa/report.json`.
- Strict TypeScript comparison uses the same existing receipt/privacy/recovery/
  portability owners and four existing test files in base/candidate, plus the new
  modules/tests in the candidate. Both emit **940 inherited diagnostics**, with
  zero added/removed normalized path/code/message occurrences. Line/column shifts
  in edited owners are ignored; multiplicity is preserved. This broader selection
  differs from RCG-3's 557-diagnostic entry scope and is not a clean typecheck.
  `evidence/rcg4-types-comparison.json` records the comparison.
- Plan validation, generated views, repository and distribution checks pass.
  All 949 specifications and original requirement mappings remain. Registration
  appends 42 cases (3,488 total rows), ten sources (1,747 total members), and three
  runtime pins (350 total). Every original member/row remains unchanged.
- Privacy retains all fifteen surfaces and the original schema digest. The new
  personal document kind is explicitly handled under `analytics_readmodels`,
  which already owns `commerce_support_documents`; process-memory provenance
  remains separately classified. Five changed existing runtime pins are refreshed.
- The catalog validates at unchanged 46 adapters, 221 operations, 308 case
  bindings and 47 direct fixtures. Only four existing transitive oracle source
  pins change (binder and three lifecycle owners); all old adapters/cases/operations
  and direct fixtures remain. Inherited direct-fixture destination version mismatch
  and older full-catalog count assertions remain outside this focused pass.
- Optional cached installation retains the exact JOSE 6.2.18 graph, 80 package
  files and installed tree digest
  `8247cbabe4fe086e6330038cc15353b9f5cd001dd7650916657e68de4e6cf863`.
  Dependency manifests, upstream vector bytes and cryptographic primitives are unchanged.

### Failures reproduced before correction

Independent review reproduced source-callback reentry committing duplicate local
challenge claims, expiry revival after clock rollback, loss of a valid one-nanosecond
receipt interval, and impossible historical receipt intervals accepted after
recomputing row digests. Four named assertions failed before the fixes in
`evidence/development/20261120T035708.257321Z-ecb97d/01-output.log`; the retained
tests now pass. No setup/parser failure or skipped test was used as that evidence.

The privacy implementation separately demonstrated held erasure leaving authority
active against an isolated core-only archive, then current suppression failing to
scrub a replayed personal export under an obsolete hold. Its source commit records
the exact red-run paths. Both scenarios have retained passing behavioral cases.

## Review and remaining limits

The two preliminary independent reviews informed the corrections above. Final
authority and regression review must bind this fixed candidate; their exact JSON
reports and dispositions live in the handoff without changing the reviewed native
tree afterwards. No full regression, product acceptance, physical deletion,
external provider, target deployment or release qualification is inferred.

Latest provider inspection still finds no usable delegated final-use transport.
The next provider-bound increment must use an actual published authenticated
contract, preserve original identities through unknown outcomes, and keep provider
authority consumption distinct from the commerce effect. Current local intents
cannot reconstruct previews or resume verification after restart.

Publication is not attempted again without changed access: the previously
observed missing Git CLI credentials and GitHub integration 403 remain. Preserve
the unpublished native branch as an incrementally restorable Git bundle alongside
the complete updated handoff project.
