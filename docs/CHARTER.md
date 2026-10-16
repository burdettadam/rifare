# Rifare first-release charter

**Contract:** `rifare-post-purchase-v1`, revision 1. **Decision:** proposed for owner review.
**Owning goal:** M00-G01 / PLAN-001. **First release gate:** M07-G99.

This version freezes a review candidate, not an accepted product or a release approval.
The machine-readable source is [the support envelope](../planning/support-envelope.json).
Its content identity is captured in candidate evidence. The [decision record](decisions/0001-first-release-support-envelope.md)
must be resolved by the project owner after independent review.

## Product and first customer

Rifare is a merchant-owned post-purchase operations platform with portable skills,
replaceable agent runtimes and model providers, and a usable no-AI operator path.
The first release handles returns, exchanges, safely bounded order changes,
support actions and tracking. The wider roadmap remains intact; this charter
limits what the first release may promise, not what later goals may investigate.

**MERCHANT-US-APPAREL-01** is the named target profile: a technically supported US
direct-to-consumer apparel merchant, or its implementation agency, selling
one-time physical goods. The merchant controls the storefront, payment account,
return policy and fulfillment integrations, and can authorize a narrowly scoped
pilot. Initially claimed financial workflows use USD and domestic US orders.
This is a target profile. No actual merchant has been recruited or represented as
having approved, installed or purchased Rifare.

Apparel makes stock-aware size/variant exchanges, partial returns and repeated
exchanges useful first workflows. A fragile-goods and a clearance profile must
also be expressible using the same base skills and permitted configuration;
neither requires a merchant-specific core fork. Recruiting and actual pilot
measurements belong to their assigned goals, not this document.

## Platform and payment boundaries

**Shopify is first.** The baseline is a one-time, paid physical-goods order with
verified customer ownership and a native fulfillment-control path. The gateway,
account, API version and downstream order writers must be specifically qualified
before money-moving or fulfillment-changing actions are enabled. A category such
as `qualified_gateway` names a required qualification class; it does not assert
that an unnamed gateway has passed.

**WooCommerce is the second-platform proof.** Its required shared subset is
source-backed order status, a honestly represented return-request lifecycle,
qualified gateway refunds and transactional notifications. Native and composed
records must be distinguished. Its exchange, editing and credit capabilities are
not inherited from the first platform.

This charter does not claim that every platform plan, installed extension,
payment processor, carrier or warehouse supports the target actions. Those exact
versions/configurations will be bound by the owning implementation and
qualification goals. No version is silently certified by this document checker.

## First-release outcomes

| Domain | First-release commitment | Essential qualification boundary |
|---|---|---|
| Order status | Verified source-backed order/shipment facts on both platform profiles. | Customer/store isolation, source provenance, freshness and explicit unavailable-data handling. |
| Returns | Eligibility, evidence, review, mixed outcomes, request/native linkage, receiving and disposition. | Published merchant policy; explicit separation of parcel, inspection and financial states. |
| Refunds and credit | Qualified refunds with current paid-balance limits; supported credit instruments where actually available. | Provider-side effects, source references and reconciliation; a local balance or manual record is not payment. |
| Exchanges | Stock-aware variant/catalog, bundle/promotion allocations, gift constraints and repeated-exchange lineage. | Qualified inventory and payment differences; conditional instruments remain disabled until proven. |
| Order changes | Eligible address/item changes, additional-payment obligations and consistent cancellation. | Every downstream writer must honor the hold and final order; invoiced does not mean paid. |
| Support and tracking | Shared grounded context, tracking, transactional notifications, rules and human takeover. | Qualified channels, consent, fenced action/message ownership and a no-AI path. |
| Portability | Independent model and agent configurations, a real second-platform subset, portable case/policy data. | Publish limitations per skill/platform/runtime; changing models alone is not independent orchestration. |
| Operation | Self-hosted installation, upgrade/recovery, privacy lifecycle, export/import and bounded migration. | Actual installation, security, recovery and pilot evidence at M07; no production-readiness claim from docs. |

