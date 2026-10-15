# Skill architecture and portability contract

**Status:** proposed design, not an implemented runtime. **Plan version:** 0.1.0. **Date:** October 15, 2026.

## 1. What a skill is—and is not

A product skill is a portable description of a bounded business workflow: when to use it, what information to obtain, which authorized actions to request, what successful completion means, and when to hand off. It contains no merchant credentials and is not the final authority for money, identity, policy, consent or inventory.

Use the existing Agent Skills format for instructions and resources. Its standard package centers on `SKILL.md`; the specification also permits supporting resources. The experimental `allowed-tools` field is not a cross-runtime security guarantee. [S01]

Our commerce-specific manifest is a separate extension, not a claim about the standard. It declares dependencies on canonical actions, configuration schemas, contract versions and evaluation cases. The examples in this package are deliberately inert: no business runtime, approved policy or certified platform adapter is supplied.

Keep these concepts separate:

| Concept | Responsibility | What it must not do |
|---|---|---|
| Skill | Explain workflow and request allowed actions. | Grant permissions, invent facts, self-approve or own settlement truth. |
| Merchant profile | Configure permitted choices, tone, locales, thresholds and routing. | Pretend a platform supports an operation or grant a role extra authority. |
| Platform pack | Explain platform-specific concepts, constraints and troubleshooting. | Hide unsupported behavior behind prose or substitute for adapter implementation. |
| Adapter | Translate validated actions/events to a specific platform, payment or logistics API. | Decide arbitrary merchant policy or bypass the gateway. |
| Action gateway | Verify identity, tenant, policy, current state, approvals and operation ownership; execute through adapters. | Trust tool descriptions or agent promises as authorization. |
| Agent runtime | Choose and sequence permitted steps using a model or program. | Become the sole location of case state, approvals or configuration. |
| Model provider | Generate reasoning outputs and candidate structured requests. | Decide final balances, consent, policy publication or who owns an order. |

Development skills such as the user's existing `work-goal` and `worktree-flow` remain development tooling. Commerce skills ship as product assets. Sharing a file convention does not justify sharing runtime privileges or secrets.

## 2. Package shape

```text
skills/handle-return/
  SKILL.md
  commerce-manifest.json       # our proposal, not a standard field set
  references/
    workflow.md
    platform-notes.md
  evaluations/                # added with each implementation goal
  assets/                     # optional approved templates/resources
```

The sample manifest and schema live under `examples/`. Use standard frontmatter fields rather than inventing a new skill format. Keep most details in referenced files and disclose only applicable skills to an agent. A client can read files or retrieve skill content through an authorized tool; it need not have a shell or a repository clone. [S01, S02]

Initially distribute packages as pinned repository paths/releases. Do not build a registry service, visual graph language or universal agent operating system before the first useful workflow exists.

## 3. Composition without customer forks

Resolve a deployment from named, typed layers:

```text
base workflow
  + platform pack
  + optional vertical defaults
  + merchant policy/profile
  + optional store or approved customer-segment settings
  + locale and channel presentation
  = effective configuration + provenance + version digest
```

Here “customer tailoring” primarily means the merchant/customer buying or operating the software. An individual shopper's segment can select a preapproved policy branch; the shopper cannot author an override.

Do not implement this as concatenated prompts or generic “last file wins.” Each configuration field must declare its type, default source, permitted override layers, validation, effective dates and conflict rule. A merchant may intentionally extend an allowed return window; it is not correct to mechanically choose the smallest number for every policy. Conversely, no profile can remove customer verification or widen an agent's granted token scopes.

Distinguish three mechanisms:

**Defaults:** a vertical pack suggests a window or tone that an authorized merchant may replace in permitted fields.

**Constraints:** deployment safeguards, identity permissions, verified platform capabilities and published merchant authority restrict execution. Applicable permission sets intersect; an unavailable capability stays unavailable. Different constraints need domain-specific resolution rather than arbitrary numeric minima.

**Guidance:** narrative examples, vocabulary and handoff language help the agent explain a result. Guidance cannot override structured policy. Contradictory guidance produces a validation issue or a human review request.

Compile to a read-only snapshot with source/version for every effective field. Provide a user interface to edit allowed fields, preview differences, run simulations, request approval and publish. Do not require a merchant to understand YAML, nor hide the portable source configuration from technical users.

## 4. Concrete merchant variation

The three bundled profiles are synthetic design fixtures, not actual merchant policies or legal recommendations.

| Profile | Platform candidate | Return window | Example variation |
|---|---|---:|---|
| Apparel | Shopify | 30 days | Variant exchanges; damage evidence; warmer tone. |
| Fragile goods | WooCommerce | 14 days | Damage/wrong-item evidence; refund-only initial subset; formal tone. |
| Clearance | Shopify | 7 days | Explicit final-sale/clearance exclusions; concise tone. |

They share the same `handle-return@0.1.0` base skill. Their adapter capability examples are all **unverified**, so they do not authorize production writes. The intended outcome is different allowed business behavior without merchant-ID branches in core code.

More complex vertical packs can later supply warranty entitlement, serial numbers, perishable goods rules or business purchasing processes. Add a new action contract only when a workflow truly needs a new capability; do not clone every existing skill for each vertical.

## 5. Model agnosticism and agent agnosticism are separate

**Model independence:** the optional built-in runner uses a chosen provider key or local endpoint. Normalized contracts must cover capability discovery, structured action proposals, context limits, cancellation, usage accounting and error handling. Images, tool calling and reliable structured output are capabilities to certify, not assumptions implied by a provider's compatibility label.

