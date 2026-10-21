# Rifare project status

**Public development preview · local synthetic implementations · production qualification open**

This guide summarizes the accumulated source at development checkpoint [`c299065`](https://github.com/burdettadam/rifare/commit/c299065241b3bdf4928a83f9ff4decf749c6afaa), which closes bounded local M20-G03 work. The presentation refresh does not implement or accept another product milestone.

## What is available now

The repository contains a modular TypeScript/Node.js commerce implementation, SQLite diagnostics, native fixture adapters, plain HTML/JavaScript interfaces, independent Python clients, and deterministic demonstration commands. Start with [Try Rifare](TRY-RIFARE.md).

| Area | Current local scope | Source of detail |
| --- | --- | --- |
| Returns and exchanges | Eligibility, paid-unit allocation, controlled resolution, fulfillment, and deeper exchange scenarios. | [Return resolution](RETURN-RESOLUTION.md) · [Exchange depth](exchange-depth.md) |
| Order changes | Approved edits, separate payment observations, warehouse holds, and original-operation recovery. | [Order editing](ORDER-EDITING.md) |
| Support and tracking | Verified context, shipment states, transactional-message fixtures, takeover, and manual handling. | [Support operations](SUPPORT-OPERATIONS.md) |
| Shipping and inventory | Packing, return events, location movements, and reconciliation through synthetic sources. | [Packing](PACKING-SESSIONS.md) · [Inventory reconciliation](INVENTORY-RECONCILIATION.md) |
| Commerce journeys | M18 local memory/readiness, composition, follow-ups, and three local continuity demonstrations. | [M18 qualification](M18-QUALIFICATION.md) · [Journey record](../work/records/M18-journey-checkpoint.md) |
| Loyalty | M19 local balances, original-unit accrual/reversal projections, redemption, incentives, and lifecycle reporting. | [M19 assessment](M19-LOCAL-ASSESSMENT.md) · [Loyalty record](../work/records/M19-loyalty-milestone.md) |
| Drop-off | M20-G01 eligibility, G02 credential lifecycle, and G03 item-level handoff acceptance/corrections. | [Drop-off guide](DROPOFF-HANDOFFS.md) · [M20 record](../work/records/M20-dropoff-milestone.md) |

These rows describe local behavior. They do not establish live platform, payment, carrier, warehouse, model, or physical-partner qualification. Individual guides retain the exact capability and unsupported-operation boundaries.

## Current checkpoint and next work

The M20-G03 implementation records which individual units a synthetic drop-off source accepted or rejected. It preserves partial intake, corrections, disputes, and original family identity across credential replacement. Handoff acceptance remains separate from consolidation, movement, warehouse receipt/inspection, stock, and settlement.

The next recorded commerce increment is **M20-G04: consolidation and custody continuity**, followed by G05 shopper experience. Those goals require their own assignment and evidence; a roadmap entry is not an instruction to begin work. See the end of [docs/PLANS.md](PLANS.md) and the [M20 work record](../work/records/M20-dropoff-milestone.md).

## What the preview does not establish

| Boundary | Current state |
| --- | --- |
| Target application | React and PostgreSQL remain the target. The runnable preview uses plain browser shells and SQLite. `npm run dev` intentionally exits instead of silently substituting a demo. |
| Connected commerce services | Fixture-backed protocols and local source records do not establish live merchant, financial, carrier, warehouse, or partner operation. |
| Model quality and portability | Local contracts, fixtures, and reader paths exist. Actual provider quality and independently qualified combinations still need evidence. |
| Remote clients and recovered history | Some local independent-client demonstrations exist. Later remote/managed/browser claims whose source was missing from recovery are not treated as recovered implementation. |
| Browser inference | M23–M25 are adopted roadmap work. This preview does not provide a qualified browser model runner, download, or image-inference experience. |
| Deployment and formal acceptance | Target-host deployment, independent installation, real pilot observations, and formal milestone gates remain open. Local review and focused tests do not close those gates. |
| Licensing | A licensing direction is selected. Exact application and distribution review remain unfinished; the repository's public visibility is not an applied software license grant. |

For the original boundaries, see [local environment](LOCAL-ENVIRONMENT.md), [M18 qualification](M18-QUALIFICATION.md), [browser handoff](BROWSER-WORKER-HANDOFF.md), [license status](../LICENSE-STATUS.md), and the per-milestone assessments.

## Reading the repository's history

The default development line is `development`. `main` is an older protected baseline; do not infer current implementation from that branch alone. Preserve the current source and Git history when continuing the project.

Several architecture, foundation, and milestone documents intentionally retain the wording of their original checkpoints. Read their date and scope alongside the latest work record and the end of [docs/PLANS.md](PLANS.md). The earlier [README at the imported checkpoint](https://github.com/burdettadam/rifare/blob/c299065241b3bdf4928a83f9ff4decf749c6afaa/README.md) remains available in Git history.

Canonical planning files and generated worker catalogues describe requirements and dependencies. Actual development outcomes belong in the [work records](../work/README.md) and [acceptance ledger](../work/accepted-goals.json). A feature inventory, milestone number, synthetic demo, or local passing check is not a production-readiness claim.
