# Rifare architecture

**Current commerce checkpoint: M20-G03 item-level drop-off handoffs.** Rifare has a
substantial local implementation spanning commerce operations, decision assistance,
shopper journeys and loyalty. Its executable development environment uses
TypeScript/Node and SQLite with synthetic source systems and plain browser
surfaces. React/PostgreSQL remains the target stack. Connected services,
independent deployment and formal product qualification remain open; see
[project status](PROJECT-STATUS.md).

This document maps the current source and the boundaries new work must preserve.
Native Git retains implementation history. [Active planning](../planning/README.md)
tracks remaining work without repeating completed implementation instructions.

## Runtime and ownership

Rifare keeps durable commerce state in its own core. Human interfaces, rules,
built-in agents and supported external callers use the same permissions, current
facts, policies, approvals and operation owners. Portable skills describe a
workflow; typed merchant profiles customize permitted fields; adapters translate
supported native operations. Model output and skill text confer no authority.

| Layer | Source entry points | Responsibility |
| --- | --- | --- |
| Application surfaces | [`apps/commerce-api/`](../apps/commerce-api/), [`apps/api/`](../apps/api/), [`apps/worker/`](../apps/worker/), [`apps/web/`](../apps/web/) | Local HTTP/browser surfaces and separate service/worker processes. Their presence does not establish the target React application. |
| Commerce core | [`packages/commerce/`](../packages/commerce/) | Tenant and resource authority, business state, workflow composition, exact approvals, durable operations and privacy. |
| Adapters and source contracts | [`packages/adapters/`](../packages/adapters/), [`packages/conformance/`](../packages/conformance/) | Platform/provider translation, explicit capabilities and contract checks. Most write paths currently bind synthetic fixture sources. Shopify/WooCommerce read and Chatwoot/Resend wire mappings also exist; connected qualification is separate. |
| Agents and skills | [`packages/agent/`](../packages/agent/), [`packages/commerce/skill-bundles/`](../packages/commerce/skill-bundles/), [`clients/`](../clients/) | Replaceable runtimes/providers, bounded model requests, reusable workflow resources and protocol clients. Existing local clients do not implement the missing M15 remote trust profile. |
| Development and storage | [`packages/development/`](../packages/development/), [`migrations/`](../migrations/), [`tools/dev-target.mts`](../tools/dev-target.mts) | Local fixture lifecycle, transactional SQLite persistence and an explicit target-stack qualification guard. Separate synthetic source databases preserve the distinction between core state and provider observations. |

See [skill architecture](SKILL-ARCHITECTURE.md), [policy customization](POLICY-CUSTOMIZATION.md)
and [development](DEVELOPMENT.md) for composition rules and runnable entry points.

## Current domain map

Source paths below are entry points into existing owners, not independent services
to duplicate. Versioned contracts live beside the implementation in
[`packages/commerce/contracts/`](../packages/commerce/contracts/) and
[`packages/agent/contracts/`](../packages/agent/contracts/).

