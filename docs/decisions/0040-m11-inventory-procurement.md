# ADR-0040: All M11 goals in bounded local development

## Assignment and retained authority

The owner requested "Proceed with all goals for next milestone" after the reviewed
M10 checkpoint and then "Correct the blocker. If this chat is broken, prepare a
handoff zip to take to a new chat." The temporary execution-service disconnect
has recovered. Read-only Git inspection confirmed that the interrupted attempt
created no M11 worktree and left local main clean. Root then created this isolated
integration worktree with native Git.

The delegated maintainer assigns **M11-G01 through G10 and the M11-G99 assessment**
from protected main `8096abe27043852d86295b15d4708875fd1434de`, tree
`690def0291e24930951f8ee6b74504d4db95a279`. The saved cumulative predecessor is
`Rifare-M10-warranty-partners-trials.zip`, SHA256
`ca70a90bed9ae2e67fc087c652557ac1c0175a7b742c1a53671159167bb014d0`.

This assigns local development of all ten workers, with distinct connected
preparation for G07 and G10, and an honest blocked formal G99 assessment. It does
not accept the still-open M07-G99 or M08-G99 prerequisites, original worker goals,
connected source/physical observations, or a production release. The acceptance
ledger, original planning packets, goal dependencies and formal criteria remain
unchanged. M12 is not assigned.

Native worktrees, source commits, bounded checks, two independent reviews, local
nonrelease integration and cumulative recovery/handoff packaging are authorized.
No hosted publication, tags, contacts, contracts, supplier orders, real account
administration, production data, paid model use or real money/stock effects are
authorized. Simulator results remain explicitly synthetic.

## Ownership and allowed paths

Root is the integration owner. Each author writes only its assigned worktree
branched from this committed assignment. Root coordinates shared source metadata
and, after handoff, owns integrated corrections. Authors and reviewers execute
no duplicate product suites or demos. Native local Git remains the workflow.

| Owner | Goals and concrete paths |
| --- | --- |
| Forecast author | G01-G03. New `packages/commerce/{demand-history,forecast-backtests,inventory-forecasts,forecast-core,forecast-privacy}.mts`, `packages/adapters/demand-fixture-source.mts`, three matching contracts, `migrations/commerce/042_demand_planning.sql`, `tests/development/{demand-planning.test,demand-planning-helpers}.mts`, `tests/fixtures/demand-planning/`, `docs/DEMAND-PLANNING.md`, and G01-G03 work records. |
| Procurement author | G04-G06. New `packages/commerce/{replenishment-planning,supplier-purchase-orders,procurement-approvals,procurement-core,procurement-privacy}.mts`, `packages/adapters/{procurement-fixture-source,procurement-source-guards}.mts`, three matching contracts, `migrations/commerce/043_procurement.sql`, `tests/development/{procurement-planning.test,procurement-planning-helpers}.mts`, `tests/fixtures/procurement/`, `docs/PROCUREMENT.md`, and G04-G06 work records. |
| Stock author | G07-G10. New `packages/commerce/{purchase-receiving,supplier-returns,bill-of-materials,production-orders,procurement-inventory-core,procurement-inventory-privacy}.mts`, `packages/adapters/procurement-inventory-source-guards.mts`, four matching contracts, `migrations/commerce/044_procurement_inventory.sql`, `tests/development/{procurement-inventory.test,procurement-inventory-helpers}.mts`, `tests/fixtures/procurement-inventory/`, `docs/PROCUREMENT-INVENTORY.md`, and G07-G10 work records. This is the sole author of narrow additions to existing `packages/adapters/warehouse-inventory-fixture-source.mts` and, only where necessary for typed current movement import, `packages/commerce/location-inventory.mts`. |
| Root | Shared `inventory-planning-privacy.mts`, canonical privacy/export/import/recovery wiring, additive execution-stop action membership, new storage extension and independently frozen 234-table fixture, retained privacy cases and new fixture helper, one reserved local integration case after author handoff, permitted metadata/hash updates, README/PLANS, G99/qualification/integration records, actual reviews/evidence and cumulative packaging. |

