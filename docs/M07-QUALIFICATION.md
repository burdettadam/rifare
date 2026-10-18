# M07 portability and operations development assessment

The owner assigned M07-G01 through M07-G05 in ADR-0031, then requested the next
five goals, M07-G06 through M07-G10, in ADR-0033. **Formal acceptance of these connected-test
goals remains blocked.** M05-G99 and M06-G99 have not been formally accepted, and
no connected Woo store, gateway, provider account or endpoint scope was supplied.
The original dependency, account, budget and qualification requirements remain
unchanged. Work beyond M07-G10 is outside this development batch.

| Goal | Local deliverable | Remaining formal proof |
| --- | --- | --- |
| G01 | Bound Woo order/line/payment/fulfillment facts; common case/approval pipeline; composed local RMA with no native return ID | Accepted prerequisites and authorized connected store/history/return semantics |
| G02 | Independent Woo record and original gateway effect/movement; explicit manual pending; original-ID retry/restart handling | Authorized real gateway/store records, accounts, exact versions/scopes and supported payment-stage qualification |
| G03 | Staff page and qualified local agent HTTP path; duplicate-event reconciliation; source-backed refund notifications; full privacy inventory | Connected store/gateway/message journeys, provider/runtime intended-use assessment, target stack and direct served-browser qualification |
| G04 | Independently implemented TypeScript/Python clients; narrow case grants; same approvals/operations across handover | Connected runtime/provider qualification against accepted platform and merchant scope |
| G05 | Versioned reusable local conformance catalog/fixtures, native runner bindings and independent source assertions | Human-authorized public publication and real-provider qualification reports |
| G06 | Evidence-bound quality/compatibility matrix, exact current source/configuration pins, explicit unsupported tiers | Connected model/runtime intended-use assessment and authenticated independent evidence |
| G07 | Versioned single-merchant export, lossless business identity, current erasure-checkpoint replay, quarantined import and explicit credential-reference mapping | Authorized live merchant transfer, external credential provisioning and a separately qualified activation path |
| G08 | Shared SQLite ownership transaction across dispatch, dry-run history comparison, guarded cutover and rollback that pauses both writers | Target-host coordination durability and authorized live cutover/reconciliation evidence |
| G09 | Seven executable recovery runbooks using existing permissions, methods and synthetic ledgers; stale/unsafe commands rejected | Independent live operator qualification for the actual deployment and providers |
| G10 | Pinned offline source preparation, clean installation, actual migrations, seed/read workflow, interrupted upgrade and quarantine rollback | Independent clean-machine/released-artifact observation and target-stack qualification |

Each adapter operation must retain an honest native/composed/manual/unavailable
classification and a separate local-fixture or external qualification status.
Planning-only platform examples are not implemented capabilities. Source record
creation is not payment settlement; message acceptance is not delivery. None of
the local fixture proofs creates live financial, stock, physical or messaging
effects. The actual Woo REST API namespace is represented by the local fixture
contract; no deployed Woo/plugin/provider version is implied.

The first-five checkpoint retains its complete protected-controller evidence,
packet-specific faults, and separate nonauthor reviews. That historical full pass
is not a current full pass for the new batch. Under the owner's focused-development
policy, the next-five batch uses four small native test files, the seven-case
development helper check, and focused source review. Full regression, browser
suites, nested catalog/controller campaigns, and multi-level restoration audits
are not automatic batch steps.

The current review caught and corrected stale-snapshot erasure resurrection,
bracket-leading merchant text being mistaken for JSON, migration binding that
could affect unrelated merchants, and cutover history that omitted a completed
native return. Migration comparison also preserves current effect authority,
including consent, holds, stops, approvals and policy activation. Existing test assertions and capability objects
are retained; additions remain `proposed_not_accepted`. The handoff records exact
source and actual selected results separately from the unchanged formal gates.

Import establishes no live authority: it retains recovery quarantine and old
operation replay denial even after migration ownership changes. Rollback stops
both migration writers. Installation preparation uses fresh directories on this
host and does not claim an independent machine, a released artifact, or model
availability. No added diagnostic matrix, receipt, coordinator, or runbook can
substitute for those missing qualifications.

See [common lifecycle](COMMON-RETURN-LIFECYCLE.md),
[Woo returns](WOOCOMMERCE-RETURNS.md),
[Woo refunds](WOOCOMMERCE-REFUNDS.md), and
[independent runtimes](INDEPENDENT-RETURN-RUNTIMES.md),
[compatibility](COMPATIBILITY-LIMITS.md),
[merchant transfer](MERCHANT-PORTABILITY.md),
[operator runbooks](OPERATOR-RUNBOOKS.md), and
[installation/upgrade](INSTALL-UPGRADE.md) for implementation boundaries.
The source record [M07.json](../work/qualification/M07.json) lists the remaining
qualification gaps; it is not a substitute for native or independent evidence.
