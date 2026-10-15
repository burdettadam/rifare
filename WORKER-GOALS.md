# Rifare — AI-worker goal catalogue

**Planning date:** October 15, 2026. **State:** proposed, not implemented.

190 bounded worker goals + 13 integration/acceptance gates = **203 goal packets**. **676 acceptance/regression specifications** include all 67 original scenarios. All 151 original requirements are preserved and mapped; their acceptance criteria are retained verbatim.

Each linked packet includes dependencies, allowed ownership, explicit success/negative/regression assertions, a deliberate fault to detect, source requirement links and required evidence. Product tests remain not run.

## How to dispatch

Read `docs/WORKER-CONTRACT.md`, inspect the actual repository and installed git-agent version, then hand a worker one dependency-ready packet. Start with **M00-G01**. Use existing worktrees, test commands and reviewers; do not build another scheduler. Dependency readiness does not authorize spending, production writes or publication.

**First competitive v1:** M07. M08–M12 are broader suite expansion; M11 also depends on M08. Optional partner/code-mode capability must be explicitly qualified or remain excluded/disabled.

## Milestone index

| Milestone | Outcome | Worker goals | Acceptance gate |
|---|---|---:|---|

| [M00](milestones/M00.md) | Product charter and reproducible development | 8 | [M00-G99](goals/M00/M00-G99.md) |

| [M01](milestones/M01.md) | Agent-neutral walking skeleton | 18 | [M01-G99](goals/M01/M01-G99.md) |

| [M02](milestones/M02.md) | Tailorable skills and safe action execution | 27 | [M02-G99](goals/M02/M02-G99.md) |

| [M03](milestones/M03.md) | Complete returns and exchanges | 21 | [M03-G99](goals/M03/M03-G99.md) |

| [M04](milestones/M04.md) | Safe order editing and cancellation | 11 | [M04-G99](goals/M04/M04-G99.md) |

| [M05](milestones/M05.md) | Support, tracking and controlled autonomy | 16 | [M05-G99](goals/M05/M05-G99.md) |

| [M06](milestones/M06.md) | Competitive return depth | 14 | [M06-G99](goals/M06/M06-G99.md) |

| [M07](milestones/M07.md) | Portable, operable open-source v1 | 18 | [M07-G99](goals/M07/M07-G99.md) |

| [M08](milestones/M08.md) | Shipping and warehouse operations | 10 | [M08-G99](goals/M08/M08-G99.md) |

| [M09](milestones/M09.md) | Conversion, marketing and catalog skills | 14 | [M09-G99](goals/M09/M09-G99.md) |

| [M10](milestones/M10.md) | Warranty, dispute and cross-border workflows | 14 | [M10-G99](goals/M10/M10-G99.md) |

| [M11](milestones/M11.md) | Inventory and procurement | 10 | [M11-G99](goals/M11/M11-G99.md) |

| [M12](milestones/M12.md) | Ecosystem and multi-store operations | 9 | [M12-G99](goals/M12/M12-G99.md) |

## M00 — Product charter and reproducible development

Establish a buildable project and an accepted product boundary before implementation becomes a collection of unrelated agent experiments.

**Prerequisite milestone gates:** None.

| Goal | Deliverable | Dependencies | Proof mode |
|---|---|---|---|

| [M00-G01](goals/M00/M00-G01.md) | Freeze the first-release support envelope |  | human_decision |

| [M00-G02](goals/M00/M00-G02.md) | Freeze benchmarks, denominators and pilot responsibilities | M00-G01 | human_decision |

| [M00-G03](goals/M00/M00-G03.md) | Record component licensing and publication boundaries | M00-G01 | human_decision |

| [M00-G04](goals/M00/M00-G04.md) | Adopt the installed git-agent workflow | M00-G01 | human_decision |

| [M00-G05](goals/M00/M00-G05.md) | Start an isolated modular-monolith development environment | M00-G04 | local |

| [M00-G06](goals/M00/M00-G06.md) | Establish deterministic fixtures and ordinary test runners | M00-G05, M00-G02 | local |

| [M00-G07](goals/M00/M00-G07.md) | Implement permanent regression obligations and a trusted-baseline gate | M00-G06 | local |

| [M00-G08](goals/M00/M00-G08.md) | Implement commit-bound evidence and acceptance checks | M00-G06, M00-G07 | local |

| [M00-G99](goals/M00/M00-G99.md) | Accept the integrated M00 milestone | All milestone worker goals + prior milestone gates | milestone_acceptance |

## M01 — Agent-neutral walking skeleton

Prove the differentiator in a narrow useful workflow: authenticated order-status assistance through interchangeable interfaces.

**Prerequisite milestone gates:** M00-G99

| Goal | Deliverable | Dependencies | Proof mode |
|---|---|---|---|