Any additional old source edit needs a concrete prior maintainer scope decision.
Do not add a second stock ledger, duplicate approval kernel, scheduler, custom Git
wrapper, mandatory provider, or merchant-specific core branch. Source fixtures
remain in separate databases; file-path equality checks prevent two connections
to the same database being mistaken for independent source evidence.

## Cross-author interfaces and required behavior

Authors agree the exact new exported API before completing tests. The forecast
service exposes stored scoped forecast references and immutable digests through
the existing CommerceKernel, rather than a caller-supplied approval flag. A
forecast record binds dataset cutoff/digest, method and baseline versions,
cohort/backtest windows, horizon, units, estimates, uncertainty and quality.
Replenishment checks its current independent review and actual eligible scope.

The procurement service exposes immutable PO ID/version/obligation references
through authenticated reads. A receipt binds actual supplier terms, SKU/location,
ordered units, supported conversion, currency/line cost, sent/acknowledged source
identity and original PO version. Receipt state is owned by the stock author's
source-reconciled receipt journal. Its reusable read-only summary distinguishes
ordered, cancelled, confirmed received, unknown and outstanding quantities.
The procurement author must not invent a second received-quantity counter.

The first author to need a cross-area interface communicates its proposed shape
to root and the other author. Pure shared reads may be exported from the relevant
owner's core module. A caller-provided object or callback cannot authenticate a
forecast, native receipt, approval or source result.

### Forecasting and replenishment

Demand snapshots filter both event time and observation/availability time, retain
source provenance and known corrections, and declare returns/cancellation,
stockout and missing-data treatment. Future corrections cannot rewrite a frozen
historical snapshot. Rolling backtests preserve predeclared cohorts, zero-demand
and difficult SKUs, exact horizons and train/holdout separation. Named naive and
seasonal baseline versions, independent known-answer metrics, signed bias and
stock/service outcomes remain visible. No random split or post-score pruning.

A small deterministic forecasting method is sufficient within its actually
evaluated scope. Its uncertainty calculation, units, denominator handling and
supported horizon are declared implementation choices, not invented acceptance
thresholds. Underperformance retains the baseline or blocks an improvement claim.
Insufficient or heavily censored history reports fallback/unsupported quality.
No language-model confidence score is a forecasting or purchasing authority.

Replenishment uses canonical inventory positions, reservations, independently
reviewed forecast assumptions, supported unit arithmetic, supplier lead times,
minimums and source-confirmed open PO obligations. Partial receiving moves units
from incoming to on-hand once. Unknown receipts or unresolved inventory block
confident arithmetic. Replenishment produces an explainable draft only.

### Purchasing and stock effects

Supplier terms and PO versions bind reproducible exact quantities, conversions,
currency, prices, totals and lead times. Drafted, approved, sent and acknowledged
are distinct. Changes to reviewed obligations invalidate authority. Approval,
drafting and sending require current distinct permissions; the drafting actor
cannot approve the same purchase. Current terms, independent approval, expiry,
revocation, execution stops and total obligation are checked again at the final
source boundary. Atomic exact-arithmetic budget reservations prevent concurrent
oversubscription. Unknown sends retain their original obligation and source ID.

Receiving uses the existing WarehouseInventoryFixtureSource movement owner and
LocationInventory importer. Original receipt identity survives new caller IDs,
lost responses, restart and reconciliation. Excess quantities, incompatible
units and duplicates cannot inflate stock. Receiving is separate from invoice,
payment, credit and supplier acknowledgment. Supplier returns and corrections
are additive records tied to the original receipt; they never delete history or
silently rewrite approved cost. Return/credit replays adjust obligations once.

