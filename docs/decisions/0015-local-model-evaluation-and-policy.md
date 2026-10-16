# ADR-0015 — Local-model compatibility, adversarial input, evaluation and policy foundations

The owner requested the next five implementation goals and has delegated decisions,
review and local merging. This checkpoint precedes work from main d32342c. One writer
owns branch goal/model-policy-batch and its linked worktree.

Implement M01-G16, M01-G17, M01-G18, M02-G01 and M02-G02. Assess the M01 gate as an
integration obligation, not an extra feature or claimed accepted milestone. Reuse
canonical read tasks, skills, server sessions, the test harness and regression gate.
Local-model calls use an explicitly configured loopback service and synthetic tasks;
no model download, paid service, production data or remote publication is authorized.
No installed local model or cloud credentials are assumed. Report actual compatibility
separately from mock-server protocol tests. Money code performs arithmetic only and
never issues payments. Roles cannot authorize unavailable business actions.

Continue the explicit local diagnostic ordering exception into these bounded M02
foundations: M00/M01 full qualification remains blocked. This permits implementation
and nonrelease integration, not relaxation of original acceptance criteria. Record the
remaining PostgreSQL/React, served-browser, live-platform and real-model gaps.

DELEGATED-LOCAL-06 permits a documented maintainer security/regression review for this
batch without representing the author as independent reviewers. It cannot waive
failures, skip existing tests, shrink denominators, change original goals, or grant
release authority. Refresh external baseline pins only after recording reviewed
changes. Inventory and registrations may be extended; old tests remain unchanged.

Allowed changes: local adapter and runner integration; typed untrusted-input boundary;
source-grounded evaluator and synthetic cases; server-enforced roles and audit with
an additive SQLite migration; exact money/allocation primitives and independent
fixtures; new tests, commands, work records and documentation. Preserve the current
HTTP, MCP, profile and skill contracts. No new scheduler, mandatory provider or npm
dependency. Privileged server-local provisioning is not an HTTP capability.