| Domain | Current source owners | Design reference |
| --- | --- | --- |
| Authority and durable execution | `kernel.mts`, `authorization.mts`, `action-gateway.mts`, `case-configurations.mts`, `durable-work.mts`, `work-leases.mts`, `operation-store.mts`, `operation-receipts.mts` in `packages/commerce/` | [Operation reliability](OPERATION-RELIABILITY.md) |
| Returns, exchanges and edits | `return-intake.mts`, `resolution-execution.mts`, `fulfillment-execution.mts`, `return-receiving.mts`, `exchange-lineage.mts`, `instant-exchanges.mts`, `order-edit-execution.mts` | [Return resolution](RETURN-RESOLUTION.md), [exchange depth](exchange-depth.md), [order editing](ORDER-EDITING.md) |
| Support and delivery | `support-service.mts`, `support-conversations.mts`, `support-delivery.mts`, `support-consent.mts`, `model-budgets.mts` | [Support operations](SUPPORT-OPERATIONS.md) |
| Shipping, warehouses and inventory | `shipping-batch-labels.mts`, `packing-sessions.mts`, `warehouse-connector.mts`, `location-inventory.mts`, `inventory-transfers.mts` | [Packing](PACKING-SESSIONS.md), versioned shipping/warehouse/inventory contracts |
| Shopping and growth | `shopping-cart.mts`, `checkout-experiments.mts`, `growth-campaigns.mts`, `catalog-growth.mts` | Versioned cart, campaign, delivery and growth contracts |
| Partners and procurement | `partner-readiness.mts`, `warranty-claims.mts`, `dispute-submissions.mts`, `delivery-trials.mts`, `replenishment-planning.mts`, `purchase-receiving.mts`, `production-orders.mts` | Versioned partner, claims, inventory-planning and procurement contracts |
| Extension and agency control | `agency-access.mts`, `shared-templates.mts`, `extension-artifacts.mts`, `extension-compatibility.mts`; `packages/security/code-execution-decision.mts` | [Skill architecture](SKILL-ARCHITECTURE.md); generated-code execution remains disabled |
| Decision assistance and routing | `packages/agent/decisions.mts`, `workers-ai.mts`, `systemone.mts`, `decision-calibration.mts`; commerce `decision-resources.mts`, `decision-shadow.mts`, `decision-routing.mts` | [Decision contracts](DECISION-MODELS.md), [shadow observations](DECISION-SHADOW.md), [routing](DECISION-ROUTING.md) |
| Image evidence and suppression | `image-assistance.mts`, `image-resources.mts`, `image-privacy.mts`, `image-suppression.mts`; `packages/agent/image-reader.mts` | [Image assistance](IMAGE-ASSISTANCE.md), [image suppression](IMAGE-SUPPRESSION.md) |
| Shopper continuity | `shopper-memory.mts`, `journey-readiness.mts`, `commerce-journeys.mts`, `journey-followups.mts` and their privacy/record modules | [Memory](SHOPPER-MEMORY.md), [journeys](COMMERCE-JOURNEYS.md), [follow-ups](JOURNEY-FOLLOWUPS.md) |
| Loyalty | `loyalty-balances.mts`, `loyalty-accrual.mts`, `loyalty-redemptions.mts`, `loyalty-incentives.mts`, `loyalty-lifecycle.mts` | [Redemption](LOYALTY-REDEMPTION.md), [incentives and lifecycle](LOYALTY-INCENTIVES-LIFECYCLE.md), [remaining scope](M19-LOCAL-ASSESSMENT.md) |
| Drop-off returns | `dropoff-choices.mts`, `dropoff-credentials.mts`, `dropoff-handoffs.mts` and their privacy/record modules; existing `InternationalHandoffs` custody owner | [Eligibility](DROPOFF-ELIGIBILITY.md), [credentials](DROPOFF-CREDENTIALS.md), [item handoffs](DROPOFF-HANDOFFS.md) |

Unless a different package is named, module filenames in this table are under
`packages/commerce/`. Privacy, recovery and portability cross these domains through
`privacy-lifecycle.mts`, `privacy-coverage.mts`, `safe-recovery.mts` and
`merchant-portability.mts`; see [merchant portability](MERCHANT-PORTABILITY.md).

## Boundaries that compose the platform

**Business effects have native owners.** A supported action starts with verified
intent and current facts, passes policy evaluation and preview, obtains the
required approval, then rechecks current authority before execution. Tenant,
store, resource, customer proof, case ownership and configuration bindings remain
in force through asynchronous work. New journey, loyalty or media projections
reuse those checks rather than granting callers additional actions.

**Each stage keeps its own evidence.** Return authorization, drop-off acceptance,
warehouse receipt, inspection, stock movement, financial settlement and replacement
fulfillment are distinct. A created replacement does not prove delivery; a
confirmed cart does not prove payment; a provider-accepted message does not prove
customer delivery. Handoff corrections retain original unit and event identities
across credential replacement. No elapsed time, model answer or summary projection
can advance an unobserved stage.

