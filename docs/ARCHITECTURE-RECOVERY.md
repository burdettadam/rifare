# Architecture recovery and reconciliation

Date: 2026-11-22
Scope: Rifare architecture history reconciled against ADR-0081 through ADR-0084 and the retained October architecture handoff.

## Current authority map

- **Rifare** owns merchant-facing operations: workflows, merchant policy, approvals, agent orchestration, budgets and reservations, original operation identity, cross-system idempotency, execution adapters, reconciliation, support, and operational consequences.
- **Medusa 2.23.0 + PostgreSQL** owns commodity commerce records and native commerce workflows: products, catalog, carts, pricing, inventory, orders, and supported post-purchase primitives. Rifare must reuse upstream behavior before adding custom commerce code.
- **ElevenID / Marty** owns identity, trust, credentials, delegation, consent and authority evidence. It is a supplier to Rifare, not the merchant commerce engine or general-purpose authentication replacement.
- **External OIDC provider (owner-selected Supabase-like provider)** authenticates users. Rifare and ElevenID use separate application clients. A shared issuer/subject/email does not establish an ElevenID membership, merchant relationship, delegation or commerce permission.
- **Merchant integrations and providers** remain independently replaceable. Payment, shipping, warehouse, messaging, storage and model providers have their own contracts and qualification requirements.

## Operational lifecycle

Verified intent -> current facts -> merchant policy -> preview -> required approval -> final synchronous current-state and authority check -> native effect -> source receipt -> reconciliation.

Each stage has distinct evidence. Return authorization, physical handoff, warehouse receipt, inspection, stock movement, financial settlement and replacement fulfillment are not interchangeable.

Unknown external outcomes retain the original operation identity and applicable reservations until authoritative reconciliation. Timeout, process restart, changed agent, expired local reservation or a new request key never authorizes a duplicate uncertain effect.

## Runtime and extension architecture

- Human interfaces, deterministic rules, built-in agents and external agents share the same server-side action boundary.
- Portable skills describe workflows; typed merchant profiles customize permitted fields; platform packs describe capabilities; adapters translate supported native operations.
- Agent runtimes and model providers remain replaceable. Model output and skill text confer no authority.
- Server-side integration boundaries own keys and credentials. No privileged adapter handle or vault capability is sent to a model or browser worker.
- Optional AI must preserve manual and deterministic paths.
- Business state, policies, approvals, receipts and operation identity remain merchant-owned and independent of a model conversation.

## Decision assistance and browser research designs

The October architecture handoff retains M13 shared decision contracts, authorized evidence snapshots, server-owned provenance and shadow observations; M14 calibration/routing/backend replacement; M23 Clef Flash browser text/JSON inference through Kevala; M24 a separately qualified Wllama/GGUF compact backend; and M25 browser image assistance after M17 media prerequisites.

These are historical/adopted roadmap designs, not evidence that browser inference is implemented or qualified in the current Medusa application. Browser output is an untrusted client observation. It cannot grant eligibility, approve an action, spend money, move inventory, send a message or bypass server checks. Browser-local failure must not silently upload case content to a hosted provider. The existing Workers AI/server shadow path and its provenance remain distinct.

M15 sender-bound remote agent access, M16 managed execution restrictions, M17 media intake/privacy, M18 persistent journeys, M19 loyalty, M20 drop-off custody, M21 warehouse operations and M22 individualized campaigns remain separate architectural responsibilities. Newer Medusa work changes the commerce persistence/effect owner, not these domain boundaries.

## Superseded or diagnostic designs

- The legacy SQLite commerce core is retained for diagnostics, regression contracts and historical behavior; it is not the target production commerce engine.
- The earlier proposal for an ElevenID-operated Keycloak issuer in Rifare is superseded by the owner-selected external OIDC provider model (ADR-0082).
- ADR-0080's SQLite-specific public C6 composition is superseded by the Medusa-native source and original-operation prerequisite in ADR-0083. Preserve its public wire/recovery contracts, but do not connect them to the old SQLite journal as production authority.
- The Medusa cart observation digest is a read-only observation commitment, not an atomic revision, approval, stock reservation, payment equality check or execution currentness fence.
- No shared Supabase identity claim may be treated as ElevenID membership without a separately supported and verified account-link contract.

## Current Medusa integration sequence

1. **COMMERCE-ENGINE-01 / ADR-0081:** selected Medusa 2.23.0 + PostgreSQL and reuse upstream commerce behavior.
2. **IDENTITY-APP-01 / ADR-0082:** separate OIDC clients for Rifare and ElevenID, with native Medusa identity/customer persistence; hosted provider and login/consent qualification remain open.
3. **COMMERCE-CONTEXT-01 / ADR-0083:** native cart ownership and separately versioned persisted-fact observation; local implementation and reviews recorded, protected effects remain held.
4. **COMMERCE-OPERATION-01 / ADR-0084:** assigned but not implemented. Add the Rifare-owned durable original-operation journal in the existing Medusa PostgreSQL database. Use database-enforced uniqueness, exact ownership/fact binding, privacy lifecycle and independent-connection/process qualification. No payment, public dispatch, ElevenID call or business effect is in scope.
5. After journal qualification, select and verify the ElevenID human/machine account-link and authority contract. Then compose authority evidence with the durable original operation and enforce final native cart/currentness/payment-equality checks immediately at the Medusa effect boundary.
6. Only after those gates, qualify one complete purchase lifecycle and then migrate post-purchase workflows to upstream Medusa primitives wherever possible.

## Cross-cutting requirements

- Tenant, merchant, store, customer, actor/session, resource and configuration ownership must be enforced by server-side current sources, not request-supplied IDs, email, metadata or model assertions.
- Idempotency and challenge non-reuse must survive process boundaries, cancellation, minimization and restore.
- Do not store access/refresh tokens, bearer credentials, private keys, proof bytes or raw compact JWS in the operation journal.
- Privacy export, correction, retention, erasure, holds, uninstall, restore/import and suppression must apply across projections. Restoring old data cannot resurrect authority or work.
- Connected provider, physical service, model quality, deployment, independent operator and production-release qualification remain distinct from fixture/local test success.
- No paid CI dispatch, production migration, default-branch merge, release or live provider-account change is implied by this architecture recovery.

## Evidence and source of truth

Current implementation and acceptance state are defined by the active Rifare Git branch, ADRs, work records and acceptance ledger—not by this historical design inventory. The October architecture handoff and browser milestone handoff remain useful for architectural intent, but their M00–M25 implementation status must not override newer branch decisions and work records.

Primary current decisions:
- docs/decisions/0081-upstream-commerce-engine.md
- docs/decisions/0082-external-customer-identity.md
- docs/decisions/0083-medusa-cart-context.md
- docs/decisions/0084-medusa-operation-journal.md
- docs/PLANS.md
- docs/PROJECT-STATUS.md
- docs/IDENTITY-APPLICATION-CONTRACT.md
- docs/COMMERCE-ENGINE.md
- docs/MEDUSA-CART-CONTEXT.md

This document consolidates design intent. It does not claim new implementation, tests, independent review, acceptance or production qualification.
