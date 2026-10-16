> Current development decision: accepted under delegated bootstrap authority; see [ADR-0004](0004-delegated-development-authority.md). Original submission/proposal wording below is retained for audit and is not the current acceptance state. No product qualification or independent review is implied.

# ADR-0003 — Component licensing and source-distribution boundaries

Status: proposed; owner decision and independent reviews pending
Goal: M00-G03
Human decision: pending
Dependency: M00-G01 / ADR-0001 is not yet accepted

## Proposed decision

Adopt the exact [licensing policy](../../planning/licensing-policy.json) only after
owner review: AGPL-3.0-only for the future application; Apache-2.0 for separable SDKs,
public skills/templates, and original developer/documentation material. Preserve
upstream licenses and notices. Keep private merchant instances and data outside
public distribution. An Apache-2.0-only original-code strategy is the alternative.

Propose component-scoped inbound terms and DCO 1.1 after explicit adoption, not
copyright assignment or automatic commercial relicensing. The rights holder is
unconfirmed. Do not use an organization name or the assistant's Git identity as
proof of ownership. Do not add license grants, signoffs or an accepted decision now.

## Implementation choice

Use an explicit source-file inventory, reviewed synthetic-fixture hashes, unchanged
upstream notices, and a small offline checker. Distinguish structural local review
from public release. Validate exact staged membership/bytes against a clean candidate
and independently retained manifest hash. Unknown third-party licenses, new dependency
inputs, undeclared files and private profiles fail closed.

A generated catch-all license would disguise ownership questions. A new release
orchestration service would exceed this goal. A full compatibility scanner would
still not decide rights or privacy. Adopt standard metadata/tooling later when the
owner chooses licenses and real dependency graphs exist.

## Limits and acceptance

No application license is active, no third-party package is installed, no outside
contribution is solicited, no live merchant data is processed and no remote is
published. The public preflight deliberately remains blocked. Metadata hashes show
bytes, not legal permission or reviewer identity. Formal goal acceptance needs the
real owner decision and independent reviews; a source-review pass alone is not it.

See [the work record](../../work/records/M00-G03.md), [licensing rationale](../LICENSING.md),
[data boundary](../MERCHANT-DATA-BOUNDARY.md) and [checks](../DISTRIBUTION-REVIEW.md).
Retain this proposal and actual future decisions separately rather than silently
rewriting history into an approval.
