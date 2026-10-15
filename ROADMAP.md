# Rifare — development roadmap

**Project: Rifare; name clearance has not been performed.** Plan 0.1.0 · October 15, 2026 · Proposed, not implemented.

## Decision summary

Build an open-source commerce operations platform with interchangeable skills, platforms, agents and model providers. Start with post-purchase operations: returns, exchanges, safe order editing, support and tracking. Release a reliable solution for that defined customer segment before expanding into the broader commerce lifecycle.

The platform—not the agent—owns customer verification, policies, approvals, inventory/money rules and durable operational records. Skills carry portable workflow knowledge. Merchants tailor validated profiles; platform packs and adapters handle real API differences. Replacing the agent must not require migrating the business.

**First competitive release:** M07, after the M00–M06 core gates. **Broader suite:** M08–M12, pursued by demand and dependency rather than all at once. Basic open-source distribution, contributor practices and security begin in M00; M12 is not the start of openness.

No calendar deadlines are invented. The plan assumes a small maintainer-led team using AI-assisted development, but staffing, merchant recruitment and partner access are not confirmed. Milestones are outcome/evidence boundaries, not dates. Estimate using actual throughput after two accepted milestones.

## Package and source of truth

- `planning/roadmap.json`: 13 milestone definitions and dependencies.
- `planning/backlog.json` / `.csv`: 151 requirements, preserving all 99 original BUILD IDs and adding 52 skills/governance/expansion requirements.
- `planning/capability-targets.json`: 44 proposed capabilities classified by milestone and delivery mode.
- `planning/acceptance-tests.json`: 67 seed acceptance specifications; none has been run against a product.
- `docs/SKILL-ARCHITECTURE.md`: skill composition, canonical actions and portability/security boundaries.
- `docs/DEVELOPMENT-GOVERNANCE.md`: work selection, evidence, gates and release rules.
- `docs/FIRST-DISPATCH.md`: the initial work sequence and agent-development handoff.
- `examples/`: a design-example skill, three synthetic merchant profiles, platform placeholders and evaluation fixtures. These are not a working commerce implementation.

The requirement and scenario baselines remain under `reference/` for internal traceability. Platform and standard references are in `planning/roadmap-sources.json`; they require verification during implementation. No external product research archive is included.

## Why the roadmap is ordered this way

Returns and exchanges require inventory-aware quotations, money calculations, evidence, inspection and exception handling. Order changes require actual downstream fulfillment protection. These are proposed core product requirements, not prompt-only behaviors.

Rifare prioritizes merchant ownership of policies, data and operational records. Agent connectivity serves that architecture; it does not replace server-enforced authority or prove model independence.

Shipping, marketing and inventory are separate substantial operational areas. Build them only after the core lifecycle is qualified, and keep physical or financial partner services explicitly distinct from software.

## Product principles

1. **AI is optional; operations are not.** Every supported action works through human UI and deterministic APIs when model credentials are absent.
2. **Skills are portable; authority is server-owned.** Standard SKILL.md content helps agents act. It cannot grant permissions, rewrite a price, waive consent or authorize a refund.
3. **Tailoring uses validated profiles, not customer forks.** Keep reusable domain code and base skills independent from merchant-specific policy values, brand language and supported platform mappings.
4. **Support is capability-based.** Declare native, composed, manual, unsupported and unverified behavior per platform/payment/warehouse combination. Do not market an interface as a guarantee.
5. **Evidence controls releases.** Money and inventory reconcile; permissions are tested adversarially; upgrades and restores are rehearsed; human reviewers approve release claims.

## Milestone map

| Milestone | Release boundary | Primary result | Dependencies |
|---|---|---|---|
| M00 — Product charter and reproducible development | Planning baseline | Establish a buildable project and an accepted product boundary before implementation becomes a collection of unrelated agent experiments. | None |
| M01 — Agent-neutral walking skeleton | Read-only developer preview | Prove the differentiator in a narrow useful workflow: authenticated order-status assistance through interchangeable interfaces. | M00 |
| M02 — Tailorable skills and safe action execution | Controlled-action alpha | Make skills configurable without weakening authorization, and establish the write-safety boundary before real financial operations. | M01 |
| M03 — Complete returns and exchanges | Returns pilot beta | Replace the basic return workflow for a tightly defined merchant configuration. | M02 |
| M04 — Safe order editing and cancellation | Order-operations beta | Prevent avoidable returns and support contacts without shipping stale or unpaid orders. | M03 |
| M05 — Support, tracking and controlled autonomy | Integrated post-purchase beta | Deliver a complete customer experience around the operational actions rather than a stand-alone chat demo. | M03, M04 |
| M06 — Competitive return depth | Competitive-core release candidate | Address the edge cases that decide whether a merchant can actually leave an incumbent. | M03, M04, M05 |
| M07 — Portable, operable open-source v1 | v1.0 candidate | Release a supportable open-source alternative for the declared post-purchase segment, with demonstrated platform and agent independence. | M05, M06 |
| M08 — Shipping and warehouse operations | Logistics expansion | Expand from post-purchase support into fulfillment and return execution for compatible warehouses. | M07 |
| M09 — Conversion, marketing and catalog skills | Growth expansion | Add commercial growth tools without compromising customer consent or order correctness. | M07 |
| M10 — Warranty, dispute and cross-border workflows | Claims and international expansion | Unify related cases while using partners for regulated, financial-network and physical-service capabilities. | M07 |
| M11 — Inventory and procurement | Planning expansion | Add inventory intelligence grounded in reconciled operations and validated quantitative methods. | M07, M08 |
| M12 — Ecosystem and multi-store operations | Ecosystem expansion | Make extension, governance and deployment repeatable for agencies and larger installations. | M07 |