The 38 action/context rows are exact combinations, not a Cartesian product.
Every row has a reason, accountable owner, owning goal, qualification conditions
and retained capability references. All 44 original capability targets and all
14 original invariants remain represented without changing their owning milestones.

## Meaning of a support label

- **Supported:** a planned first-release commitment for that exact scenario.
- **Conditional:** a planned capability whose additional platform, account,
  instrument or physical-service qualification must be met; unavailable cases
  stay disabled and are disclosed.
- **Excluded:** explicitly outside this first-release configuration, with a reason.

All three labels currently have `qualification: not_qualified`. Every resolver
result has `execution_authorized: false`. A valid matrix does not implement an
action, override policy, certify an adapter or authenticate human approval.
Unknown actions, missing dimensions and undeclared payment/fulfillment combinations
resolve to **scope_decision_required**, never to automatic support.

## Explicit exclusions and conditional work

Unverified warehouse holds, automatic refunds inferred from manual payment records,
subscription-contract changes, and non-USD/cross-border financial claims are
outside the initial claimed cohort. Digital goods, marketplace settlement,
split-tender/BNPL, B2B payment terms and undeclared gateway combinations do not
inherit support; adding any needs a separate reviewed scope revision.

Multi-currency/duty investigation remains M06-G07 work. Gift-credit and instant
exchange work remain in M06 with their full original evidence obligations.
Unavailable mandate or credit support is a disabled capability, not a passing
implementation. Optional exclusions require an explicit owner decision under the
existing milestone contract; this charter cannot silently waive the goal.

Broader warehouse execution, marketing/conversion, warranty/disputes,
international services, inventory/procurement and ecosystem expansion remain
M08–M12 work. Physical receiving hubs, coverage funding, customs guarantees,
identity networks and payment-eligibility services require real partner authority.
A skill cannot create an account entitlement, insurance service or warehouse.
Pricing mechanics are not required first-release product features.

## Skills, agents and authority

Base business skills describe the workflow. Typed platform/merchant profiles
customize permitted parameters and presentation. The platform supplies
capabilities, verified facts, money/inventory calculations, permissions, approved
policies and durable execution receipts.

No skill text may grant permissions, certify an unavailable adapter or publish
its own policy. No merchant ID branches belong in the shared workflow. Models,
agent runtimes, commerce integrations and merchant configuration remain separate
extension points; no mandatory provider-specific thread or hosted agent service
owns the business records.

Human UI, rules and agents use the same planned authority boundary. Required
approvals bind the actual operation and current facts. Unknown financial outcomes
reconcile before retries. Customer verification, secrets, tenancy, consent,
human takeover and safe restore remain cumulative obligations in every later path.
This goal supplies no action gateway, model integration or service runtime.

## Release claims and change control

`rifare-v1` is a planned M07 release, not a tag or current availability statement.
The five proposed claim groups are backed by explicit matrix rows. Current public
claims and product qualification flags stay false. Release thresholds and benchmark
sample sizes remain proposed until the M00-G02 decision; this goal neither lowers
nor preaccepts them. License/distribution remains M00-G03. Workflow enforcement and
independent acceptance infrastructure remain M00-G04/G07/G08.

A matrix edit, version bump, changed claim, removed condition, new platform
combination or deleted capability cannot approve itself. Compare against an
independently retained prior contract and send any semantic change for review.
After genuine acceptance, maintainers—not the feature author—retain the accepted
contract and executable test obligations under the existing baseline policy.

## Acceptance and ownership

The project owner is accountable for the support-envelope decision and appointment
of integration, implementation and review owners. Named independent reviewers
are not available in this checkpoint. The assistant is the implementing worker,
not an acceptance owner or either independent reviewer.

M00-G01 may be accepted only after the owner approves this exact revision and
candidate, independent authority/security and regression reviews have been
obtained, and its executable document-contract tests and meaningful failure
proof have been reviewed. Until then it is **ready for review**, not accepted,
and dependent goals are not automatically authorized.