| [M01-G01](goals/M01/M01-G01.md) | Implement tenant-scoped canonical resources | M00-G99 | local |

| [M01-G02](goals/M01/M01-G02.md) | Verify customer ownership before order access | M01-G01, M00-G99 | local |

| [M01-G03](goals/M01/M01-G03.md) | Store model and commerce secrets behind opaque references | M01-G01, M00-G99 | local |

| [M01-G04](goals/M01/M01-G04.md) | Expose an evidence-backed capability registry | M01-G01, M00-G99 | local |

| [M01-G05](goals/M01/M01-G05.md) | Build a synthetic store adapter with controllable failures | M01-G01, M01-G04, M00-G99 | local |

| [M01-G06](goals/M01/M01-G06.md) | Read Shopify test-store orders and shipments | M01-G02, M01-G03, M01-G04, M01-G05, M00-G99 | connected_test |

| [M01-G07](goals/M01/M01-G07.md) | Retrieve knowledge with tenant and source provenance | M01-G01, M01-G05, M00-G99 | local |

| [M01-G08](goals/M01/M01-G08.md) | Load one portable order-status skill through files and tools | M01-G04, M01-G07, M00-G99 | local |

| [M01-G09](goals/M01/M01-G09.md) | Apply two merchant profiles without duplicating the base skill | M01-G08, M01-G02, M00-G99 | local |

| [M01-G10](goals/M01/M01-G10.md) | Expose the canonical read contract to independent REST clients | M01-G02, M01-G04, M01-G05, M00-G99 | local |

| [M01-G11](goals/M01/M01-G11.md) | Expose permitted reads through MCP | M01-G10, M01-G03, M00-G99 | local |

| [M01-G12](goals/M01/M01-G12.md) | Deliver a useful manual order-status screen | M01-G10, M01-G06, M00-G99 | local |

| [M01-G13](goals/M01/M01-G13.md) | Implement a provider-neutral built-in read runner | M01-G08, M01-G10, M01-G03, M00-G99 | connected_test |

| [M01-G14](goals/M01/M01-G14.md) | Qualify a second independent model provider | M01-G13, M01-G09, M00-G99 | connected_test |

| [M01-G15](goals/M01/M01-G15.md) | Prove a separately implemented external runtime | M01-G10, M01-G11, M01-G08, M00-G99 | connected_test |

| [M01-G16](goals/M01/M01-G16.md) | Run the local-model compatibility spike | M01-G13, M00-G99 | connected_test |

| [M01-G17](goals/M01/M01-G17.md) | Deny authority from hostile customer and retrieved content | M01-G07, M01-G11, M01-G13, M00-G99 | local |

| [M01-G18](goals/M01/M01-G18.md) | Build source-checked evaluations instead of prose similarity scores | M01-G12, M01-G14, M01-G15, M01-G17, M00-G99 | local |

| [M01-G99](goals/M01/M01-G99.md) | Accept the integrated M01 milestone | All milestone worker goals + prior milestone gates | milestone_acceptance |

## M02 — Tailorable skills and safe action execution

Make skills configurable without weakening authorization, and establish the write-safety boundary before real financial operations.

**Prerequisite milestone gates:** M01-G99

| Goal | Deliverable | Dependencies | Proof mode |
|---|---|---|---|

| [M02-G01](goals/M02/M02-G01.md) | Implement roles and server-side permission decisions | M01-G99 | local |

| [M02-G02](goals/M02/M02-G02.md) | Create currency-aware money and allocation primitives | M01-G99 | local |

| [M02-G03](goals/M02/M02-G03.md) | Version structured policies and their authority | M02-G01, M01-G99 | local |

| [M02-G04](goals/M02/M02-G04.md) | Define and validate the commerce skill manifest | M01-G99 | local |

| [M02-G05](goals/M02/M02-G05.md) | Compose profile layers deterministically with provenance | M02-G03, M02-G04, M01-G99 | local |

| [M02-G06](goals/M02/M02-G06.md) | Build a profile editor and scenario simulator | M02-G05, M01-G99 | local |

| [M02-G07](goals/M02/M02-G07.md) | Install skill bundles without implicit code or network authority | M02-G04, M01-G99 | local |

| [M02-G08](goals/M02/M02-G08.md) | Pin the complete effective configuration to each case | M02-G05, M02-G07, M01-G99 | local |

| [M02-G09](goals/M02/M02-G09.md) | Publish, canary, roll back and revoke skills | M02-G06, M02-G08, M02-G01, M01-G99 | local |

| [M02-G10](goals/M02/M02-G10.md) | Route every proposed write through one action gateway | M02-G01, M02-G03, M02-G05, M01-G99 | local |