## Sequence and parallelism

Core path: **M00 → M01 → M02 → M03 → M04 → M05 → M06 → M07**. The M05 dependencies explicitly require the return and edit paths to be ready. Early read-only, mock and platform-investigation slices can precede their completion milestone.

After M07, logistics (M08), growth (M09), claims/international (M10) and ecosystem (M12) can run independently. Inventory/procurement (M11) also requires M08's reconciled movement foundations. Do not build all tracks concurrently unless integration and review capacity exist.

## Detailed milestone contracts

Each gate is proposed. All current implementation statuses are **not started**. Acceptance is determined by evidence, not the amount of code produced.

### M00 — Product charter and reproducible development

**Release:** Planning baseline. **Depends on:** no prior milestone. **Accountable role:** product/technical lead; named owner unassigned.

**Outcome:** Establish a buildable project and an accepted product boundary before implementation becomes a collection of unrelated agent experiments.

**Deliverables**

- Approve the initial customer: technically capable merchants/agencies operating supported physical-goods commerce workflows. Shopify is first; WooCommerce is the second-platform proof. Record excluded payment, fulfillment, subscription and market combinations.
- Choose repository identity and an OSI-approved license before public distribution; document licenses for application, adapters, SDKs and public skills, plus treatment of private merchant configuration. No publication or remote writes are performed by this plan.
- Adopt the existing git-agent workflow by its actual installed version. Keep its development skills separate from product commerce skills; use Git/GitHub, local checks, worktrees and existing project tooling rather than another orchestration framework.
- Create a modular monolith skeleton: TypeScript/Node API and worker, React operator/customer surfaces, PostgreSQL, durable jobs and attachment storage. Select supported dependency versions in an ADR, not from this planning document.
- Create synthetic storefront fixtures, a one-command local environment using standard project commands, an issue/decision structure and the benchmark scenario manifest.
- Name one accountable maintainer and at least one independent reviewer; record a pilot-recruitment plan and unassigned operational responsibilities.

**Skill packages:** Development: reuse work-goal/worktree-flow after version inspection; do not ship development credentials or tooling as commerce features..

**Exit criteria**

- A clean checkout starts an isolated synthetic environment without production credentials or a paid orchestration service.
- Charter, critical safety invariants, initial support envelope and license/distribution decisions receive human approval.
- The first ten work goals have owners or explicit unassigned status, dependencies, expected evidence and acceptance criteria.

**Demonstration:** A contributor follows the README on a clean environment, starts the demo and identifies the exact next unblocked issue.

**Outside this milestone:** No marketplace, new agent framework, Kubernetes requirement or broad ERP replacement.

**Decision gate:** Approve the baseline; unresolved licensing blocks public distribution, not local design experiments.

**Backlog trace:** PLAN-001, PLAN-002, PLAN-003, PLAN-004, PLAN-005.

### M01 — Agent-neutral walking skeleton

**Release:** Read-only developer preview. **Depends on:** M00. **Accountable role:** product/technical lead; named owner unassigned.

**Outcome:** Prove the differentiator in a narrow useful workflow: authenticated order-status assistance through interchangeable interfaces.

**Deliverables**

- Connect a Shopify test store read-only and a synthetic adapter; normalize tenant/store/customer/order/shipment IDs and retain source versions and freshness.
- Implement minimal customer/operator authentication, store isolation, encrypted secret references, capability discovery and source-backed order lookup.
- Ship the first standard SKILL.md package plus a minimal loader; deliver the same skill through files or a scoped content tool without requiring filesystem access.
- Expose one typed read contract through operator UI, REST and MCP. Keep the built-in runner optional; use a minimal maintained provider SDK/adapter rather than embedding provider objects in domain records.
- Exercise two independently configured cloud-model providers, a separately implemented external runtime and the no-AI UI; add a local-model compatibility spike without promising equivalent quality.
- Configure two synthetic merchants with different brand/locale instructions and data scopes. Record normalized actions and references rather than requiring identical generated wording.

**Skill packages:** order-status; knowledge-answer; handoff-request (read-only preparation).

**Exit criteria**

