![Rifare — merchant-owned commerce operations](docs/assets/rifare-hero.png)

# Commerce operations, on your terms.

**Rifare is building a merchant-owned platform for returns, exchanges, order changes, support, fulfillment, and repeat business.** Your policies shape the experience. Your business records stay under your control. Your choice of agents and models can change as your business grows.

Start with what happens after checkout. Connect it to the warehouse, the next conversation, and the next sale.

[Explore the product](#the-product-we-are-building) · [Run the preview](#try-rifare) · [Explore the architecture](#built-to-give-merchants-control) · [Follow the roadmap](docs/ROADMAP.md)

> **Development preview.** The capabilities below describe Rifare's target product. Runnable local implementations are available today; connected services and production qualification are still in development. [See what runs now →](docs/PROJECT-STATUS.md)

## The product we are building

Rifare targets technically capable merchants, commerce teams, and agencies that want a connected operation they can tailor and extend. The roadmap starts with post-purchase workflows and expands into fulfillment, retention, and inventory planning on the same foundation.

### Returns that give every item the right outcome

Build the return experience around the merchant's rules and the customer's options.

- **Refund, exchange, or store credit by item.** Combine outcomes within a return; preserve original paid value, discounts, and the remaining balance.
- **More ways to keep the sale.** Variant and catalog exchanges, stock-aware alternatives, incentives, and conditional instant exchanges.
- **Policies that fit the business.** Return windows, product and customer attributes, partial bundles, returnless decisions, evidence requests, and exception review.
- **A complete resolution journey.** Branded self-service intake, return labels, receipt and inspection, disposition, settlement, and replacement fulfillment.

[Return resolution](docs/RETURN-RESOLUTION.md) · [Exchange depth](docs/exchange-depth.md) · [Capability targets](planning/capability-targets.json)

### Order changes that reach the warehouse

Give customers a way to correct an order while there is still time to act.

- **Eligible self-service edits.** Address, item, variant, discount, and cancellation flows with clear action windows.
- **Payment-aware changes.** Quote differences, collect an additional balance when supported, and retain holds until the order is ready.
- **Fulfillment coordination.** Recheck the current order and downstream hold state before release; keep packing and shipping aligned with the approved edit.
- **Earlier intervention.** Detect potential multi-size over-ordering and propose customer-approved changes before fulfillment.

[Order editing](docs/ORDER-EDITING.md) · [Product roadmap](docs/ROADMAP.md)

### Support that carries the relationship forward

Give each conversation the order context, available actions, and history it needs.

- **Service and action together.** Source-backed order answers, individual shipment tracking, returns, exchanges, edits, and a clear human handoff.
- **Merchant-directed automation.** Copilot and bounded autonomous modes, published rules, inbox routing, waits, triggers, and escalation.
- **Continuity across visits and channels.** Verified shopper context and durable journey records reconnect a later conversation to the original work.
- **Loyalty that follows the purchase.** Earning, reversals, redemption, and recovery incentives stay connected to edits, exchanges, and returns.

[Support operations](docs/SUPPORT-OPERATIONS.md) · [Commerce journeys](docs/COMMERCE-JOURNEYS.md) · [Loyalty](docs/LOYALTY-REDEMPTION.md)

### Fulfillment and reverse logistics, connected

Track the goods as carefully as the customer conversation.

- **Merchant-owned shipping relationships.** Rate comparisons, carrier and service rules, label workflows, customs information, and tracking.
- **Item-level return custody.** Qualified drop-off sites, QR or equivalent credentials, partial acceptance, corrections, disputes, and onward movement.
- **Warehouse execution.** Order batching, scan-to-pack, packing slips, location transfers, receipt, inspection, and stock reconciliation.
- **Warehouse intelligence.** Planned layout-aware routes, coordinated pick waves, picker-to-packer handoffs, and supplies replenishment.

[Packing](docs/PACKING-SESSIONS.md) · [Drop-off handoffs](docs/DROPOFF-HANDOFFS.md) · [Warehouse roadmap](planning/milestones/M21.md)

### Growth grounded in the actual customer journey

Use permitted commerce context to make the next interaction useful.

- **Shopping and recovery.** Conversational product discovery, cart proposals, rescue offers, and conditional post-payment upsells.
- **Campaigns with context.** Email and SMS integrations, reviewable per-recipient variants, approved offers, and final-send consent and purchase checks.
- **Measurable experiments.** Test offers, shipping, and messages; connect attribution and results to the experiment that produced them.
- **Catalog intelligence.** Analyze return reasons, identify product or variant issues, and improve catalog accuracy and visibility in AI-assisted discovery.

[Growth and shopping](docs/GROWTH-SHOPPING.md) · [Individualized campaigns](planning/milestones/M22.md)

### Inventory and purchasing informed by operations

Carry the consequences of sales, returns, and warehouse activity into the next buying decision.

- **Planning and replenishment.** Demand forecasts, reorder proposals, multi-location stock, and purchase orders.
- **Procurement assistance.** Natural-language purchase-order drafts and edits with explicit confirmation.
- **Production and economics.** Bills of materials, assembly, landed cost, and item-level profitability.

[Inventory and procurement](docs/PROCUREMENT-INVENTORY.md) · [Inventory reconciliation](docs/INVENTORY-RECONCILIATION.md)

The wider scope also includes **warranty registration and claims, dispute evidence and deadlines, cross-border services, local return hubs, and agency/multi-store operations**. Conditional payment features and physical or regulated services depend on qualified integrations and partners. The [capability catalogue](planning/capability-targets.json) records those boundaries.

## One journey, from return to repeat purchase

The target experience connects these capabilities around the same business records:

1. A shopper requests a different size and sees eligible replacement options.
2. The merchant's policy determines the quote, evidence, approval, and fulfillment conditions.
3. A supported drop-off records the units actually handed over; the customer can follow their progress.
4. Receipt, inspection, stock, settlement, and replacement fulfillment advance through their own recorded stages.
5. Loyalty and any permitted follow-up reflect the resulting purchase and return history.

A later support interaction should pick up that history—even when another team member, channel, agent, or model takes over. That continuity is the purpose of the [commerce journey design](docs/COMMERCE-JOURNEYS.md).

## Built to give merchants control

The product scope rests on a few deliberate architectural choices.

| Choice | What it means for a merchant |
| --- | --- |
| **Merchant-owned business state** | Cases, policies, approvals, operation identities, and receipts live in the commerce core, so changing an AI provider does not mean rebuilding the operational history. |
| **Portable workflows and profiles** | Reusable skills describe the work; validated profiles tailor policy, language, and permitted settings to each merchant. |
| **Independent integration boundaries** | Platform adapters, model providers, and agent runtimes have separate contracts, so each can evolve without redefining the order or return. |
| **Optional AI** | Human and deterministic paths are part of the design. Models can assist with decisions and drafts while the core governs permitted actions. |
| **Current checks before execution** | Sensitive actions use previews, required approvals, and fresh identity, policy, and source-state checks. |
| **Recovery built into the operation** | An uncertain result retains its original identity and reservations until reconciliation establishes what happened. |

The AI roadmap extends from optional decision models and measured routing to **opt-in image evidence assistance and on-device browser inference**. Browser inference is planned work; this checkout does not ship a browser model download. Each mode retains the same merchant-controlled action boundary.

[Architecture](docs/ARCHITECTURE.md) · [Skill architecture](docs/SKILL-ARCHITECTURE.md) · [Operation reliability](docs/OPERATION-RELIABILITY.md) · [Merchant portability](docs/MERCHANT-PORTABILITY.md)

## Try Rifare

Run a small return-resolution demonstration today. It uses synthetic orders entirely in memory and needs no API key, model download, Docker, or external account.

**Prerequisites:** Git and Node.js **24.x**, or **22.16+ within 22.x**, with npm. Supported versions are declared in [package.json](package.json).

```sh
git clone --branch development https://github.com/burdettadam/rifare.git
cd rifare
npm ci --offline --ignore-scripts
node --experimental-strip-types tools/demo-return-resolution.mts
```

The demo allocates one return across a refund, store credit, and an exchange quotation. It deliberately loses a refund response, then reconciles the original operation:

```text
after_lost_response: "unknown"
after_lookup: "accepted"
send_attempts: 1
external_calls: 0
production_qualified: false
```

The separate fixture settlement step does not move real money; the exchange remains a quotation. The output makes the recovery behavior visible without an external integration.

For an interactive support and shipment-tracking view:

```sh
node --experimental-strip-types tools/demo-support.mts --serve
```

Open the printed URL and follow the [local session instructions](docs/TRY-RIFARE.md#open-the-support-and-tracking-views). The guide also covers policy customization, recovery demonstrations, and the basic smoke environment. `npm run dev` intentionally exits until the target application stack is qualified; use the explicit demo commands above.

## What runs now, and what comes next

The repository contains **TypeScript/Node.js and SQLite development implementations**, with the current commerce checkpoint at **M20-G03: item-level drop-off handoffs**. Local work covers returns, order editing, support, shipping, inventory, customer journeys, loyalty, and drop-off foundations.

The next recorded commerce increment is consolidation and custody continuity. Connected-provider deployments, physical-service qualification, the target React/PostgreSQL application, and production release remain open. Local progress and product qualification are tracked separately in the [current status guide](docs/PROJECT-STATUS.md).

## Explore the project

| Start here | What you will find |
| --- | --- |
| [Documentation index](docs/README.md) | Product guides and a concise repository map |
| [Try Rifare](docs/TRY-RIFARE.md) | Runnable demos, session setup, and expected results |
| [Product roadmap](docs/ROADMAP.md) | Target functionality, sequencing, and capability boundaries |
| [Architecture](docs/ARCHITECTURE.md) | The core, portable skills, integrations, and AI execution modes |
| [Project status](docs/PROJECT-STATUS.md) | Current source, implemented local scope, and remaining qualification |
| [Development guide](docs/DEVELOPMENT.md) | Contributor setup and focused local checks |
| [Brand assets](docs/BRAND.md) | Logo, hero artwork, and social preview |

### License

License application is still in progress. The selected direction is AGPL-3.0-only for the application and Apache-2.0 for separable SDKs, skills, and original developer documentation; it is not yet an applied grant. See [license status](LICENSE-STATUS.md) and [third-party notices](THIRD-PARTY-NOTICES.md).

**Star Rifare to follow a merchant-owned approach to commerce operations.** [Browse the latest development →](https://github.com/burdettadam/rifare/commits/development/)