**Agent independence:** a merchant can replace the orchestrator completely. An external agent receives a scoped work item and published skill/configuration material, submits action proposals and reads receipts. It does not need the built-in runner's memory store, graph framework or prompts.

**Platform independence:** canonical operations map to separately tested platform behavior. The interface cannot pretend every platform has the same native records or guarantees. Declare `native`, `composed`, `manual`, `unsupported` or `unverified` capability states with versions and requirements. A composed action must document which system owns each record and what reconciliation is needed.

**Operational-account independence:** merchants own store, shipping, messaging and provider accounts. Their agent token is not a raw Shopify, payment or carrier key. Keep credentials in a server-side secret store and return only references.

Shopify exposes a native return/reverse-fulfillment lifecycle, while WooCommerce documents order refund resources and gateway-refund behavior. Therefore the second-platform proof must distinguish a local return case from native platform records and a recorded refund from actual payment movement. [S04, S07]

## 6. Execution contract

Proposed canonical action names include `orders.get`, `returns.evaluate-eligibility`, `returns.preview`, `returns.create-request`, `refunds.preview`, `refunds.execute`, `orders.preview-edit`, `orders.commit-edit`, `operations.get` and `support.handoff`. These are our proposed names, not vendor API endpoints.

Generate or maintain REST/OpenAPI and MCP exposure from the same validated definitions. Every caller—including the operator interface—uses the same authority checks. MCP authorization must bind tokens to the appropriate resource; store-provider tokens remain distinct from agent-facing access tokens. [S03]

A work item should identify tenant/store, verified subject, case, lease/fencing token, permitted actions, effective-configuration digest, source references, budget and deadline. It should not contain arbitrary secret material, unrestricted customer history or an opaque provider conversation as the business source of truth.

An action preview records the current resource versions, operation type, exact amounts and currency, prerequisites, side effects, approval policy and expiry. Approval authorizes that preview and nothing broader. Execution rechecks current revocation, permissions, stock/payment/fulfillment facts and ownership. It produces a durable receipt distinguishing proposed, blocked, approved, running, pending external outcome, completed, failed and reconciled states.

“Completed” must mean the declared business effect occurred, not merely that a tool call returned a response. Domain state machines remain separate: authorized return, parcel transport, inspection, financial settlement and replacement fulfillment are different facts.

## 7. Safety under failures and upgrades

Persist webhook acceptance before processing, use a durable work outbox, deduplicate by provider event and business operation, and reconcile with authoritative systems. Shopify explicitly cautions about webhook delivery reliability and ordering, so event arrival cannot be the sole source of truth. [S06]

An external side effect cannot always be rolled back transactionally. After an uncertain refund or label purchase, query the provider or route to an operator before retrying. Do not promise globally exactly-once delivery; aim for idempotent business effects where supported and explicit reconciliation where they are not.

Pin the skill/profile/policy/adapter contract to the case for explanation and reproducibility. Pinning is not permission to ignore a current revocation or newly required safety restriction. A change to approved amounts or action semantics invalidates the old preview and requires approval again.

On agent takeover, fence the previous worker. Before new execution, resolve pending external effects. Kill switches operate by tenant, skill, action and provider. They stop new actions while allowing safe reconciliation and necessary operator recovery.

A rollback selects a previous skill/configuration for new work. It does not “undo” a refund, unsend a message or automatically migrate an in-flight case to old semantics.

## 8. Trust and data boundaries

Treat skill packages as a software supply chain. Pin sources and digests, validate resource paths and licenses, review permissions, disable scripts by default, and require an existing sandbox and egress policy for any later executable resources. Do not let a fetched package install arbitrary dependencies or expand tenant scope.

Treat messages, attachments, product text and retrieved pages as untrusted task data. Do not allow their embedded instructions to change tools, approvals or publication rules. Retrieval must enforce tenant/customer scopes before content reaches a model. Attachment scanning, private URLs, retention and deletion apply to both original data and derived indexes/caches.

Merchants must approve model destinations and fallback routes. A configured global fallback does not justify transferring another merchant's customer data to it. Reserve budgets before parallel work, reconcile actual cost, and stop new tasks when usage is uncertain or limits are reached.

Operational records should retain structured decisions and source references, not demand hidden model chain-of-thought. Minimize personal data in append-only receipts; keep redactable payloads and sensitive logs in lifecycle-controlled stores.

## 9. Evaluation and compatibility

Certify a matrix of skill version × profile × platform adapter × agent runtime × model capability. Avoid promising every possible combination. Publish a minimum common subset and explicitly distinguish full support, limited support, manual-only and unsupported behavior.

A model may be acceptable for order-status answers but not for autonomous case resolution. Keep deterministic operation tests separate from model quality evaluations. Use executable assertions for balances, permissions, quantities and required handoffs, with human review of communication quality. Do not rely on one model grading another as the sole release gate.

The initial portability goal is two cloud providers, a local-endpoint spike and one independent external runtime early; v1 requires two genuinely independent runtimes and a declared cross-platform workflow subset. Changing only the model underneath one orchestrator is not proof of agent independence.

## 10. Avoid unnecessary custom machinery

Use a modular monolith, existing schema validation and provider SDKs, standard transport protocols, Git-based versioning and normal test runners. Add a small skill resolver and action gateway because they encode the product's actual contract—not a general-purpose orchestration platform. Introduce more infrastructure only after measured constraints or real customer requirements justify it.

## Sources

Source IDs resolve in `planning/roadmap-sources.json` at the package root. S01–S07 are retained primary specifications and platform documentation; reverify during implementation. All architecture choices above are Rifare proposals, not claims of implemented behavior.