- The same verified order question is answered via both provider-backed runs, an external runtime and the operator UI with the same source facts.
- Cross-tenant reads and customer order enumeration fail; model input/output logs contain no provider or commerce secrets.
- Changing the model configuration does not change the order schema, base skill or platform adapter. Missing model capabilities cause an explicit refusal/handoff.

**Demonstration:** Switch model providers and then agent runtimes while showing the same source-backed shipment status for two merchants.

**Outside this milestone:** No production refunds, labels, edits or invented actions. No complete prompt-management platform.

**Decision gate:** Reject any architecture that needs a provider-specific conversation ID as the business record.

**Backlog trace:** BUILD-001, BUILD-003, BUILD-005, BUILD-006, BUILD-016, BUILD-020, BUILD-046, BUILD-047, BUILD-049, BUILD-050, BUILD-052, BUILD-053, BUILD-056, BUILD-057, SKILL-001, SKILL-002, SKILL-003.

### M02 — Tailorable skills and safe action execution

**Release:** Controlled-action alpha. **Depends on:** M01. **Accountable role:** product/technical lead; named owner unassigned.

**Outcome:** Make skills configurable without weakening authorization, and establish the write-safety boundary before real financial operations.

**Deliverables**

- Implement versioned skill packages with standard SKILL.md plus project-specific manifest, parameter schema, evaluation fixtures and release metadata.
- Resolve base workflow + platform pack + vertical defaults + merchant/store profile + approved segment/locale settings into a pinned effective configuration with field-level provenance.
- Build structured policies, current permission checks, preview/approval binding, idempotent business-operation records, fenced work leases, revocation and human takeover.
- Persist verified webhooks, transactional work dispatch, bounded retries and ambiguous-outcome reconciliation; add currency-aware money and auditable resource versions.
- Provide merchant configuration validation, policy simulation, review/publish/rollback, read-only shadow mode and selective autonomy. Natural-language edits can create drafts but cannot publish them.
- Build a WooCommerce read-only spike and execute return-draft scenarios on the simulator and Shopify test store; identify unsupported capabilities rather than copying Shopify semantics into the common model.

**Skill packages:** handle-return (draft only); review-exception; platform-shopify; platform-woocommerce (read-only); merchant-profile templates.

**Exit criteria**

- Two merchants customize windows, evidence, language and escalation without a core-code fork; platform guidance changes without rewriting the base workflow.
- A malicious skill, merchant note or external agent cannot self-approve, widen token scope, read another tenant or bypass a disabled action.
- Policy/configuration changes show a deterministic diff and provenance; approvals expire or invalidate on relevant state changes; duplicate/late work cannot execute twice.
- The first write-enabled path has passing privacy, backup/safe-restore, event-replay, token-audience and operator-recovery tests.

**Demonstration:** A shopper requests a return; the agent drafts it, policy explains the result, a human authorizes the exact action and a stale approval is rejected.

**Outside this milestone:** No generic graph editor, custom policy programming language or arbitrary skill-shell execution.

**Decision gate:** Approve real-money development only after write-safety tests and store readiness checks pass.

**Backlog trace:** BUILD-002, BUILD-004, BUILD-007, BUILD-008, BUILD-009, BUILD-010, BUILD-011, BUILD-012, BUILD-013, BUILD-014, BUILD-015, BUILD-018, BUILD-019, BUILD-043, BUILD-044, BUILD-045, BUILD-048, BUILD-055, SKILL-004, SKILL-005, SKILL-006, SKILL-007, SKILL-008, SKILL-009, SKILL-010, SKILL-011, SKILL-012, SKILL-013.

### M03 — Complete returns and exchanges

**Release:** Returns pilot beta. **Depends on:** M02. **Accountable role:** product/technical lead; named owner unassigned.

**Outcome:** Replace the basic return workflow for a tightly defined merchant configuration.

**Deliverables**

- Ship a mobile and keyboard-usable branded portal with verified order access, eligibility, reasons, evidence, policy explanation, exact fees and human escalation.
- Create native return/reverse-fulfillment records where supported, quote and execute refunds, and issue supported native store credit. Keep non-native instruments explicitly labeled.
- Support baseline item-level outcomes and equal-value variant exchanges, inventory rechecks, original-order linkage and replacement fulfillment.
- Connect one merchant-owned label/carrier account, return tracking, receipt/inspection, explicit disposition and restock; separate carrier delivery from warehouse receipt.
- Implement cancellation/expiry, bounded automation, exception queues, refund-balance limits and reconciliation of manual platform changes.
- Run the first design-partner cases with approvals and an agreed launch envelope. Keep unsupported split tenders, currencies, bundles and subscription situations disabled until tested.

**Skill packages:** handle-return; exchange-variant; quote-refund; receive-return; resolve-return-exception.

**Exit criteria**

- On a connected test store, complete request -> authorization -> label -> receipt -> refund/credit/replacement with matching native and local records.
- Fault injection after provider acceptance produces no duplicate refund, purchased label, receipt or replacement; uncertain results remain visible until reconciled.
- A pilot merchant signs off the permitted cases, customer messages, fees and manual recovery path. Test-store capability proof is distinct from payment-settlement proof.

