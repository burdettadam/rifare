> Current development decision: accepted under delegated bootstrap authority; see [ADR-0004](0004-delegated-development-authority.md). Original submission/proposal wording below is retained for audit and is not the current acceptance state. No product qualification or independent review is implied.

# ADR-0001 — First-release customer and support envelope

Status: proposed; human approval pending
Owner: Rifare project owner
Goal: M00-G01 / PLAN-001
Contract: `rifare-post-purchase-v1`, revision 1
Source: [Charter](../CHARTER.md) and [canonical envelope](../../planning/support-envelope.json)

## Context

Development needs an explicit first customer and release boundary before platform,
agent and workflow work expands in unrelated directions. The current instruction
authorizes implementation of M00-G01; it is not approval of this previously unseen
scope, license, publishing, paid integrations or production effects.

## Proposed decision

Use the US direct-to-consumer physical-apparel merchant/agency target profile.
Use Shopify first and WooCommerce for an explicit shared lifecycle subset.
Initially claim only domestic USD, one-time physical-goods financial workflows.
Qualify exact gateway, account, carrier and warehouse configurations before effects.
Keep unsupported combinations disabled; require a reviewed scope revision for new
ones. Retain all original requirements, targets, invariants and milestone gates.

Portable skills/profile configuration and independently replaceable models and
agent runtimes are product boundaries. No-AI operation and server-owned authority
remain required. Physical, network and regulated services depend on actual partners.

## Alternatives considered

A first release spanning every platform, payment route, currency and fulfillment
provider would have no bounded qualification matrix. A first release consisting
only of a model-specific support bot would miss the shared operational and ownership
requirements. The proposed envelope favors a complete limited lifecycle over both.

## Consequences

The v1 statement must disclose platform and account limits. Some advanced work
remains conditional or outside the first advertised cohort; its original goals
and evidence obligations are not waived. New scope requires an explicit diff and
review against the retained contract. No runtime capability is currently qualified.
Benchmark/pilot thresholds, licensing and workflow administration stay in their
separate assigned goals.

## Decision and reviews

Human decision: pending
Approved candidate and envelope digest: not recorded
Independent authority/security review: not assigned
Independent regression review: not assigned
Implementation worker: Rifare Development Assistant

Only the actual owner/review process can replace these pending entries. A source
file, successful check or assistant-authored acceptance flag does not authenticate
that decision. M00-G01 remains unaccepted until the external requirements are met.
