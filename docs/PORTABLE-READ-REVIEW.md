# Portable read-workflow integration review

## Authority and limits

ADR-0013 and the owner's delegated instruction authorize M01-G06 through M01-G10
for local nonrelease implementation and integration. DELEGATED-LOCAL-04 explicitly
uses this same assistant's maintainer security/regression review; it is not an
independent reviewer session. Original product acceptance criteria remain unchanged.
The first contribution commits were staged slices; verification covers the combined
candidate. Full candidate and merged-commit identities, commands, raw reports and
restoration results are retained in the separate delivery evidence.

## Findings resolved

1. **Task context leaked another order's knowledge.** A store operator could search
   through an order task and receive references attached to a different order.
   Retrieval now intersects ordinary tenant/role visibility with the task's exact
   resource. Search and source retrieval both enforce the intersection.
2. **A late Shopify refresh could supersede a newer observation.** A response that
   began earlier could write after a later refresh. The adapter now compares the
   observation revision captured before the asynchronous call and rejects a changed
   revision, in addition to rechecking connection, secret and session validity.
3. **Mismatched cache and observation records could appear current.** A canonical
   resource changed independently of its observation could be labeled fresh. Cached
   reads now compare normalized payload/source time to the stored response digest.
   A torn write yields inconsistent_snapshot without order facts. This is a safe
   failure check, not a claim of a single atomic cross-record transaction.

All three faults have actual failing-before and passing-after behavioral tests:
M01-G09-REVIEW-TASK-KNOWLEDGE-SCOPE, M01-G06-REVIEW-CONCURRENT-REFRESH,
and M01-G06-REVIEW-TORN-SNAPSHOT. The profile schema was also aligned with its
runtime requirement that an order-status profile include the order.status action.

## Goal-specific deliberate faults

Temporary detached Git worktrees were used to remove freshness expiry, tenant
filtering, store-specific skill grants, profile identity matching, and agent-thread
independence. Each of the five mutated implementations was caught by its retained
new assertion. Syntax/import failures and omitted tests were not counted as proof.
Patches and commands are in the separate evidence, not the source tree.

## Preserved contracts and test selection

All 683 previously registered checks remain, with 74 additional native cases.
The resulting inventory is 502 Python/helper, 227 runtime, 15 unit harness,
7 database harness and 6 browser-component cases. The external baseline and
controller are exported from the prior integrated main, not this candidate.
No prior executable test file, package input, goal packet, benchmark threshold,
accepted-goal record, workflow policy or verifier implementation was weakened.
Only additive registrations, exact source membership and the enumerated
source-file-count fixture are refreshed under the prior authority checkpoint.

The complete candidate and merged runs must execute this exact inventory before
local integration is reported as verified. Early interrupted discovery runs are
retained as interrupted diagnostics, not passing checks. No counts are inferred
from the planning specifications.

## Residual risks and qualification

- Shopify is implemented against primary documentation and synthetic responses.
  No live store was accessed, so native order comparison and exact permission
  qualification remain open. The read envelope fails closed rather than omitting
  additional pages. Production qualification is always false.
- Shopify cached facts are not available through an unqualified customer-ownership
  path. The synthetic customer's proved-order path remains enforced separately.
- The credential reader is trusted server code, not an untrusted plugin sandbox.
  Skills, profiles and REST callers cannot resolve secrets or register adapters.
- Knowledge retrieval is lexical and memory-based; large-corpus scale and model
  answer quality are not qualified. Only current, unexpired permitted sources return.
- The skill parser deliberately supports a narrow frontmatter subset. Files and
  declared-resource content work without requiring a local shell or shared path.
- Read tasks store portable context; they are not an agent scheduler. Expired rows
  require a later retention job. A profile cannot expand server authority.
- SQLite, static HTML and component tests do not qualify the PostgreSQL/React
  target or the actually served React journey. No external provider, model, payment,
  messaging, deployment or release operation was performed.

## Integration decision

Approve local nonrelease merge after the exact combined candidate passes the
separately pinned regression controller. Preserve goal branches and records. Do
not change formal goal acceptance or milestone qualification. Continue from the
accumulated main; do not return to an old branch to resume the target-stack work.