**Demonstration:** Execute a refund return and a variant exchange, interrupt one remote response, then reconcile it without duplicate effects.

**Outside this milestone:** No instant exchange, comprehensive bundles or unsupported money instruments marketed as complete.

**Decision gate:** Open a bounded pilot only after merchant review; add real settlement evidence when permitted and available.

**Backlog trace:** BUILD-017, BUILD-021, BUILD-022, BUILD-023, BUILD-024, BUILD-025, BUILD-026, BUILD-027, BUILD-028, BUILD-029, BUILD-030, BUILD-031, BUILD-032, BUILD-033, BUILD-034, BUILD-035, SKILL-014.

### M04 — Safe order editing and cancellation

**Release:** Order-operations beta. **Depends on:** M03. **Accountable role:** product/technical lead; named owner unassigned.

**Outcome:** Prevent avoidable returns and support contacts without shipping stale or unpaid orders.

**Deliverables**

- Add per-action edit windows, cancellation, address validation and eligible item/quantity changes.
- Preview totals and stock against authoritative data; support cheaper edits and refunds, equal-value changes, and higher-value changes requiring payment.
- Verify the actual downstream fulfillment protection before mutation. A tag is not proof of a hold; disallow edits for unverified warehouse combinations.
- Track independent hold reasons, split fulfillments, warehouse acknowledgments, payment obligations, failed/expired payment and safe hold release.
- Use the platform-specific edit sequence and keep subscription-contract changes out of scope unless a separately qualified adapter supports them.
- Add scenario replay and merchant configuration tests for already-picked orders, stock races and manual changes during approval.

**Skill packages:** edit-order; change-address; cancel-order; collect-edit-balance; release-fulfillment-hold.

**Exit criteria**

- The target warehouse/3PL receives only the final eligible order and does not ship before required payment is confirmed.
- Expired or failed payment leaves a visible recoverable state; releasing this product's hold does not release another system's hold.
- Unsupported edits are rejected before any irreversible side effect, with customer/operator alternatives.

**Demonstration:** Upgrade an item, leave payment outstanding, prove fulfillment is blocked, settle payment and verify the final order reaches the warehouse.

**Outside this milestone:** No universal claim that every Shopify/WooCommerce payment or warehouse plugin supports safe editing.

**Decision gate:** Certify each store × payment × fulfillment combination separately; block rather than improvise an unsafe integration.

**Backlog trace:** BUILD-036, BUILD-037, BUILD-038, BUILD-039, BUILD-040, BUILD-041, BUILD-042, BUILD-058, SKILL-015.

### M05 — Support, tracking and controlled autonomy

**Release:** Integrated post-purchase beta. **Depends on:** M03, M04. **Accountable role:** product/technical lead; named owner unassigned.

**Outcome:** Deliver a complete customer experience around the operational actions rather than a stand-alone chat demo.

**Deliverables**

- Connect one existing helpdesk plus webchat/email; add consent-aware SMS through a merchant-owned provider when approved.
- Ship grounded knowledge, branded order tracking, transactional updates and a shared case timeline across channels without exposing another channel's unverified identity.
- Add copilot, shadow, approval-gated and bounded-autonomous modes; configure per-skill/merchant action budgets, handoff thresholds and kill switches.
- Add support rules with triggers, conditions, waits, quiet periods and conflict handling. Deduplicate across helpdesk, platform and our own notifications.
- Analyze return reasons and support outcomes with provenance; produce reviewable suggestions, not self-published policy changes.
- Separate correct resolution from attempted automation, ticket closure and model billing; collect operational costs and a manual-workflow baseline.

**Skill packages:** resolve-wismo; support-triage; knowledge-answer; handoff-case; analyze-return-reasons; transactional-notification.

**Exit criteria**

- Human takeover stops further agent actions without losing case context; new messages in other channels do not bypass customer verification.
- Verified policy answers and completed business actions are measured separately from attempts; all sampled financial outcomes reconcile.
- Provider outage or budget exhaustion falls back to queued/manual operation; no new provider receives customer data without merchant approval.
- Opt-out arriving concurrently with a scheduled marketing message suppresses the send; transactional behavior follows configured consent/policy rules.

**Demonstration:** Resolve a tracking query, process an approved return, hand off an exception and disable the model while the operator continues the same case.

**Outside this milestone:** No paid human outbound service or full marketing-suite replacement.

**Decision gate:** Increase autonomy only for predeclared scenarios that meet the quality gate; low-quality models stay copilot/read-only.

**Backlog trace:** BUILD-051, BUILD-054, BUILD-061, BUILD-062, BUILD-063, BUILD-064, BUILD-065, BUILD-066, BUILD-067, BUILD-068, SKILL-016, SKILL-017, SKILL-018.

### M06 — Competitive return depth

**Release:** Competitive-core release candidate. **Depends on:** M03, M04, M05. **Accountable role:** product/technical lead; named owner unassigned.