| [M02-G11](goals/M02/M02-G11.md) | Bind approvals to exact previews and resource versions | M02-G10, M02-G02, M02-G08, M01-G99 | local |

| [M02-G12](goals/M02/M02-G12.md) | Authenticate and persist incoming webhooks | M02-G01, M01-G99 | local |

| [M02-G13](goals/M02/M02-G13.md) | Deduplicate events and reject stale state transitions | M02-G12, M01-G99 | local |

| [M02-G14](goals/M02/M02-G14.md) | Dispatch durable work with bounded safe retries | M02-G13, M01-G99 | local |

| [M02-G15](goals/M02/M02-G15.md) | Persist idempotent business operations and ambiguous outcomes | M02-G11, M02-G14, M01-G99 | local |

| [M02-G16](goals/M02/M02-G16.md) | Reconcile missing events and authoritative drift | M02-G15, M02-G13, M01-G99 | local |

| [M02-G17](goals/M02/M02-G17.md) | Record minimized immutable operation receipts | M02-G15, M01-G99 | local |

| [M02-G18](goals/M02/M02-G18.md) | Fence external workers with leases and deadlines | M02-G15, M02-G01, M01-G99 | local |

| [M02-G19](goals/M02/M02-G19.md) | Publish portable task envelopes and proposal/receipt contracts | M02-G18, M02-G17, M02-G08, M01-G99 | local |

| [M02-G20](goals/M02/M02-G20.md) | Rotate credentials and revoke access during active work | M02-G18, M01-G99 | local |

| [M02-G21](goals/M02/M02-G21.md) | Add kill switches without disabling safe reconciliation | M02-G18, M02-G16, M01-G99 | local |

| [M02-G22](goals/M02/M02-G22.md) | Give operators an actionable exception queue | M02-G16, M02-G17, M02-G21, M01-G99 | local |

| [M02-G23](goals/M02/M02-G23.md) | Block autonomy until integration readiness is proven | M02-G10, M02-G11, M02-G21, M01-G99 | local |

| [M02-G24](goals/M02/M02-G24.md) | Implement privacy lifecycle for current storage surfaces | M02-G17, M02-G19, M01-G99 | local |

| [M02-G25](goals/M02/M02-G25.md) | Restore backups with live egress and writes disabled | M02-G14, M02-G17, M02-G20, M01-G99 | local |

| [M02-G26](goals/M02/M02-G26.md) | Challenge canonical assumptions with WooCommerce reads | M02-G23, M01-G99 | connected_test |

| [M02-G27](goals/M02/M02-G27.md) | Demonstrate a safe configurable return draft across callers | M02-G19, M02-G22, M02-G23, M02-G24, M02-G25, M01-G99 | local |

| [M02-G99](goals/M02/M02-G99.md) | Accept the integrated M02 milestone | All milestone worker goals + prior milestone gates | milestone_acceptance |

## M03 — Complete returns and exchanges

Replace the basic return workflow for a tightly defined merchant configuration.

**Prerequisite milestone gates:** M02-G99

| Goal | Deliverable | Dependencies | Proof mode |
|---|---|---|---|

| [M03-G01](goals/M03/M03-G01.md) | Evaluate return eligibility at item and quantity boundaries | M02-G99 | local |

| [M03-G02](goals/M03/M03-G02.md) | Accept evidence uploads safely and with retention | M03-G01, M02-G99 | local |

| [M03-G03](goals/M03/M03-G03.md) | Build the branded self-service return flow | M03-G01, M03-G02, M02-G99 | local |

| [M03-G04](goals/M03/M03-G04.md) | Review evidence and approve explicit policy overrides | M03-G02, M03-G03, M02-G99 | local |

| [M03-G05](goals/M03/M03-G05.md) | Create and link native return records | M03-G04, M02-G99 | connected_test |

| [M03-G06](goals/M03/M03-G06.md) | Allocate mixed item outcomes without over-resolution | M03-G01, M02-G99 | local |

| [M03-G07](goals/M03/M03-G07.md) | Quote refunds from paid allocations and current facts | M03-G06, M02-G99 | local |

| [M03-G08](goals/M03/M03-G08.md) | Execute and reconcile refunds without duplicate effects | M03-G05, M03-G07, M02-G99 | connected_test |

| [M03-G09](goals/M03/M03-G09.md) | Resolve returns using supported store-credit instruments | M03-G06, M03-G07, M02-G99 | connected_test |

| [M03-G10](goals/M03/M03-G10.md) | Quote stock-aware variant exchanges | M03-G06, M02-G99 | local |

| [M03-G11](goals/M03/M03-G11.md) | Reserve replacement inventory under concurrency | M03-G10, M02-G99 | local |

| [M03-G12](goals/M03/M03-G12.md) | Create and track one replacement order per exchange | M03-G05, M03-G11, M02-G99 | connected_test |

