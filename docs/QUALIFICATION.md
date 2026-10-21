# Remaining qualification

**Local implementation is substantial; formal product and production
qualification remain open.** Removing completed planning instructions does not
accept a milestone, waive an original criterion or authorize an external operation.
This guide consolidates the repeated open obligations from retired milestone
packets. The [roadmap](ROADMAP.md) separately identifies actual missing code.

## Evidence still needed

| Area | Outstanding observation or decision | Existing detailed record |
| --- | --- | --- |
| Target application and deployment | Actual PostgreSQL/React startup, target-database and served-browser behavior, independent install/upgrade/restore, named-host load/recovery and supported deployment combinations. The target stack also needs implementation. | [Local environment](LOCAL-ENVIRONMENT.md), [M00](M00-QUALIFICATION.md), [recovery/load](RECOVERY-LOAD.md) |
| Core authority, reads and support | Authorized platform/model accounts and caller configurations, actual source freshness and permissions, real messaging sender/delivery observations, intended-use model/action behavior, accessibility and locale observations on the served application. | [Commerce foundation](COMMERCE-FOUNDATION.md), [model policy](MODEL-POLICY-REVIEW.md), [M05](M05-QUALIFICATION.md) |
| Returns, exchanges and edits | After the missing write adapters exist, observe the declared money, stock, payment, fulfillment, warehouse and carrier effects against original source identities; exercise unknown outcomes and recovery. | [M03](M03-QUALIFICATION.md), [M04](M04-QUALIFICATION.md), [M06](M06-QUALIFICATION.md) |
| Shipping and inventory | Real carrier and warehouse cycle, independent physical/source reconciliation, correction and partial-arrival behavior. Erasure before importing an unknown committed stock movement can still leave shared stock unresolved; no automatic post-erasure stock repair is established. | [M08](M08-QUALIFICATION.md), [inventory reconciliation](INVENTORY-RECONCILIATION.md) |
| Growth, partners and procurement | Qualify each named connected adapter, account, right, instrument, region and physical process. Unsupported optional providers stay unavailable. Forecasts need appropriate independent validation; local accounting does not prove supplier or manufacturing effects. | [M09](M09-QUALIFICATION.md), [M10](M10-QUALIFICATION.md), [M11](M11-QUALIFICATION.md) |
| Portable operation and pilot | Independent platform/runtime demonstrations, operations/security/privacy evidence and genuine merchant outcomes under the frozen pilot. Local TS/Python demos and PREP intake do not supply these observations. | [M07](M07-QUALIFICATION.md), [pilot protocol](PILOT-PROTOCOL.md), [real observation register](../work/qualification/M07-real-observations.json) |
| Governance, licenses and extensions | Source license terms are applied. Remaining work covers governance decisions, review of actual distribution artifacts, and independently contributed extension evidence. The optional code-mode need/risk decision is still open; the sandbox stays disabled without a go decision. | [M12](M12-QUALIFICATION.md), [extension governance](EXTENSION-GOVERNANCE.md), [license status](../LICENSE-STATUS.md) |
| Decision models and calibrated routing | Actual authorized backend observations on a predeclared held-out cohort, measured quality/latency/usage/cost, real second-backend comparison and optional self-hosted observations. Routing/scoring fixtures are implemented preparation. | [M13](M13-QUALIFICATION.md), [M14](M14-QUALIFICATION.md) |
| Image assistance | An actual enabled image path, frozen authorized cohort and independent labels, intake/processing/retention/deletion and target-host observations. Individual-image suppression is already implemented; audio/video remain disabled. | [Image assistance](IMAGE-ASSISTANCE.md), [suppression](IMAGE-SUPPRESSION.md), [remaining scope](../planning/goals/M17/M17-G05.md) |
| Shopper journeys | Qualified independent remote caller and actual handover, two complete merchant profiles over two qualified channels, connected reused actions and target-host observations. M15 is a missing implementation prerequisite. | [M18](M18-QUALIFICATION.md) |
| Loyalty | Complete purchase/redemption/return source reconciliation after the missing award/reversal and hold-resolution code lands; retain the goal-specific enrollment/redemption fault and provider/channel/host evidence. Missing award/reversal observations currently remain explicit exceptions. | [M19 assessment](M19-LOCAL-ASSESSMENT.md) |
| Drop-off | Actual method/partner observations, original-item consolidation and custody continuity, accessibility/outage handling, exact financial trigger, physical receiving/inspection and formal integrated assessment. G04/G05 remain implementation work. | [M20 record](../work/records/M20-dropoff-milestone.md), [item handoffs](DROPOFF-HANDOFFS.md) |

M15/M16 and M21–M25 retain their own active implementation packets and integrated
gates. Historical M00–M14/M17–M19 gate IDs remain traceable through the behavioral
contracts and Git; none becomes accepted merely because its repeated packet is
removed. The four early M00 development acceptances in the
[ledger](../work/accepted-goals.json) keep their original limited meaning.

## Keep the original release requirements

The frozen [support envelope](../planning/support-envelope.json),
[release benchmark](../planning/release-benchmark.json),
[behavioral specifications](../planning/test-specifications.json) and
[development governance](DEVELOPMENT-GOVERNANCE.md) remain authoritative for their
declared scope. Among the existing proposed v1 requirements are:

- 100% mandatory safety correctness, zero duplicate effects and unauthorized
  actions, and no open critical/high release-blocking findings.
- At least 200 unique executed scenario variants and the predeclared quality
  thresholds and per-configuration denominators; the catalogue's specification
  count is not an executed-test count.
- Two commerce platforms, two independent agent runtimes, two cloud-provider
  configurations and one local-model configuration for the declared shared scope.
- Three independent merchants, 100 in-scope live outcomes, 30 consecutive pilot
  days and seven-day follow-up, with the existing follow-up coverage requirement.

Do not replace absent connected/physical observations with fixture reports, or
change a cohort after seeing its results. Unknown outcomes retain their original
operation and reservations. Provider records, settlement, delivery, custody,
inspection and stock remain distinct stages. Optional exclusions require an
explicit supported-scope decision and remain visible as exclusions.

## Existing benchmark maintenance gap

The current envelope has 44 original target dispositions while the expanded
target catalogue contains 57. The benchmark inventory also pins the original
676-specification document, whereas the present retained contract set contains
949. These mismatches predate the planning cleanup. They need a reviewed
compatibility repair that retains the original source bytes, cohorts and
thresholds; deleting completed task packets cannot qualify or rebaseline them.

## Closing an obligation

Record the actual configuration, source observations, candidate, focused relevant
tests and independent reviews in the existing work/evidence flow. Apply the
original formal dependencies and authority rules before acceptance. Update this
guide when a real obligation closes; keep the implementation context in the
architecture and detailed historical decisions in Git.