**Outcome:** Address the edge cases that decide whether a merchant can actually leave an incumbent.

**Deliverables**

- Add catalog exchanges, price differences, promotions, gift flows and supported repeated exchanges with full line-level provenance.
- Implement partial bundles, allocation rules, mixed item outcomes, returnless resolutions, fees and multi-location routing.
- Support qualified multi-currency/tax/duty cases with explicit estimates versus final amounts and platform-native calculations.
- Add optional instant exchanges with proven authorization/deposit/capture/expiry behavior and approved customer consent; qualify each payment setup.
- Add inspection-based and event-based resolution policies, fraud-assistance evidence with reviewer appeal, and pre-fulfillment return-prevention suggestions.
- Expand WooCommerce implementation for core cases and publish the compatibility matrix for each feature/platform combination.

**Skill packages:** exchange-catalog; resolve-bundle-return; instant-exchange; route-return; review-risk; prevent-avoidable-return.

**Exit criteria**

- The agreed competitive scenario set covers bundles, unavailable stock, repeated exchanges, mixed outcomes and allowed currencies; unsupported cases remain explicit.
- Instant exchange cannot capture beyond the approved obligation or silently treat an expired authorization as valid.
- Merchant-level total costs and retained contribution margin are measured; no success claim is based only on gross exchanged revenue.

**Demonstration:** Run a complex mixed-outcome return, an out-of-stock fallback and a non-return/authorization-expiry scenario, showing every ledger entry.

**Outside this milestone:** No guaranteed fraud detection, loss underwriting or implied support for all payment methods.

**Decision gate:** Scope v1 support claims to verified workflows; nonessential high-risk capabilities can remain labeled beta rather than blocking every merchant.

**Backlog trace:** BUILD-059, BUILD-060, BUILD-072, BUILD-073, BUILD-074, BUILD-081, BUILD-083, BUILD-093, SKILL-019.

### M07 — Portable, operable open-source v1

**Release:** v1.0 candidate. **Depends on:** M05, M06. **Accountable role:** product/technical lead; named owner unassigned.

**Outcome:** Release a supportable open-source alternative for the declared post-purchase segment, with demonstrated platform and agent independence.

**Deliverables**

- Qualify Shopify plus WooCommerce: the second platform must complete order lookup, return request, refund workflow and notifications using the same base skills, not just return mock responses.
- Validate two model providers, one local endpoint and two genuinely independent agent runtimes for a declared shared workflow subset; publish quality/capability limitations.
- Ship install/upgrade/rollback, backup/restore, secret rotation, privacy lifecycle, data export/import, migration dry runs, documented hardware/load profiles and operations runbooks.
- Publish a supported capability matrix, public API/skill contracts, security policy, contributor guide, license notices and software bill of materials; tag reproducible release artifacts.
- Require a second person to install without private assistance and a non-author to implement or materially extend an adapter/skill using public documentation.
- Complete a recommended bounded pilot evaluation with three independent merchant profiles, at least 100 in-scope case outcomes and a 30-day observation period where recruitment permits. Record confidence limits, exceptions and customer approval.

**Skill packages:** migration-audit; store-readiness; reconcile-case; merchant-onboarding; all qualified core skills.

**Exit criteria**

- Clean install, upgrade and restore rehearsals succeed without vendor license-server or proprietary-agent dependency; restore cannot replay live money actions.
- All mandatory critical conformance scenarios pass, no unresolved critical/high release-blocking issues remain, and sampled financial/inventory records reconcile.
- Two platforms, two independent runtimes and supported model configurations have recorded evidence for the shared portability subset.
- Pilot outcomes meet predeclared quality thresholds and are approved by the maintainer plus merchant representatives. With insufficient live evidence, label the release beta/RC rather than silently waiving the gate.

**Demonstration:** Install from the release, replay one case on both platforms, switch its agent, restore a backup in isolation and import a merchant configuration without a code fork.

**Outside this milestone:** Do not claim complete commerce-suite coverage or universal platform compatibility.

**Decision gate:** Human release approval is mandatory. Optional breadth cannot replace missing safety, migration or portability evidence.

**Backlog trace:** BUILD-069, BUILD-070, BUILD-071, SKILL-020, SKILL-021, SKILL-022, SKILL-023, OPS-001, OPS-002, OPS-003, OPS-004, OPS-005, OPS-006, OPS-007, OPS-008.

### M08 — Shipping and warehouse operations

**Release:** Logistics expansion. **Depends on:** M07. **Accountable role:** product/technical lead; named owner unassigned.

**Outcome:** Expand from post-purchase support into fulfillment and return execution for compatible warehouses.

**Deliverables**

- Add multi-account rates and labels, batching, scan-to-pack, manifests and provider-specific void/refund handling.
- Implement locations, allocations, picking/packing checks, transfer handoffs, return inspection queues and disposition.
- Qualify warehouse/3PL connectors and reconcile order edits, payment holds and source inventory across them.
- Introduce shipping/carrier and operational analytics with exception owners and replayable source evidence.