| [M03-G13](goals/M03/M03-G13.md) | Quote and purchase return labels separately | M03-G05, M02-G99 | connected_test |

| [M03-G14](goals/M03/M03-G14.md) | Void, expire and replace labels without losing reimbursement state | M03-G13, M02-G99 | connected_test |

| [M03-G15](goals/M03/M03-G15.md) | Track carrier movement separately from warehouse receipt | M03-G13, M02-G99 | local |

| [M03-G16](goals/M03/M03-G16.md) | Receive and grade expected versus actual returned items | M03-G05, M03-G15, M02-G99 | local |

| [M03-G17](goals/M03/M03-G17.md) | Apply explicit item disposition with inventory receipts | M03-G16, M02-G99 | local |

| [M03-G18](goals/M03/M03-G18.md) | Cancel or expire returns without undoing completed money | M03-G14, M03-G11, M03-G08, M02-G99 | local |

| [M03-G19](goals/M03/M03-G19.md) | Ship a portable handle-return skill | M03-G03, M03-G04, M03-G05, M03-G08, M03-G18, M02-G99 | local |

| [M03-G20](goals/M03/M03-G20.md) | Ship a portable exchange skill | M03-G10, M03-G11, M03-G12, M03-G19, M02-G99 | local |

| [M03-G21](goals/M03/M03-G21.md) | Synchronize native changes without duplicating return work | M03-G08, M03-G12, M03-G17, M02-G99 | connected_test |

| [M03-G99](goals/M03/M03-G99.md) | Accept the integrated M03 milestone | All milestone worker goals + prior milestone gates | milestone_acceptance |

## M04 — Safe order editing and cancellation

Prevent avoidable returns and support contacts without shipping stale or unpaid orders.

**Prerequisite milestone gates:** M03-G99

| Goal | Deliverable | Dependencies | Proof mode |
|---|---|---|---|

| [M04-G01](goals/M04/M04-G01.md) | Evaluate edit eligibility by action and fulfillment line | M03-G99 | local |

| [M04-G02](goals/M04/M04-G02.md) | Qualify real downstream fulfillment holds | M04-G01, M03-G99 | connected_test |

| [M04-G03](goals/M04/M04-G03.md) | Track independent fulfillment hold reasons | M04-G02, M03-G99 | local |

| [M04-G04](goals/M04/M04-G04.md) | Preview and commit safe address changes | M04-G01, M04-G03, M03-G99 | connected_test |

| [M04-G05](goals/M04/M04-G05.md) | Commit equal-value line changes with native edit semantics | M04-G01, M04-G03, M03-G99 | connected_test |

| [M04-G06](goals/M04/M04-G06.md) | Reconcile cheaper edits and their refunds independently | M04-G05, M03-G99 | connected_test |

| [M04-G07](goals/M04/M04-G07.md) | Create additional-payment obligations and invoices | M04-G05, M04-G03, M03-G99 | connected_test |

| [M04-G08](goals/M04/M04-G08.md) | Handle paid, unpaid and expired edit balances | M04-G07, M03-G99 | connected_test |

| [M04-G09](goals/M04/M04-G09.md) | Cancel orders consistently across all shippable systems | M04-G01, M04-G03, M03-G99 | connected_test |

| [M04-G10](goals/M04/M04-G10.md) | Release only reconciled product-owned holds | M04-G04, M04-G06, M04-G08, M04-G09, M03-G99 | connected_test |

| [M04-G11](goals/M04/M04-G11.md) | Ship the safe-edit skill and manual recovery flow | M04-G10, M03-G99 | local |

| [M04-G99](goals/M04/M04-G99.md) | Accept the integrated M04 milestone | All milestone worker goals + prior milestone gates | milestone_acceptance |

## M05 — Support, tracking and controlled autonomy

Deliver a complete customer experience around the operational actions rather than a stand-alone chat demo.

**Prerequisite milestone gates:** M03-G99, M04-G99

| Goal | Deliverable | Dependencies | Proof mode |
|---|---|---|---|

| [M05-G01](goals/M05/M05-G01.md) | Normalize conversation and case context across channels | M03-G99, M04-G99 | local |

| [M05-G02](goals/M05/M05-G02.md) | Integrate one real helpdesk with scoped notes and handoff | M05-G01, M03-G99, M04-G99 | connected_test |

| [M05-G03](goals/M05/M05-G03.md) | Publish a branded multi-shipment tracking page | M05-G01, M03-G99, M04-G99 | local |

| [M05-G04](goals/M05/M05-G04.md) | Send transactional notifications through merchant accounts | M05-G01, M03-G99, M04-G99 | connected_test |

| [M05-G05](goals/M05/M05-G05.md) | Record channel- and purpose-specific consent | M05-G04, M03-G99, M04-G99 | local |