**An unknown outcome retains its identity.** Durable work, approvals, receipts and
applicable reservations bind the original operation. Timeouts, restarts, handovers,
expired local reservations or new request keys cannot authorize a duplicate
uncertain effect. Reconciliation queries the original source identity. Execution
stops, current ownership generations and revocation fence stale work and late
results; manual handling remains available within its ordinary authority.

**Personal data follows its lifecycle across projections.** Memory, image records,
journey follow-ups, loyalty and handoff records participate in scoped export,
correction, retention, erasure and holds. Restore/import applies current suppression
and invalidates copied authority before any continuation. Individual-image
suppression is implemented, including replay of older backups with a separately
retained current checkpoint. Logical suppression does not destroy old archives,
provider copies or caller-held data. Held evidence keeps its retention duties and
does not retain permission to process or send it.

**Model observations stay separate from action authority.** Typed decision results
validate finite answers against published questions. The server owns authorized
evidence preparation, vault access, budgets, provenance, receipt identity and
current-state rechecks. M13 supplies shadow observations; M14 adds calibrated-route
intake and bounded diagnostic activation, canaries and rollback. Their local
fixtures do not establish measured model quality or live backend portability.
Image assistance is an opt-in, exact-version PNG usability path with advisory
results and explicit cannot-assess handling; audio/video remain disabled. Its
reader is fixture-only, and its qualification API reports pending actual inference.

## Remaining implementation and qualification

Completed local implementations are the foundation for the following work. The
[active plan](../planning/README.md) identifies remaining scopes and exact outstanding criteria.

| Work remaining | Architectural constraint |
| --- | --- |
| Sender-bound remote access and managed execution (M15/M16) | Later reported checkpoints are absent from recovered Git history. Recover/reconcile source or implement under a new assignment. Existing loopback grants do not supply issuer validation, sender proof, shared replay protection or operating-system isolation. |
| Complete loyalty reconciliation | Add attributable provider award/reversal observations tied to original orders/units, duplicate/unknown handling and remaining-balance reconciliation. Current lifecycle reports retain missing-evidence exceptions and null valuation. Multi-unit/store-credit scope, bounded source retrieval and administrative resolution of retained holds without a source binding also remain open. |
| Consolidation and shopper drop-off (M20-G04/G05) | Extend the existing custody owner with original-unit batch/movement/receiving references; preserve missing/disputed evidence. Add accurate instructions, accessibility and outage behavior, then qualify the actual method and its financial trigger. |
| Warehouse routes/supplies and individualized campaigns (M21/M22) | Build on existing inventory, picking/packing, procurement, campaign approval, consent and dispatch owners. Those later workflows are not implemented by the current foundations. |
| Browser inference (M23–M25) | The model loader, browser observation boundary, compact backend and image path are unimplemented here. Keep client-reported output distinct from trusted server inference; reuse question and privacy contracts without exporting vault capabilities or silently enabling hosted fallback. Detailed target design stays in the [browser worker handoff](BROWSER-WORKER-HANDOFF.md). |
| Target application and real integrations | Implement and qualify the React/PostgreSQL deployment and missing real write/source adapters. Qualify configured platform reads, messaging, model backends, physical providers and supported installation/recovery combinations. |

Qualification remains a distinct body of work. [M13](M13-QUALIFICATION.md) and
[M14](M14-QUALIFICATION.md) retain actual model/cohort and backend-comparison
obligations. Image assistance needs an authorized actual processing path, a frozen
independently labeled cohort and privacy/host evidence. [M18](M18-QUALIFICATION.md)
still needs the independent remote caller and complete merchant/channel journeys.
[M19](M19-LOCAL-ASSESSMENT.md) and the drop-off guides retain provider, physical and
formal assessment gaps. Required pilot, inherited milestone, target-host and
release evidence cannot be supplied by fixture tests or source review.

Keep executable tests, independent oracles, versioned contracts and accepted
behavior intact when retiring completed planning. Development and release gates
remain governed by [development](DEVELOPMENT.md) and [governance](GOVERNANCE.md).
The consolidated [qualification guide](QUALIFICATION.md) keeps unresolved
evidence visible without retaining completed milestone instructions.
