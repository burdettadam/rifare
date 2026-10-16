# ADR-0017 — Case configuration, skill activation and bounded execution

Owner assignment: implement the next five goals, M02-G08 through M02-G12.
Base: a8bdafa. The standing owner delegation permits implementation decisions,
maintainer review and local nonrelease integration. This record precedes code.
One writer owns `goal/execution-boundaries-batch` in its dedicated checkout.

Implement immutable case pins; scoped skill draft/test/review/publication, canary,
rollback and revocation; a shared typed action gateway; exact-preview approvals;
and authenticated raw-byte webhook persistence. Reuse current authority, policy,
skill, money, HTTP, SQLite and test contracts. No runtime dependency is added.

DELEGATED-LOCAL-08 permits documented same-assistant security/regression review
for this bounded local integration only. It does not claim independent reviewers,
full prerequisite acceptance or production qualification. Keep target PostgreSQL,
React, real-provider and hosted security qualification open. Do not waive tests.

Writes are limited to reversible synthetic case-plan records. No refund, message,
warehouse mutation, arbitrary adapter invocation, model call or external egress
is enabled. Approvals are server-created exact-preview records; product roles
must remain distinct even though project decisions have been delegated.

Webhook integration uses pinned provider contracts. Signed bytes are verified
before JSON parsing. Never treat unsigned routing headers as cryptographic tenant
proof. Store/subscription routing is server-configured; any delivery lacking
independently bound tenancy remains quarantined with no processing authority.
Local fixture qualification is not a live subscription or network exposure.

Allowed paths: additive commerce/adapter/transport modules and migration; narrow
existing skill/policy/role/server integrations; synthetic tests/demo; source
inventory, registration, work records and documentation. Preserve all prior test
sources, registrations, requirements, benchmark targets and dependency inputs.
Control changes, if any, require a separately recorded reasoned review.