| [M05-G06](goals/M05/M05-G06.md) | Enforce suppression at final send time | M05-G05, M03-G99, M04-G99 | local |

| [M05-G07](goals/M05/M05-G07.md) | Version support rules with waits and loop prevention | M05-G01, M05-G06, M03-G99, M04-G99 | local |

| [M05-G08](goals/M05/M05-G08.md) | Enable return automation only within qualified bounds | M05-G07, M03-G99, M04-G99 | local |

| [M05-G09](goals/M05/M05-G09.md) | Reserve model spend safely under concurrency | M03-G99, M04-G99 | local |

| [M05-G10](goals/M05/M05-G10.md) | Handle provider outage without unauthorized fallback | M05-G09, M03-G99, M04-G99 | local |

| [M05-G11](goals/M05/M05-G11.md) | Transfer cases to humans and fence late agent output | M05-G02, M05-G06, M03-G99, M04-G99 | local |

| [M05-G12](goals/M05/M05-G12.md) | Ship grounded support-answer and handoff skills | M05-G02, M05-G10, M05-G11, M03-G99, M04-G99 | local |

| [M05-G13](goals/M05/M05-G13.md) | Ship shipment-status and exception skills | M05-G03, M05-G04, M05-G12, M03-G99, M04-G99 | local |

| [M05-G14](goals/M05/M05-G14.md) | Calculate operational and economic metrics from receipts | M05-G04, M05-G11, M03-G99, M04-G99 | local |

| [M05-G15](goals/M05/M05-G15.md) | Analyze return reasons with attributable sample sizes | M05-G14, M03-G99, M04-G99 | local |

| [M05-G16](goals/M05/M05-G16.md) | Qualify autonomy per skill, model and runtime | M05-G08, M05-G12, M05-G13, M05-G14, M03-G99, M04-G99 | connected_test |

| [M05-G99](goals/M05/M05-G99.md) | Accept the integrated M05 milestone | All milestone worker goals + prior milestone gates | milestone_acceptance |

## M06 — Competitive return depth

Address the edge cases that decide whether a merchant can actually leave an incumbent.

**Prerequisite milestone gates:** M03-G99, M04-G99, M05-G99

| Goal | Deliverable | Dependencies | Proof mode |
|---|---|---|---|

| [M06-G01](goals/M06/M06-G01.md) | Offer catalog-wide exchanges within policy and real stock | M03-G99, M04-G99, M05-G99 | local |

| [M06-G02](goals/M06/M06-G02.md) | Collect exchange price differences exactly once | M06-G01, M03-G99, M04-G99, M05-G99 | connected_test |

| [M06-G03](goals/M06/M06-G03.md) | Resolve residual exchange value across supported instruments | M06-G01, M03-G99, M04-G99, M05-G99 | connected_test |

| [M06-G04](goals/M06/M06-G04.md) | Preserve bundle and promotion allocations | M06-G03, M03-G99, M04-G99, M05-G99 | local |

| [M06-G05](goals/M06/M06-G05.md) | Support verified gift-recipient return choices | M06-G03, M03-G99, M04-G99, M05-G99 | local |

| [M06-G06](goals/M06/M06-G06.md) | Preserve lineage through repeated exchanges | M06-G02, M06-G03, M06-G04, M03-G99, M04-G99, M05-G99 | local |

| [M06-G07](goals/M06/M06-G07.md) | Qualify currency, duties and conversion semantics | M06-G04, M03-G99, M04-G99, M05-G99 | connected_test |

| [M06-G08](goals/M06/M06-G08.md) | Reconcile estimated versus finalized return fees and tax | M06-G07, M03-G99, M04-G99, M05-G99 | connected_test |

| [M06-G09](goals/M06/M06-G09.md) | Establish qualified instant-exchange mandates and terms | M06-G02, M03-G99, M04-G99, M05-G99 | connected_test |

| [M06-G10](goals/M06/M06-G10.md) | Handle instant-exchange expiry, return and capture races | M06-G09, M03-G99, M04-G99, M05-G99 | connected_test |

| [M06-G11](goals/M06/M06-G11.md) | Provide reviewable risk assistance without automatic blanket denial | M03-G99, M04-G99, M05-G99 | local |

| [M06-G12](goals/M06/M06-G12.md) | Route returns only to qualified destinations | M03-G99, M04-G99, M05-G99 | local |

| [M06-G13](goals/M06/M06-G13.md) | Evaluate return-prevention suggestions without altering paid goods | M03-G99, M04-G99, M05-G99 | local |

| [M06-G14](goals/M06/M06-G14.md) | Validate three merchant policy packs against one core | M06-G05, M06-G06, M06-G10, M06-G11, M06-G12, M03-G99, M04-G99, M05-G99 | local |

