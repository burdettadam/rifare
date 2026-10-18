# ADR-0037: Warehouse inventory development and M08 assessment

## Prior authority and assignment

The owner requested "Proceed with next 5 goals" after the reviewed shipping,
packing and warehouse connector checkpoint. The delegated maintainer assigns
**M08-G07, M08-G08, M08-G09, M08-G10 and M08-G99** from clean local main
`60bdc1fa1281ea165a4edbf815eb8a1b02004ecf` for bounded development and local
nonrelease integration. The preceding checkpoint is
`Rifare-M08-shipping-five.zip`, SHA256
`25101c7269ce6a90a0a3221a030ddce72515105b47819b60470c4624d663f113`.

G07 and G10 implement local synthetic preparation; their original connected
obligations remain unperformed. G08 and G09 implement local source-owned inventory
and transfer behavior. G99 is the fifth entry and produces a blocked assessment,
not milestone acceptance or a broad milestone campaign. M07-G99 and all dependent
formal M08 prerequisites remain blocked. M09 is unassigned.

No live account, partner contact, external message, paid source operation,
production effect, hosted push, publication, tag or release is authorized. Local
synthetic sources cannot establish physical inventory or partner qualification.
The accepted-goal ledger and original goal packets remain unchanged.

## Concrete ownership

Native Git worktrees branch from this committed assignment, with one writer per
worktree. Root cherry-picks coherent author commits and owns shared integration.

| Scope | Writer and allowed paths |
| --- | --- |
| M08-G07 | Warehouse returns author: `packages/adapters/warehouse-fixture-source.mts`; new `packages/commerce/warehouse-return-events.mts` and contract; narrowly required effective-receipt/correction integration in `return-lifecycle-core.mts`, `return-receiving.mts` and `return-disposition.mts`; additive `migrations/commerce/034_warehouse_return_events.sql`; one new `tests/development/warehouse-return-events.test.mts` plus helper/fixtures; local demo, guide and G07 work record. |
| M08-G08 and G09 | Inventory author: new `packages/commerce/location-inventory.mts`, `inventory-transfers.mts` and contracts; a synthetic inventory adapter wrapper over the existing WarehouseFixtureSource database/identity under `packages/adapters/warehouse-inventory-fixture-source.mts`; additive `migrations/commerce/035_location_inventory.sql`; one new `tests/development/location-inventory.test.mts` plus helper/fixtures; local demo, guide and G08/G09 records. The existing warehouse source file belongs to the returns author. |
| M08-G10, G99 and shared integration | Root: new `packages/commerce/inventory-reconciliation.mts`, its contract, one new `tests/development/inventory-reconciliation.test.mts`, fixtures, demo and guide; G10/G99 and batch records, M08 qualification assessment, PLANS/README; privacy/export/restore integration, additive storage extension, registrations, component inventory and reviewed conformance/privacy source pins. |

Authors agree exact interfaces before implementing cross-module calls. The
inventory wrapper shares the existing warehouse's native identity and physical
stock store; it must not introduce a competing return restock executor. Existing
ReturnReceiving, ReturnDisposition, packing and shipping APIs stay canonical.
Replacement inventory retains its separate fulfillment-source ownership.

## Behavior and preservation requirements

Native warehouse return events retain source identity, event identity, sequence,
operator/evidence references, declared completeness and linked corrections.
Delivery alone never establishes receipt, inspected grade or disposition.
Original receiving scans/units remain immutable. Effective correction state
participates in receipt integrity and invalidates stale disposition approval.
An external disposition remains a fence against applying another local restock.

Location movements are append-linked and distinguish absolute source snapshots
from quantity deltas. Each stock field has an explicit owner. Incompatible source
claims produce discrepancies rather than summed balances. Available, on-hand,
reserved and in-transit quantities remain separately explained.

Transfers require current authority and approval, preserve original command and
source identities, and conserve quantity through reservation, dispatch, partial
receipt, loss and linked corrections. Destination available stock cannot appear
while the same units are still available at the origin. Unknown outcomes repair
through original-source observation rather than a fresh effect identity.

Full-cycle reconciliation reads canonical packing/carrier/receipt/disposition
and movement records with their original identities. Missing, duplicate,
out-of-order, conflicting and externally changed stock stays explicit. Repair
imports an existing source observation or repairs a ledger link; reconciliation
cannot resend a physical effect to make its report green. Packing currently
declares no inventory effect and cannot silently become a stock deduction.

Every new commerce table has explicit scope, subject-export, erasure/minimization,
restore/quarantine and audit behavior. Separate synthetic source databases and
caller copies require independent operator cleanup. Keep original immutable
evidence and minimal stock/effect identities through privacy handling.

## Prior additive metadata authorization

The protected base has 1,288 source paths, 2,746 registrations, 143 capability
objects, 178 current commerce tables, 33 migrations and fifteen privacy surfaces.
Keep every prior member and requirement. New executable cases and proposed
capabilities are additive. G07/G10 preparation uses distinct local IDs and
capabilities; G99's original formal acceptance cases stay unperformed. Existing
PORT-025 remains registered and its later-path cases receive distinct IDs.

Before implementation, this assignment authorizes only the necessary increases
to current schema/migration/catalog totals and exact new membership in the same
five retained tests: privacy coverage, return portability, installation upgrade,
adapter catalog and compatibility matrix. Preserve all old IDs and behavioral
assertions, the immutable 170-table fixture, the eight shipping table identities,
all 178 prior classifications, all prior migrations and rollback assertions, and
the legacy 167-table projection and six prior storage contracts. Strengthen the
current inventory check with an independent original-178 projection and explicit
new names. Do not replace an old oracle with current implementation output.

Conformance additions retain every old adapter, operation, case, scope, pin target
and all 47 direct fixture outcomes. Assigned source changes may refresh their
exact source/version hashes, dependent descriptors and expected-coverage pins;
this is not qualification and does not authorize altering behavior expectations.
All such changes require independent regression review before local integration.

## Focused evidence and review

Retain the owner's **60 actual cases, four whole files and one 60-second deadline
per invocation**. Plan three new whole files (return events, inventory/transfers,
reconciliation) totaling at most 51 cases plus the existing nine-case privacy
file. Authors commit behavioral tests before product implementation and do not
run independent suites. Root runs the coherent candidate once.

Each worker's named fault must execute actual isolated changed module source
inside a selected case and fail a behavioral assertion. Setup errors, copied
result changes, skipped cases and report-only evidence are not proof. Repeat
only whole files affected by a concrete failure or consequential review fix.
No broad regression, browser, controller, nested catalog, restoration or connected
campaign is implied by this development batch or its blocked G99 assessment.

Fresh nonauthor authority/security and regression sessions review the exact
candidate, protected base and native evidence without duplicate suites. Concrete
blockers remain until resolved; at most three corrective review rounds apply.
Root makes the separate local integration decision, preserves native branch
history and saves the cumulative source/evidence checkpoint.