**Skill packages:** select-shipping-service; batch-fulfill; scan-pack-order; inspect-return; resolve-warehouse-exception.

**Exit criteria**

- A warehouse completes sale-to-shipment and return-to-disposition test cycles with no unexplained inventory differences.
- Duplicate scans, partial receipts, carrier timeouts and split shipments produce correct records and explicit exceptions.

**Demonstration:** Scan, pack and ship an edited order; receive its partial return and reconcile all stock movements.

**Outside this milestone:** No owned physical warehouse network or guaranteed carrier economics.

**Decision gate:** Choose integration versus native warehouse screens using pilot demand and connector feasibility.

**Backlog trace:** EXP-001, EXP-002, EXP-003, EXP-004.

### M09 — Conversion, marketing and catalog skills

**Release:** Growth expansion. **Depends on:** M07. **Accountable role:** product/technical lead; named owner unassigned.

**Outcome:** Add commercial growth tools without compromising customer consent or order correctness.

**Deliverables**

- Add rule-constrained product recommendations, cart assistance, checkout/rescue experiments and eligible post-purchase offers.
- Integrate existing email/SMS providers first; support campaign drafts, segmentation, templates, approved schedules and consent enforcement.
- Measure experiments using holdouts, stable assignment, attribution windows and contribution margin; separate code-redemption attribution from causal lift.
- Add catalog quality/AI-visibility evaluations and reviewed publication of fixes; label search visibility observations as measurements, not guaranteed ranking.
- Keep interactive email and vision try-on as separately evaluated optional modules with rendering/privacy and model capability tests.

**Skill packages:** recommend-product; recover-cart; draft-campaign; run-conversion-test; improve-catalog; try-on-preview (optional).

**Exit criteria**

- Campaign previews require approval and consent checks at send time; unsafe discounts and unsupported checkout changes are blocked.
- Holdout contamination and duplicated conversion attribution are detected; results report uncertainty and net economics.

**Demonstration:** Create and approve a campaign, exclude an opted-out shopper, run a held-out offer experiment and inspect its source events.

**Outside this milestone:** No identity-resolution network, staffed cart-recovery team or unverified return-on-investment claims.

**Decision gate:** Ship only channels and checkout placements with confirmed platform support and merchant-approved data handling.

**Backlog trace:** BUILD-079, BUILD-080, BUILD-087, BUILD-088, BUILD-089, BUILD-091, BUILD-097, EXP-005, EXP-006, EXP-007, EXP-008.

### M10 — Warranty, dispute and cross-border workflows

**Release:** Claims and international expansion. **Depends on:** M07. **Accountable role:** product/technical lead; named owner unassigned.

**Outcome:** Unify related cases while using partners for regulated, financial-network and physical-service capabilities.

**Deliverables**

- Add warranty registration, entitlement, claims, shipping-issue cases and evidence history.
- Assemble dispute evidence with source attribution, deadlines and human review; use qualified processor/network adapters for submission and alerts.
- Integrate tax/duties, coverage and international-return partners through explicit capability and service-status contracts.
- Represent physical handoffs, inspection, partner fees and financial recovery without describing an API integration as ownership of a service network.
- Treat try-before-buy and HSA/FSA checkout as separately gated partner/payment projects, not prompt-only skills.

**Skill packages:** verify-warranty; triage-shipping-claim; prepare-dispute-evidence; route-international-return; quote-partner-service.

**Exit criteria**

- Every submitted claim/evidence package is attributable to records and deadlines, with accurate approvals and financial reconciliation.
- A partner outage, unsupported jurisdiction or missing agreement prevents the dependent service; no fabricated guarantee or successful recovery.

**Demonstration:** Create a warranty case and draft a dispute response, then simulate an international partner outage and show safe handoff.

**Outside this milestone:** No insurer, merchant-of-record, customs guarantee or physical-return network represented as implemented software.

**Decision gate:** Proceed per partner only after API access, commercial terms, responsibility boundaries and applicable compliance review are confirmed.

**Backlog trace:** BUILD-075, BUILD-076, BUILD-077, BUILD-078, BUILD-090, BUILD-094, BUILD-095, BUILD-096, BUILD-098, BUILD-099, EXP-009, EXP-010.

### M11 — Inventory and procurement

**Release:** Planning expansion. **Depends on:** M07, M08. **Accountable role:** product/technical lead; named owner unassigned.

**Outcome:** Add inventory intelligence grounded in reconciled operations and validated quantitative methods.

**Deliverables**

- Build demand history, inventory positions, replenishment suggestions, supplier lead times and safety-stock inputs.
- Add purchase orders, approvals, partial receiving, supplier returns and inter-location transfers.
- Introduce BOM/assembly and SKU cost/profitability records where demanded, with clear source-of-truth ownership.
- Let agents explain forecasts and draft purchase actions; keep forecasts, unit conversion and quantity/cost calculations deterministic and independently tested.

**Skill packages:** forecast-demand; propose-replenishment; draft-purchase-order; receive-purchase-order; explain-stockout.

