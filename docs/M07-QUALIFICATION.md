# M07 first-five local development assessment

The owner assigned a bounded local development slice of M07-G01 through M07-G05
in ADR-0031 after the prior M06 handoff. **Formal acceptance of these connected-test
goals remains blocked.** M05-G99 and M06-G99 have not been formally accepted, and
no connected Woo store, gateway, provider account or endpoint scope was supplied.
The original dependency, account, budget and qualification requirements remain
unchanged. M07-G06 and later goals are outside this batch.

| Goal | Local deliverable | Remaining formal proof |
| --- | --- | --- |
| G01 | Bound Woo order/line/payment/fulfillment facts; common case/approval pipeline; composed local RMA with no native return ID | Accepted prerequisites and authorized connected store/history/return semantics |
| G02 | Independent Woo record and original gateway effect/movement; explicit manual pending; original-ID retry/restart handling | Authorized real gateway/store records, accounts, exact versions/scopes and supported payment-stage qualification |
| G03 | Staff page and qualified local agent HTTP path; duplicate-event reconciliation; source-backed refund notifications; full privacy inventory | Connected store/gateway/message journeys, provider/runtime intended-use assessment, target stack and direct served-browser qualification |
| G04 | Independently implemented TypeScript/Python clients; narrow case grants; same approvals/operations across handover | Connected runtime/provider qualification against accepted platform and merchant scope |
| G05 | Versioned reusable local conformance catalog/fixtures, native runner bindings and independent source assertions | Human-authorized public publication and real-provider qualification reports |

Each adapter operation must retain an honest native/composed/manual/unavailable
classification and a separate local-fixture or external qualification status.
Planning-only platform examples are not implemented capabilities. Source record
creation is not payment settlement; message acceptance is not delivery. None of
the local fixture proofs creates live financial, stock, physical or messaging
effects. The actual Woo REST API namespace is represented by the local fixture
contract; no deployed Woo/plugin/provider version is implied.

Current-candidate verification includes the unchanged protected controller with
its original 480-second layer deadlines, all previous registered cases and
capability objects, five packet-specific behavioral faults, source observations,
and separate nonauthor authority/security and regression reviews. Native test and
capability additions remain proposed, not formally accepted baseline criteria.
The protected prior artifacts, native branch/history objects and cumulative
evidence remain part of the restorable handoff.

See [common lifecycle](COMMON-RETURN-LIFECYCLE.md),
[Woo returns](WOOCOMMERCE-RETURNS.md),
[Woo refunds](WOOCOMMERCE-REFUNDS.md), and
[independent runtimes](INDEPENDENT-RETURN-RUNTIMES.md) for implementation boundaries.
The source record [M07.json](../work/qualification/M07.json) lists the remaining
qualification gaps; it is not a substitute for native or independent evidence.