| [M06-G99](goals/M06/M06-G99.md) | Accept the integrated M06 milestone | All milestone worker goals + prior milestone gates | milestone_acceptance |

## M07 — Portable, operable open-source v1

Release a supportable open-source alternative for the declared post-purchase segment, with demonstrated platform and agent independence.

**Prerequisite milestone gates:** M05-G99, M06-G99

| Goal | Deliverable | Dependencies | Proof mode |
|---|---|---|---|

| [M07-G01](goals/M07/M07-G01.md) | Implement WooCommerce return-request semantics honestly | M05-G99, M06-G99 | connected_test |

| [M07-G02](goals/M07/M07-G02.md) | Qualify WooCommerce refund records versus gateway effects | M07-G01, M05-G99, M06-G99 | connected_test |

| [M07-G03](goals/M07/M07-G03.md) | Complete second-platform notifications and shared lifecycle | M07-G01, M07-G02, M05-G99, M06-G99 | connected_test |

| [M07-G04](goals/M07/M07-G04.md) | Switch between independent runtimes during an open write case | M07-G03, M05-G99, M06-G99 | connected_test |

| [M07-G05](goals/M07/M07-G05.md) | Publish and exercise adapter conformance fixtures | M07-G03, M05-G99, M06-G99 | connected_test |

| [M07-G06](goals/M07/M07-G06.md) | Publish model, runtime and platform compatibility limits | M07-G04, M07-G05, M05-G99, M06-G99 | connected_test |

| [M07-G07](goals/M07/M07-G07.md) | Export and import merchant-owned configuration and case history | M05-G99, M06-G99 | local |

| [M07-G08](goals/M07/M07-G08.md) | Rehearse migration with a single writer per workflow | M07-G07, M07-G05, M05-G99, M06-G99 | connected_test |

| [M07-G09](goals/M07/M07-G09.md) | Exercise operator runbooks rather than merely writing them | M07-G08, M05-G99, M06-G99 | external_qualification |

| [M07-G10](goals/M07/M07-G10.md) | Prove independent clean installation and upgrade | M07-G07, M05-G99, M06-G99 | external_qualification |

| [M07-G11](goals/M07/M07-G11.md) | Validate recovery and queued-write restore interlocks | M07-G10, M05-G99, M06-G99 | external_qualification |

| [M07-G12](goals/M07/M07-G12.md) | Measure a declared load and backpressure envelope | M07-G05, M07-G11, M05-G99, M06-G99 | external_qualification |

| [M07-G13](goals/M07/M07-G13.md) | Audit release security, dependencies and artifact provenance | M07-G05, M05-G99, M06-G99 | external_qualification |

| [M07-G14](goals/M07/M07-G14.md) | Re-run privacy lifecycle across every shipped data store | M07-G07, M05-G99, M06-G99 | external_qualification |

| [M07-G15](goals/M07/M07-G15.md) | Qualify accessible customer and operator workflows | M07-G03, M05-G99, M06-G99 | external_qualification |

| [M07-G16](goals/M07/M07-G16.md) | Qualify locale, timezone and currency presentation | M07-G15, M05-G99, M06-G99 | local |

| [M07-G17](goals/M07/M07-G17.md) | Instrument the approved pilot outcome protocol | M07-G06, M05-G99, M06-G99 | local |

| [M07-G18](goals/M07/M07-G18.md) | Collect and review real bounded pilot evidence | M07-G08, M07-G09, M07-G12, M07-G13, M07-G14, M07-G15, M07-G16, M07-G17, M05-G99, M06-G99 | external_qualification |

| [M07-G99](goals/M07/M07-G99.md) | Accept the integrated M07 milestone | All milestone worker goals + prior milestone gates | milestone_acceptance |

## M08 — Shipping and warehouse operations

Expand from post-purchase support into fulfillment and return execution for compatible warehouses.

**Prerequisite milestone gates:** M07-G99

| Goal | Deliverable | Dependencies | Proof mode |
|---|---|---|---|

| [M08-G01](goals/M08/M08-G01.md) | Select carrier services and prepare batch quotes | M07-G99 | local |

| [M08-G02](goals/M08/M08-G02.md) | Purchase and repair batch labels per package | M08-G01, M07-G99 | connected_test |

| [M08-G03](goals/M08/M08-G03.md) | Validate scan-to-pack item identity and count | M07-G99 | local |

| [M08-G04](goals/M08/M08-G04.md) | Pack split and partial shipments without double allocation | M08-G03, M07-G99 | local |

| [M08-G05](goals/M08/M08-G05.md) | Separate manifest creation from carrier acceptance | M08-G02, M08-G04, M07-G99 | connected_test |