**Exit criteria**

- Backtests against named simple baselines and explicit forecast horizons are published; no future-data leakage.
- Receiving and transfers reconcile by SKU/location; procurement agents cannot approve their own spending.

**Demonstration:** Explain a stockout risk, propose a purchase order, obtain approval and receive it partially without overstating stock.

**Outside this milestone:** No generic language model treated as the inventory forecasting algorithm.

**Decision gate:** Use measured forecast value and actual merchant need to decide whether to expand native planning or integrate an ERP.

**Backlog trace:** BUILD-084, BUILD-085, BUILD-086, EXP-011, EXP-012.

### M12 — Ecosystem and multi-store operations

**Release:** Ecosystem expansion. **Depends on:** M07. **Accountable role:** product/technical lead; named owner unassigned.

**Outcome:** Make extension, governance and deployment repeatable for agencies and larger installations.

**Deliverables**

- Publish curated adapter/skill distribution using existing Git/releases or registries before building a custom marketplace.
- Add multi-store agency workspaces, delegated roles, SSO options, approved shared templates and tenant-safe aggregated reporting.
- Support skill signing/provenance, dependency review, compatibility reports, staged rollouts, revocation and long-term deprecation notices.
- Add larger deployment profiles, advanced audit export and operational support options while keeping core self-hosted behavior and agent choice open.
- Maintain a contributor/test-fixture program and documented governance for accepting, retiring and replacing adapters and skills.

**Skill packages:** onboard-store; validate-skill-release; plan-adapter-upgrade; audit-tenant-configuration.

**Exit criteria**

- An independent contributor ships a compatible extension without core forks or access to private infrastructure.
- A centrally published template can be upgraded, rejected or rolled back per merchant without crossing tenant boundaries.

**Demonstration:** Install a community extension, review its requested permissions, canary it in one store and revoke it without disabling other merchants.

**Outside this milestone:** No mandatory hosted registry or new custom orchestration framework.

**Decision gate:** Expand administration only after real multi-store demand; never delay basic contributor/security docs until this stage.

**Backlog trace:** BUILD-082, BUILD-092, SKILL-024, SKILL-025, EXP-013, EXP-014.

## Skills and customer tailoring

Adopt the existing Agent Skills instruction format and use a separate project-specific manifest for action/schema/version requirements. The standard's experimental allowed-tools metadata does not replace our gateway authorization. A client can consume skill resources through files or a content tool, so an external agent need not adopt our filesystem or runner. [S01, S02]

Compose base workflow, platform pack, vertical defaults, merchant/store settings and approved segment/locale choices. Use typed fields, named precedence rules, conflict detection and provenance. Do not concatenate arbitrary customer prose as a higher-priority policy. A merchant may change an allowed return window; a profile cannot claim an unsupported warehouse hold works.

The included profiles demonstrate the intended design: apparel/Shopify, fragile-goods/WooCommerce and clearance/Shopify share one base handle-return skill while varying settings. These examples are synthetic and unverified. They prove only the form of the proposed configuration, not runtime behavior.

See `docs/SKILL-ARCHITECTURE.md` for the full contract, lifecycle and threat boundaries.

## Exact meaning of agent/model agnostic

| Dimension | Required proof | Insufficient proof |
|---|---|---|
| Model | Change provider/local endpoint for a declared supported workflow without changing domain records, actions or base skill. | An API-key textbox or two model names behind one proprietary dependency. |
| Agent | An independently implemented runtime receives work, uses published skills, proposes actions and reads receipts. | Changing only the model inside the same orchestrator. |
| Platform | The same base workflow completes a shared subset on two real commerce platforms with honest native/composed/manual mapping. | A second adapter returning mocks, or claiming every API is Shopify-shaped. |
| Merchant | Different policies/brands/locales work through validated profiles without core-code branches by merchant ID. | Cloning the codebase per client. |
| Operations | Human UI, data export and self-hosting work without our hosted control plane or agent service. | “Open source” code that cannot perform core actions without a proprietary license service. |

MCP supplies an access interface, not the entire workflow or permission model. Keep agent-facing tokens and upstream store/provider credentials separate and audience-bound. [S03]

## Minimum v1 competitive envelope

Approve this envelope at M00 and refine only with an explicit decision. Shopify is the deeper first implementation; WooCommerce demonstrates a qualified shared subset rather than pretending identical native APIs.

