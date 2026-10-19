# M14 bounded milestone integration

Protected M13: `655ea8c4a8688f938454c10f777478316c07d7e3`. Prior assignment:
ADR-0043. Only M14 is assigned. Root is the sole product executor and local
integration owner; one isolated author delivered G04 with zero product execution.
Two independent nonauthor authority/security and regression reviews are required.

Source, independent fixtures and frozen thresholds were committed before their
implementation outputs. The final native selection passes 8 SystemOne + 20
routing + 23 retained shadow + 9 retained privacy cases. Every invocation stayed
within 60 cases/four files/one total 60-second deadline. All three actual attempts
remain in evidence: the first passed SystemOne but hit a routing-file syntax
failure; the second ran twenty routing cases with eighteen vocabulary-order
failures; the third passed all 52 affected/unrun cases in 35.311 seconds.
The final set is 60 passing cases, with 80 product-case executions across all
attempts and one separately recorded parse-failure wrapper.

The six independent source findings were corrected after focused assertions
were committed. Current activation revisions invalidate old handles; selected
job replay uses the existing canonical version column; configured revisions do
not bypass the canary required by unobserved serving revisions; partial history
is unavailable in qualification/canary scoring and requests review at runtime;
fallback and rollback cannot promote a reviewed partial rollout; and completed
cohorts that fail quality gates are distinct from missing evidence. The native
vocabulary correction compares exact label sets without altering frozen labels,
thresholds, current question/source digests or accepted capabilities.

Native runtime source is `4d6b386b5d3f6b646f029104815841396c020d7e`.
SystemOne's eight cases ran at `c961347b427570ede5eba93b98a888922fbb1c84` and
are carried only with exact unaffected-source reasoning and both review hashes.
Later source changes close out documentation; no product test result is
relabeled as having run on that later commit. Final nonauthor dispositions,
source/evidence hashes, preservation audit and the separate root integration
decision are in the accompanying `evidence/` records. A local integration
decision is not an accepted-goal ledger update or a release authorization.

All earlier source paths, tests, capability objects, original/adopted planning,
privacy/storage contracts, migrations and full native Git history are protected.

M14-G02 actual backend measurement and G04/G05 external portability/self-hosted
qualification remain pending; G99 formal acceptance remains blocked. Bounded
local integration is distinct from the accepted-goal ledger and release authority.
M15-G01 is next and M15–M22 remain unassigned.
