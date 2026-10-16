# Rifare architecture direction

**Target architecture; only an explicitly labeled diagnostic slice is implemented.** M00 approves the support envelope, and later goals bind actual module paths and contracts.

Rifare is a merchant-owned commerce operations platform. Start with returns/exchanges, safe edits, support and tracking; expand only after qualification. The core holds durable business state, money/inventory rules, policies, approvals and receipts. Human UI, rules, built-in and external agents share the same authority boundary.

Portable skills describe workflows. Typed merchant profiles customize permitted fields. Platform packs describe capabilities; adapters perform supported native operations. Model providers and agent runtimes remain independently replaceable. Keys stay in server-side integration boundaries, never skill text or provider-owned business records.

The intended starting implementation is a modular TypeScript/Node service and worker, React UI, PostgreSQL, durable jobs and attachment storage. This is a design direction, not an installed stack. M00-G05 establishes runnable structure and resource isolation. Prefer adapters and native tooling to unnecessary new orchestration.

The action lifecycle is verified intent, current facts, policy evaluation, preview, required approval, current-state recheck, execution, receipt and reconciliation. Return authorization, physical movement, receipt/inspection, financial settlement and replacement fulfillment remain distinct.

Do not infer duplicate-free effects from a timeout. Reconcile unknown remote outcomes before retrying irreversible actions. Evidence, permissions, privacy, no-AI behavior, portability, compatibility and restore safety are cumulative requirements.

Read [the roadmap](ROADMAP.md), [skill architecture](docs/SKILL-ARCHITECTURE.md), [invariants](planning/invariants.json) and [capability targets](planning/capability-targets.json). The synthetic examples under `examples/` demonstrate shape, not qualified execution. Partners remain prerequisites for physical or regulated services.

## M00-G05 implemented diagnostic boundary

`apps/api`, `apps/worker` and `apps/web` are separate owned local processes. Shared
fixture persistence and lifecycle code is in `packages/development`. This code
is development-only, not the commerce domain or future financial execution core.
`migrations/smoke` applies transactional SQLite fixture schema. The web shell is
not React. [ADR-0006](docs/decisions/0006-local-environment-qualification.md) preserves
the PostgreSQL/React target and lists the unperformed qualification.