| Area | v1 acceptance expectation | Qualification boundary |
|---|---|---|
| Returns | Branded self-service, eligibility/evidence, refunds/credit, labels, receipt, disposition, automation and exceptions. | Native instrument/gateway and shipping-account qualification. |
| Exchanges | Variant and catalog options, stock protection, allowed price differences, mixed outcomes and representative bundle/discount cases. | Instant exchange and complex currency cases can remain separately labeled beta unless in the promised merchant envelope. |
| Order operations | Eligible address/item/cancellation changes, total previews, balance collection and safe holds/releases. | Explicitly verified payment and warehouse combinations only. |
| Support/tracking | Grounded help, web/email/helpdesk context, branded status, approved actions, handoff, notifications and measured outcomes. | Additional channels require independent identity/consent qualification. |
| Skills | Versioned packages, profiles, simulation, publication, rollback, revocation and per-skill autonomy. | No arbitrary untrusted executable skill packages. |
| Portability | Shopify and WooCommerce shared subset; two independent runtimes; cloud/provider/local capability reporting. | Models are not assumed equally capable. Unsupported tasks are disabled or routed to humans. |
| Ownership | Self-host, export/import, inspect policies/records, replace provider/agent and use manual UI. | External store/carrier/messaging services do not become offline services. |
| Operations | Installation, migration, independent review, restore, privacy, telemetry and release evidence. | Service targets must name the tested deployment and workload. |

Shopify's return lifecycle and order-edit sequence need platform-specific implementation. WooCommerce refund resources do not by themselves provide the same return lifecycle or prove settlement. This is why platform support is qualified feature by feature. [S04, S05, S07]

## Build, integrate, partner or defer

**Build:** the portable case/operation records, skills/profile lifecycle, action contracts, policy/approval boundary, operator/customer surfaces, conformance tests and high-value workflow logic.

**Integrate first:** helpdesk, model SDK/gateway, shipping accounts, email/SMS delivery, warehouse/ERP interfaces and payment operations. Use merchant-owned accounts and preserve source-of-truth ownership.

**Partner:** physical return hubs, coverage/protection economics, duty/tax guarantees, network dispute alerts, identity-resolution services and eligibility/payment services. A skill may request these only through an active qualified provider; it does not manufacture the underlying capability.

**Defer unless justified:** custom agent code execution, a new agent framework, skill marketplace, visual flow language, complete marketing-delivery infrastructure, universal ERP and mandatory Kubernetes. Optional modules must have their own customer/evidence gate.

## Main risks and decision triggers

| Risk | Trigger | Response |
|---|---|---|
| Shopify-shaped abstraction | WooCommerce needs fake native objects or edits to every base skill. | Revisit canonical boundaries in M02, before financial workflows spread. |
| Customer-specific forks | A third merchant needs copied core code for policy/tone/routing. | Improve typed configuration or add a shared action; do not accept merchant-ID branches as default architecture. |
| Unsafe external side effects | Timeout leaves unknown refund, label, payment or stock receipt. | Stop retries, reconcile and route to operator; never hide uncertainty. |
| Uncontrolled scope | Marketing, warehouse and inventory features delay the first post-purchase release. | Keep expansion tracks gated by M07 and real demand. |
| False agnosticism | External runtime or local model needs our proprietary session service. | Treat portability gate as failed; simplify contract and disclose limitations. |
| Partner dependency | API access, underwriting, warehouse or tax service is unavailable. | Keep dependent capability disabled; do not replace an agreement with a prompt. |
| Insufficient pilot evidence | Merchant recruitment or case volume misses the proposed gate. | Release preview/beta/RC with honest limits, not unqualified v1 claims. |
| Skill supply-chain/data leakage | Unreviewed package requests shell, arbitrary egress or unrelated records. | Reject/quarantine it; enforce source pinning, least privilege and data lifecycle. |
| Maintenance burden | New adapter lacks tests and a support owner. | Do not label it supported; require a maintainer and deprecation policy. |

## Start here

Read `docs/FIRST-DISPATCH.md`. The first useful demonstration is one verified order-status workflow shared by two merchant profiles, two model providers, an independent runtime and a no-AI UI. Next add a safe return draft. Build the action/approval/reconciliation boundary around those real slices, rather than spending the first release designing a universal framework.

## Retained platform and standard references

These implementation references were retained from the planning baseline and require version/capability verification during the owning goal. Most of this roadmap is proposed Rifare product and engineering design. Requirement and scenario baselines under `reference/` are internal planning records, not external product research.

- **S01 — Agent Skills specification**: https://agentskills.io/specification — Standard SKILL.md structure and experimental allowed-tools; not our commerce manifest.
- **S02 — Adding skills support**: https://agentskills.io/client-implementation/adding-skills-support — File-based and content-tool delivery; progressive disclosure.
- **S03 — MCP authorization**: https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization — Audience-bound credentials and separation of upstream tokens.
- **S04 — Shopify returns apps**: https://shopify.dev/docs/apps/build/orders-fulfillment/returns-apps — Native return/reverse-fulfillment lifecycle and returnProcess.
- **S05 — Shopify order editing**: https://shopify.dev/docs/apps/build/orders-fulfillment/order-management-apps/edit-orders — Begin/edit/commit, scopes and supported order constraints.
- **S06 — Shopify webhooks**: https://shopify.dev/docs/apps/build/webhooks — Event delivery behavior and reconciliation.
- **S07 — WooCommerce order refunds v3**: https://developer.woocommerce.com/docs/apis/rest-api/v3/order-refunds — Refund resources and api_refund behavior; not general native return parity.