| [M08-G06](goals/M08/M08-G06.md) | Qualify warehouse order-update and hold connectors | M07-G99 | connected_test |

| [M08-G07](goals/M08/M08-G07.md) | Qualify warehouse return receipt and disposition events | M08-G06, M07-G99 | connected_test |

| [M08-G08](goals/M08/M08-G08.md) | Record per-location inventory movements with source ownership | M08-G07, M07-G99 | local |

| [M08-G09](goals/M08/M08-G09.md) | Track inventory transfers through dispatch and partial receipt | M08-G08, M07-G99 | local |

| [M08-G10](goals/M08/M08-G10.md) | Reconcile the complete shipment and return inventory cycle | M08-G05, M08-G09, M07-G99 | connected_test |

| [M08-G99](goals/M08/M08-G99.md) | Accept the integrated M08 milestone | All milestone worker goals + prior milestone gates | milestone_acceptance |

## M09 — Conversion, marketing and catalog skills

Add commercial growth tools without compromising customer consent or order correctness.

**Prerequisite milestone gates:** M07-G99

| Goal | Deliverable | Dependencies | Proof mode |
|---|---|---|---|

| [M09-G01](goals/M09/M09-G01.md) | Build catalog-grounded shopping and cart skills | M07-G99 | local |

| [M09-G02](goals/M09/M09-G02.md) | Add pre-fulfillment upsells with existing order safety | M09-G01, M07-G99 | connected_test |

| [M09-G03](goals/M09/M09-G03.md) | Assign checkout experiments and immutable holdouts | M09-G01, M07-G99 | local |

| [M09-G04](goals/M09/M09-G04.md) | Measure attribution, contamination and incremental effects separately | M09-G03, M07-G99 | local |

| [M09-G05](goals/M09/M09-G05.md) | Author reviewable campaigns without granting send authority | M07-G99 | local |

| [M09-G06](goals/M09/M09-G06.md) | Build scoped segments and marketing-provider adapters | M09-G05, M07-G99 | connected_test |

| [M09-G07](goals/M09/M09-G07.md) | Schedule and deliver campaigns with final consent checks | M09-G06, M07-G99 | connected_test |

| [M09-G08](goals/M09/M09-G08.md) | Recover abandoned carts with explicit consent and offer authority | M09-G01, M09-G07, M07-G99 | local |

| [M09-G09](goals/M09/M09-G09.md) | Make interactive email links scanner-safe | M09-G07, M07-G99 | local |

| [M09-G10](goals/M09/M09-G10.md) | Measure AI catalog visibility reproducibly | M09-G01, M07-G99 | connected_test |

| [M09-G11](goals/M09/M09-G11.md) | Publish approved catalog improvements with version checks | M09-G10, M07-G99 | connected_test |

| [M09-G12](goals/M09/M09-G12.md) | Implement optional try-on consent and media lifecycle | M07-G99 | local |

| [M09-G13](goals/M09/M09-G13.md) | Qualify try-on outputs and unsupported-model behavior | M09-G12, M07-G99 | connected_test |

| [M09-G14](goals/M09/M09-G14.md) | Qualify an optional identity-resolution partner boundary | M09-G06, M07-G99 | external_qualification |

| [M09-G99](goals/M09/M09-G99.md) | Accept the integrated M09 milestone | All milestone worker goals + prior milestone gates | milestone_acceptance |

## M10 — Warranty, dispute and cross-border workflows

Unify related cases while using partners for regulated, financial-network and physical-service capabilities.

**Prerequisite milestone gates:** M07-G99

| Goal | Deliverable | Dependencies | Proof mode |
|---|---|---|---|

| [M10-G01](goals/M10/M10-G01.md) | Enforce partner readiness and responsibility records | M07-G99 | local |

| [M10-G02](goals/M10/M10-G02.md) | Register products and version warranty terms | M07-G99 | local |

| [M10-G03](goals/M10/M10-G03.md) | Adjudicate warranty repair, replacement and refund outcomes | M10-G02, M07-G99 | connected_test |

| [M10-G04](goals/M10/M10-G04.md) | Handle shipping-loss/damage claims without invented coverage | M10-G01, M07-G99 | connected_test |

| [M10-G05](goals/M10/M10-G05.md) | Assemble truthful dispute evidence with missing-data labels | M07-G99 | local |

| [M10-G06](goals/M10/M10-G06.md) | Submit disputes through qualified processor interfaces | M10-G05, M07-G99 | connected_test |

| [M10-G07](goals/M10/M10-G07.md) | Qualify protection coverage and settlement disclosures | M10-G01, M07-G99 | external_qualification |

| [M10-G08](goals/M10/M10-G08.md) | Qualify cross-border duty/tax estimates and final assessment | M10-G01, M07-G99 | external_qualification |

