# M11 qualification assessment

**M11-G99 remains blocked.** ADR-0040 assigns bounded local development for all
ten worker goals and this assessment from the reviewed M10 checkpoint. The
accepted ledger, original goal packets, dependencies and formal criteria remain
unchanged. Recovery of the execution service permits local work; it supplies no
missing merchant, supplier, physical-stock or formal acceptance evidence.

## Original milestone obligations

The required demonstration explains a stockout risk, proposes a purchase order,
obtains approval and receives it partially without overstating stock. Both
original exit criteria apply together:

1. Backtests against named simple baselines and explicit forecast horizons are
   published, with no future-data leakage.
2. Receiving and transfers reconcile by SKU/location, and procurement agents
   cannot approve their own spending.

Formal acceptance requires accepted M11-G01 through G10, M07-G99 and M08-G99;
a current integrated candidate with the full applicable accepted regression
suite; the required connected and independent qualification; two independent
reviews; and a separate trusted acceptance decision. The local
`M11-PREP-INTEGRATION-01` case observes a synthetic journey on one kernel. It
does not execute or rename the original three formal G99 cases.

## Development and qualification map

| Goal | Assigned local outcome | Remaining qualification |
| --- | --- | --- |
| G01 | Immutable aggregate demand observations and revisions, historical availability cutoffs, source provenance, cancellations, returns, stockouts and missing-data distinctions. | Real historical data availability and merchant/source provenance remain unqualified. |
| G02 | Predeclared rolling temporal cohorts and horizons, named naive/seasonal baselines, exact error/bias/service metrics, retained zero and difficult SKUs. | Synthetic measured outcomes do not establish real merchant forecasting value. |
| G03 | Small deterministic methods evaluated against the declared baseline, explicit empirical error envelope, fallback/unsupported quality and current independent review. | The envelope makes no statistical coverage claim; real forecasting performance remains unqualified. |
| G04 | Explainable draft replenishment from reviewed forecast scope, canonical available/reserved stock, actual incoming obligations, lead time, minimums and supported units. | Unknown stock/receipt outcomes block confident arithmetic; no native ERP or supplier automation is qualified. |
| G05 | Source-bound supplier terms, exact unit/currency/cost arithmetic and immutable PO versions with separate draft, approved, sent and acknowledged states. | A fixture acknowledgment creates no real contract, invoice, payment or supplier obligation. |
| G06 | Current independent spending approval, atomic exact budget reservations, final permission/terms/stop checks and original unknown-send identity. | Connected supplier/account and commercial spending qualification remain absent. |
| G07 | Partial native receipt preparation, supported unit conversion, excess/duplicate blocking and reconciliation of the original effect after a lost response. | Connected physical receipt evidence is absent; permanent local cases use distinct PREP identities. |
| G08 | Additive supplier returns, cost corrections and credit observations tied to the original receipt, with exact once-only quantity/cost effects. | Local credit observations do not establish supplier settlement or real payment. |
| G09 | Versioned nested BOMs with exact dimension/conversion/yield/scrap arithmetic, cycle/missing-component checks and approved-job version pins. | Material specifications, costing and actual manufacturing applicability remain unqualified. |
| G10 | Approved production reservations, consumption, WIP, actual output/scrap and original native output identities through the existing stock owner. | Connected manufacturing and physical completion remain absent; permanent local cases use distinct PREP identities. |
| G99 | Assessment of the assigned local milestone and all original dependencies and exit criteria. | Blocked; no formal milestone acceptance or release. |

## Quantitative and source boundaries

`last_value_v1` and `seasonal_2_v1` remain named simple baselines. The small mean
methods are deterministic code, not language-model confidence. Historical
source availability constrains every training origin. Cohorts and horizons are
declared before scoring; unavailable and censored cells retain their denominators.
Relative metrics with zero denominators are explicitly undefined. A forecast
review authorizes use of its exact current assumptions, not a purchase or stock
effect. Supplier lead-time coverage must fit the actual forecast time window.

The existing WarehouseInventoryFixtureSource and LocationInventory remain the
available-stock source and canonical importer. New receipt, supplier correction
and production effects extend their original movement/command journals. No
second available-stock counter is introduced. Partial receipts move original
quantities from incoming to stock once; cancellations require source evidence.
Supplier returns do not silently reopen incoming purchase quantities. Transfers
retain SKU/location conservation on the same kernel and native source.

Unknown sends, receipts, corrections and production outcomes retain their
original operation and source identities. Missing current source guards deny new
bound effects after adapter reconstruction. Lookup of an already committed
original effect remains distinct from permission to dispatch another effect.
Source acknowledgment, physical receipt, invoice and payment are separate stages.

## Privacy, recovery and preservation

The 20 new tables contain merchant aggregate or customer-free catalog business
data; they do not fabricate customer ownership. Customer export excludes these
records and replay credentials. Canonical erasure reapplies explicit nested
allowlists even with an empty resource list. Restore, import and uninstall scrub
unexpected copied facts and revoke all new review, spending and stock authority
without requiring customer tombstones. Original quantitative obligations and
unresolved native identities survive as audit records.

All nine prior storage contracts, 234 table obligations and 41 migrations remain
byte-identical. The legacy 167 projection and independent 170/178/186/209
projections are retained. An additional 234-table fixture was derived from the
protected Git bytes before shared implementation. All old test registrations,
capability claims and 47 direct fixture facts remain; current metadata and five
retained test files receive only the prior-assigned additive maintenance.

The M08 limitation remains: erasure before an unknown committed stock movement
is imported can leave shared stock unresolved. New planning and stock work must
block unsafe assumptions. There is no speculative automatic stock repair.
Separate source databases, caller copies and historical checkpoint files retain
their own cleanup and physical-erasure limits.

## Evidence scope and remaining blockers

The selected development scope is 12 forecasting, 12 procurement, 16 stock/BOM/
production and nine retained privacy cases: 49 across four whole files. The
unchanged ceiling is 60 actual native cases and one total 60-second deadline per
invocation. Authors commit behavioral tests and independent expected results
first. Root alone runs the coherent candidate and repeats only affected or
not-yet-run whole files for concrete failures or consequential corrections.

Ten named faults alter actual isolated implementations and reach independent
behavioral assertions. `PORT-030`, `PORT-031-M11` and the later purchase-receiving
path of `PORT-025` have permanent local coverage. Formal `CASE-M11-G99-01`
through `-03` remain unperformed at their original scope. Actual commands,
counts, source/configuration hashes, failures, reviews and the separate local
maintainer decision belong to the accompanying checkpoint evidence; this
assessment preclaims no native pass or independent review.

Formal M07-G99/M08-G99, worker acceptance, connected G07/G10 evidence, actual
merchant forecasting value, and the original qualified integrated campaign and
trusted milestone decision remain blocking. The original expansion decision
uses measured forecast value and actual merchant need to decide whether native
planning or an ERP integration should expand. This local assignment does not
make that commercial decision. No supplier contact/order, real account/payment,
production deployment, hosted publication, release tag or M12 work is assigned.