Versioned nested BOMs validate component references, cycles, dimensions, exact
conversions, positive yield and scrap treatment. Production jobs preserve the
approved BOM version. Reservations, consumption, WIP, actual output and scrap
have explicit unit/cost treatment and original source-linked movements. Native
completion cannot receive output before required components are consumed or
reconciled. Partial completion and correction remain explicit. Different request
keys or a crash after native output cannot produce another receipt. Durable
source guard bindings must survive a new adapter instance; missing current guards
deny new bound effects while retaining lookup of the original committed result.

### Privacy and recovery

New tables have explicit tenant/store scope and resource/subject scope where
applicable. Inventory/supplier business data must not invent a customer identity
merely to reuse an order-specific helper. Any referenced customer/order facts
must be minimized and erased through canonical privacy paths. Export uses
explicit allowlists, excludes unrelated subjects and replay credentials, and
retains honest separate-source and historical-copy cleanup limitations. Repeated
hash-only erasure and restored minimized records must not regain private fields.
Import, restore and uninstall revoke forecast reviews, procurement/production
approvals, execution grants and source guard authority, including records without
a customer tombstone. Original uncertain effects remain reconcilable by identity.

The prior M08 limitation remains: erasure before an unknown committed movement
is imported may leave shared stock unresolved. This assignment must block unsafe
new planning/stock assumptions and document the operator duty. It does not
silently add a speculative stock-repair mechanism.

## Protected baseline and metadata maintenance

The protected source has 1,472 tracked paths, 2,893 registration objects, 175
capability objects, 234 tables, 41 migrations, nine storage contracts, fifteen
privacy surfaces, 257 runtime source pins, 33 adapters, 178 operations and 191
declared native cases. Retain all old members, behavioral assertions, fixtures,
source obligations and formal qualification claims.

This prior assignment authorizes additive current table/migration/catalog counts
and exact hash/version membership maintenance in the same five retained tests:
privacy coverage, return portability, installation upgrade, adapter catalog and
compatibility matrix. Their existing case names/order and old behavior remain.
All nine old storage contracts and all 41 migrations stay byte-exact; retain all
older frozen projections and add a frozen 234-table projection derived only from
protected Git bytes. New paths receive explicit component ownership and honest
proposed capability/adapter declarations. Direct old fixture changes are limited
to affected source descriptor version pins; old source inputs/outcomes remain.
The generic JSON bound and separately bounded catalog reader are unchanged.

## Bounded evidence and review

The owner-requested limits remain **60 actual native cases, four whole files and
one total 60-second deadline per invocation**. The planned selection is 49:
12 forecasting, 12 procurement (including one root integration slot), 16
receipt/BOM/production and the retained nine privacy cases. Within these totals,
each worker's three original behavioral obligations and named fault remain.
G07/G10 use distinct PREP identities; G99 formal cases remain unperformed.
PORT-030, PORT-031 and the later receiving path of PORT-025 remain exercised.

Authors commit tests and independent known-answer fixtures before implementation
and run no product modules/suites/demos. Root runs the coherent integrated
selection once, repeating only affected or not-yet-run whole files for a concrete
failure or consequential correction. Each named fault changes an actual isolated
implementation and is detected by an independent behavioral assertion; import,
syntax, wrapper and zero-test failures do not count as fault proof.

The local demonstration explains a stockout risk, drafts a PO, obtains separate
approval and partially receives it without overstating stock. It includes named
backtest horizons and source-linked receipt/transfer conservation on the same
kernel. It is local preparation, not the formal G99 campaign.

Retain every actual invocation, native XML/TAP case, failure, timer, source and
configuration hash. Two fresh nonauthor final authority/security and regression
reviewers inspect exact source/evidence without duplicate product execution,
within the existing three-correction-round limit. Any carried result needs the
exact source delta and both final reviews. A blocked G99 assessment does not
trigger a full, browser, controller, nested catalog, restoration, connected or
release campaign. Root's actual local integration decision remains separate
from independent reviews and formal acceptance.
