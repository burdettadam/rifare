# What remains to build

Rifare already has substantial local commerce code. The [architecture](ARCHITECTURE.md)
maps that foundation; the [product overview](../README.md) describes the target
experience. This roadmap covers unfinished work.

## Next product increments

The delegated-checkout lane has a [customer review page](DELEGATED-CHECKOUT-REVIEW.md)
over the existing original preparation recovery contract, extended by
[RCG-5D receipt evidence review](DELEGATED-CHECKOUT-RECEIPT-REVIEW.md) through the
unchanged native API. Its 33 controller/native HTTP and fourteen actual browser
cases passed on `40fc973`; both independent reviews found no scoped blocker.
The [work record](../work/records/RCG-5D.md) binds the closing documentation to
that tested source. This bounded local increment is complete.

The [RCG-4B-C1 command consumer](DELEGATED-COMMAND-CONSUMER.md) is also complete:
strict P03 request/result binding, original recovery and receipt-byte correlation,
without transport or execution. All 42 focused cases and two separate original
Protocol-vector checks pass; both independent reviews found no scoped blocker.
The [RCG-4B-C2 journal](DELEGATED-COMMAND-CLAIMS.md) adds durable original
command/result retention and typed privacy/restore handling. Its bounded scope
is complete with 112 distinct passing cases and both independent reviews;
[the work record](../work/records/RCG-4B-C2.md) identifies actual executions and
unchanged-input equivalence after the catalog correction.
At the inspected provider snapshot `3d1f699`, the explicit default-off
`marty-delegated-use` host now assembles internal use-access, exact-operation
policy, protected Flow ingress and existing source/receipt owners with fourteen
restricted database connections and mandatory mutual TLS. Selected public
Gateway/wallet/client contracts and deployed qualification remain open. Continue with the actual RCG-4B public
transport/current-state/authenticated-namespace and native-purchase composition, full isolated RCG-5 journey
and connected RCG-6 qualification. Local checks do not qualify those boundaries
or formal acceptance.

| Area | Remaining outcome | Work entry |
| --- | --- | --- |
| Drop-off continuity | Connect accepted original units to consolidation, movement and receiving; finish accurate shopper instructions, accessibility and outage behavior. | [M20-G04/G05](../planning/milestones/M20.md) |
| Loyalty correctness | Add attributable award/reversal observations, supported multi-unit handling, bounded source retrieval, safe administrative hold resolution and remaining-balance reconciliation. | [Loyalty follow-ups](../planning/milestones/M19.md) |
| Target application | Implement and exercise the PostgreSQL/React application, including migrations, isolated resources and an actual served-browser journey. The existing SQLite/plain-browser diagnostic environment is reusable. | [Target-stack follow-up](../planning/milestones/M00.md) |
| Remote callers | Recover or implement sender-bound remote access with issuer validation, sender proof and shared replay protection. Existing local clients do not supply this trust profile. | [M15](../planning/milestones/M15.md) |
| Managed execution | Recover or implement managed execution and its isolation/operational boundaries. The reported later source is not present in this history. | [M16](../planning/milestones/M16.md) |
| Actual image assistance | Enable an authorized actual image path and measure it using a frozen independently labeled cohort. Reuse landed intake, exact access, privacy and image suppression. | [Image follow-up](../planning/milestones/M17.md) |
| Warehouse intelligence | Add route/supply workflows over existing inventory, picking, packing and procurement owners. | [M21](../planning/milestones/M21.md) |
| Individualized campaigns | Extend existing campaign, consent, approval and delivery controls with the planned individualization. | [M22](../planning/milestones/M22.md) |
| Browser decision assistance | Build and measure the browser model loader, separate client-observation boundary, compact backend and scoped image path. | [M23](../planning/milestones/M23.md) · [M24](../planning/milestones/M24.md) · [M25](../planning/milestones/M25.md) |

M20-G04 is the next recorded commerce continuation. Other lanes need a deliberate
assignment based on the intended release and available integrations. Milestone
numbers are identifiers, not a promise that every earlier gate is accepted.

## Real integrations still need code

Local state machines and fixture sources are already implemented. The following
source adapters remain engineering work, followed by qualification on the named
provider. The [integration backlog](../planning/WORKER-GOALS.md#integration-follow-ups)
keeps 27 short entries with original IDs and exact existing source paths.

| Integration family | Remaining adapter scope |
| --- | --- |
| Store, money and fulfillment | Native Shopify returns/change synchronization; refund and credit sources; replacement/stock operations; store edit/address/cancel/invoice paths; Woo return and gateway-refund sources. |
| Carrier and warehouse | Return rates/labels/tracking, outbound quotes/batches/manifests, WMS hold/update/pick state, receiving/inspection/disposition and source stock movements. |
| Exchange finance | Actual mandate, deposit and capture sources with paired currency/final-fee observations and original-operation recovery. |
| Growth and optional identity/media | Marketing segments/templates, permitted visibility collection, catalog publishing, a separately approved try-on provider and qualified identity partner. Existing messaging wire code is reusable. |
| Claims and partner services | Repair, shipping claims, processor disputes, protection, duty/tax, reverse/international logistics, HSA/FSA, network alerts and delivery-started trial sources within their approved scope. |
| Procurement and production | Supplier acknowledgments, physical purchase receiving/returns/corrections, manufacturing consumption/output/scrap and finished-stock observations. |

Shopify/WooCommerce read adapters and Chatwoot/Resend wire adapters already exist.
They need configured connected observations; rebuilding their mappings is not
the default next task. Partner-dependent features remain explicitly unavailable
until both their actual adapter and permitted operating scope exist.

## Adoption and release evidence

The remaining non-code work includes [real pilot observations](../planning/milestones/M07.md),
[governance and independent extension qualification](../planning/milestones/M12.md),
actual model/backend evaluation, connected customer journeys, target-host
installation/recovery/load, and physical-provider observations. The optional
code sandbox stays disabled unless the explicit need/risk decision authorizes it.

[Qualification](QUALIFICATION.md) is the concise list of open release obligations.
The existing thresholds, oracles, requirement criteria and dependency acceptance
rules remain intact. A retired local implementation packet is not a release pass.

## Working with this plan

The [active catalogue](../planning/WORKER-GOALS.md) and
[searchable HTML view](../planning/WORKER-GOALS.html) are generated from the
remaining canonical work. Completed packet text and the previous full roadmap
remain in Git at `d1fb45b94e14b276f7fa6e04f50173fe8cf39c77`.
See [planning maintenance](../planning/README.md) and
[the current continuation](PLANS.md) for the update workflow.
