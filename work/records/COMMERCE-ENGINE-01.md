# COMMERCE-ENGINE-01 — Upstream commerce application

State: assigned; implementation and verification in progress.
Base: `698ad808baaa72b2dba4b46831bfb0608083293f`.
Branch: `feat/medusa-commerce`; sole writer and integration owner: root.
Assignment: [ADR-0081](../../docs/decisions/0081-upstream-commerce-engine.md).

The owner selected Medusa to replace commodity commerce and reduce custom code.
The current source has no runnable target PostgreSQL/React application; its cart
and checkout owners explicitly bind synthetic sources. This assignment makes the
upstream application the selected commerce target while retaining those regression
contracts and the ElevenID evidence boundary.

Independent review roles will be supplied by `elevenid_identity_boundary`
(authority/security) and `medusa_replacement_audit` (regression). Neither authors
product code or tests. `postgres_runtime_setup` prepares only an isolated local
database outside the repository. It does not change the product or review it.

Actual candidate, commands, observations, review findings, corrections and remote
retention will be recorded here after execution. No passing or completion claim is
made by this assignment. Formal product acceptance and production remain open.
