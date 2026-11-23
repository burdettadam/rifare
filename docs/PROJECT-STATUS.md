# Rifare project status

**Medusa commerce application · retained diagnostic implementations · production qualification open**

The owner-selected [Medusa migration](COMMERCE-ENGINE.md) now supplies the local
commerce target. [COMMERCE-ENGINE-01](../work/records/COMMERCE-ENGINE-01.md)
records its exact tested source and independent reviews. The diagnostic domain
inventory below retains the earlier M20-G03 foundation; implementation and formal
product acceptance remain separate.

## What is available now

The locally verified target slice, [COMMERCE-CONTEXT-01](../work/records/COMMERCE-CONTEXT-01.md),
adds registered-cart access policy and a native persisted-fact observation. Its
[guide](MEDUSA-CART-CONTEXT.md) records child-reference restrictions, exact decimal
handling and the open ElevenID/currentness prerequisites. Published `4550a14` has
the exact reviewed tree: 22 cart-context, 28 identity and 17 commerce groups pass,
with separate focused/intake checks, a meaningful ownership fault and successful
backend/Admin builds. Both independent reviews found no scoped blocker. Protected
commerce effects remain held; formal acceptance and production qualification remain open.

The selected target is Medusa 2.23.0 with PostgreSQL and upstream Admin. Its build
and 17 real database/API workflow groups pass; 61 focused configuration and
retained regression cases also pass. It is local-only, with public protected
actions held while identity and approval integration is implemented. See the
[engine guide](COMMERCE-ENGINE.md) for startup and exact limits.

The optional [external customer identity profile](EXTERNAL-CUSTOMER-IDENTITY.md)
now consumes a Supabase-style provider through maintained OIDC code and Medusa's
native Auth extension. Its reviewed local candidate passes 28 identity groups,
including real PostgreSQL/customer association, browser binding, cryptographic
refusal cases, customer lifetime limits, operator sessions and development-log
privacy. The 17 commerce groups still pass with public protected operations held.
The [identity record](../work/records/IDENTITY-APP-01.md) preserves separate focused
checks, the detected browser-binding fault and both independent reviews. An actual
hosted Supabase project/client/consent journey and the ElevenID commerce binding
remain unqualified.

The repository also retains the modular TypeScript/Node.js implementation,
SQLite diagnostics, fixture adapters, plain HTML/JavaScript interfaces,
independent Python clients and deterministic demos. [Try Rifare](TRY-RIFARE.md)
describes these diagnostic paths. Their commodity behavior is being migrated
upstream, preserving business expectations before retiring old implementations.

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

The current priority is the [ElevenID application identity contract](IDENTITY-APPLICATION-CONTRACT.md)
and the Medusa cart/approval/original-operation bridge. Then map existing returns,
exchanges, edits and other scenarios to upstream workflows before adding custom
behavior. M20-G04/G05 remain unfinished diagnostic-domain work subordinate to
this reuse decision. See the [current plan](PLANS.md) and [roadmap](ROADMAP.md).

## What the preview does not establish

| Boundary | Current state |
| --- | --- |
| Target application | Real Medusa/PostgreSQL workflows and the upstream Admin build now run locally. The ElevenID/approval bridge, served-browser journey, durable production services and independent deployment remain open. `npm run dev` selects this application when installed/configured, with no diagnostic fallback. |
| Connected commerce services | Fixture-backed protocols and local source records do not establish live merchant, financial, carrier, warehouse, or partner operation. |
| Model quality and portability | Local contracts, fixtures, and reader paths exist. Actual provider quality and independently qualified combinations still need evidence. |
| Remote clients and recovered history | Some local independent-client demonstrations exist. Later remote/managed/browser claims whose source was missing from recovery are not treated as recovered implementation. |
| Browser inference | M23–M25 are adopted roadmap work. This preview does not provide a qualified browser model runner, download, or image-inference experience. |
| Deployment and formal acceptance | Target-host deployment, independent installation, real pilot observations, and formal milestone gates remain open. Local review and focused tests do not close those gates. |
| Licensing | Source terms are applied: AGPL-3.0-only for original application code and Apache-2.0 for the separable material listed in the component license map. Retained upstream terms still apply. Any future release or extension distribution needs its own artifact review. |

For the original boundaries, see [local environment](LOCAL-ENVIRONMENT.md), [M18 qualification](M18-QUALIFICATION.md), [browser handoff](BROWSER-WORKER-HANDOFF.md), [license status](../LICENSE-STATUS.md), and the per-milestone assessments.

## Reading the repository's history

The default development line is `development`. `main` is an older protected baseline; do not infer current implementation from that branch alone. Preserve the current source and Git history when continuing the project.

The current [architecture](ARCHITECTURE.md) maps landed source. Domain qualification guides and older work records retain the wording of their original checkpoints; read their date and scope alongside [remaining qualification](QUALIFICATION.md) and the latest domain record. The earlier [README at the imported checkpoint](https://github.com/burdettadam/rifare/blob/c299065241b3bdf4928a83f9ff4decf749c6afaa/README.md) remains available in Git history.

Canonical planning files and generated catalogues now contain remaining work. Completed implementation packets are removed from the active tree; Git retains their original text. Behavioral criteria and executable regression contracts remain protected. Actual development outcomes belong in [work records](../work/README.md) and the [acceptance ledger](../work/accepted-goals.json). A feature inventory, milestone number, synthetic demo, or local passing check is not a production-readiness claim.
