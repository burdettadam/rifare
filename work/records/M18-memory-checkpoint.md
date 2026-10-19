# M18-G01 verified shopper memory — assigned local increment

Status: assigned under ADR-0053 before implementation on 2026-10-19.

Owner instruction: "Proceed working on goals for the next milestone."
Root is delegated maintainer, integration owner, runtime author and sole product
executor. Base: 1534f5e163aeab9f3c252a8ff88b7a819913a991.
Branch: recovery/M18-memory. Independent test author: /root/m18_memory_tests.
Independent authority/security reviewer: /root/m18_authority_scope.
Independent regression reviewer: /root/m18_regression_scope.

Implement the exact bounded source-backed customer preference contract in
ADR-0053, including privacy, correction, holds and conservative restored-memory
invalidation. Tests precede implementation; a meaningful isolated targeted fault
supplies behavioral red evidence for the new API. Planned focused selection:
25 memory, 7 conversations, 14 safe-recovery, 14 merchant-portability cases under
the unchanged 60-case/four-file/60-second limit.

No product outcome or milestone acceptance is recorded yet. Formal dependencies,
later M18 goals, remote/channel qualification and missing source remain open.
Do not rewrite the acceptance ledger or treat this assignment as a completed test.