| [M10-G09](goals/M10/M10-G09.md) | Qualify physical reverse-logistics receiving partners | M10-G01, M07-G99 | external_qualification |

| [M10-G10](goals/M10/M10-G10.md) | Track international physical handoffs and costs | M10-G08, M10-G09, M07-G99 | external_qualification |

| [M10-G11](goals/M10/M10-G11.md) | Qualify HSA/FSA eligibility and payment through an authorized partner | M10-G01, M07-G99 | external_qualification |

| [M10-G12](goals/M10/M10-G12.md) | Qualify network dispute alerts and event economics | M10-G01, M10-G06, M07-G99 | external_qualification |

| [M10-G13](goals/M10/M10-G13.md) | Establish try-before-buy trial and payment authority | M10-G01, M07-G99 | connected_test |

| [M10-G14](goals/M10/M10-G14.md) | Resolve trial returns, extensions and bounded final capture | M10-G13, M07-G99 | connected_test |

| [M10-G99](goals/M10/M10-G99.md) | Accept the integrated M10 milestone | All milestone worker goals + prior milestone gates | milestone_acceptance |

## M11 — Inventory and procurement

Add inventory intelligence grounded in reconciled operations and validated quantitative methods.

**Prerequisite milestone gates:** M07-G99, M08-G99

| Goal | Deliverable | Dependencies | Proof mode |
|---|---|---|---|

| [M11-G01](goals/M11/M11-G01.md) | Build point-in-time demand datasets without future leakage | M07-G99, M08-G99 | local |

| [M11-G02](goals/M11/M11-G02.md) | Backtest forecasts against named simple baselines | M11-G01, M07-G99, M08-G99 | local |

| [M11-G03](goals/M11/M11-G03.md) | Produce uncertainty-aware inventory forecasts | M11-G02, M07-G99, M08-G99 | local |

| [M11-G04](goals/M11/M11-G04.md) | Propose replenishment without autonomous purchasing | M11-G03, M07-G99, M08-G99 | local |

| [M11-G05](goals/M11/M11-G05.md) | Create supplier and purchase-order records | M11-G04, M07-G99, M08-G99 | local |

| [M11-G06](goals/M11/M11-G06.md) | Enforce procurement budgets and separation of duties | M11-G05, M07-G99, M08-G99 | local |

| [M11-G07](goals/M11/M11-G07.md) | Receive purchase orders partially without inflating stock | M11-G06, M07-G99, M08-G99 | connected_test |

| [M11-G08](goals/M11/M11-G08.md) | Process supplier returns and receipt/cost corrections | M11-G07, M07-G99, M08-G99 | local |

| [M11-G09](goals/M11/M11-G09.md) | Expand bills of materials with units and yields | M11-G07, M07-G99, M08-G99 | local |

| [M11-G10](goals/M11/M11-G10.md) | Reconcile production reservations, consumption and completion | M11-G09, M07-G99, M08-G99 | connected_test |

| [M11-G99](goals/M11/M11-G99.md) | Accept the integrated M11 milestone | All milestone worker goals + prior milestone gates | milestone_acceptance |

## M12 — Ecosystem and multi-store operations

Make extension, governance and deployment repeatable for agencies and larger installations.

**Prerequisite milestone gates:** M07-G99

| Goal | Deliverable | Dependencies | Proof mode |
|---|---|---|---|

| [M12-G01](goals/M12/M12-G01.md) | Delegate store-scoped agency access | M07-G99 | local |

| [M12-G02](goals/M12/M12-G02.md) | Roll out shared templates with per-store acceptance | M12-G01, M07-G99 | local |

| [M12-G03](goals/M12/M12-G03.md) | Aggregate agency reports without leaking customer records | M12-G01, M07-G99 | local |

| [M12-G04](goals/M12/M12-G04.md) | Distribute versioned skills and adapters through ordinary registries | M07-G99 | local |

| [M12-G05](goals/M12/M12-G05.md) | Migrate contracts and profiles without changing approved semantics | M12-G04, M12-G02, M07-G99 | local |

| [M12-G06](goals/M12/M12-G06.md) | Document enforceable contributor and retirement governance | M12-G04, M12-G05, M07-G99 | human_decision |

| [M12-G07](goals/M12/M12-G07.md) | Qualify an independently contributed extension | M12-G06, M07-G99 | external_qualification |

| [M12-G08](goals/M12/M12-G08.md) | Decide whether agent code execution is justified | M07-G99 | human_decision |

| [M12-G09](goals/M12/M12-G09.md) | Implement optional sandboxed code under the same action authority | M12-G08, M07-G99 | conditional_local |

| [M12-G99](goals/M12/M12-G99.md) | Accept the integrated M12 milestone | All milestone worker goals + prior milestone gates | milestone_acceptance |
