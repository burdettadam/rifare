# Point-in-time demand and reviewed forecasts

M11-G01–G03 add bounded local demand reconstruction, frozen rolling backtests,
and per-SKU forecasts. The implementation consumes a separate synthetic source
journal. It does not qualify a live demand connector, actual business forecasting
performance, or any supplier purchase. The M07-G99 and M08-G99 prerequisites and
formal worker acceptance remain open under ADR-0040.

## Historical data that stays historical

`DemandFixtureSource` appends immutable revisions of a daily aggregate identified
by catalog resource, variant, location and unit. Each revision includes the daily
event timestamp, its declared availability timestamp, and the source observation
timestamp captured by the fixture source when it is appended. A correction cannot
backdate that last timestamp or move its original bucket to a different SKU/day.
The journal accepts no order, customer, address, free-text notes, session or model
fields. It records sales, cancellations, returns, stockouts and missing data.

`DemandHistory.sync` checks the actual source class, store identity, separate
database and revision digest before importing the journal. Canonical `imported_at`
records when this application imported the archive. Historical reconstruction uses
the archived source observation and availability times; it does not pretend that
the local application had already imported those records on their historical date.
A real source's historical availability guarantees are not established by this
fixture. Two connections to the same file do not count as independent databases.

A snapshot includes only revisions whose event, availability and source observation
times are at or before its cutoff. Every original revision is retained in storage,
and a snapshot cannot be overwritten under its ID. Rebuilding an earlier snapshot
after a later correction retains its original visible observations. A conflicting
second source for the same series is blocked until source ownership is resolved.

Daily demand is sales minus cancellations. Returns are reported separately, and
retained units also subtract those observed returns. A missing day has null demand;
an observed zero retains zero. Stockout sales are lower bounds with explicit flags,
not invented lost-demand estimates. Daily closing timestamps are UTC boundaries.
This implementation bounds snapshots to four declared series, 32 daily buckets,
128 visible revisions and one million units per daily fact. The existing JSON
size bound remains in effect.

## Frozen rolling evaluation

`ForecastBacktests.declare` stores the immutable dataset digest, entire cohort,
rolling origins, horizons, tuning cutoff, method version and baseline versions
before any scoring. Evaluation has no argument for replacing the cohort or
dropping weak SKUs. A newly declared experiment has its own identity and visible
denominator. Old experiments are never rewritten when a method changes.

Training for each origin is reconstructed from the source revisions available
at that origin, including later-known changes only when they were then observable.
The declared tuning cutoff must be strictly before the first forecast origin.
Holdout horizons are subsequent days within the frozen dataset. The two named
baselines are `last_value_v1` and `seasonal_2_v1`; the deterministic candidate
methods are `mean_2_v1` and `mean_3_v1`.

Each SKU, origin and horizon remains in the result. Missing/censored training or
holdout cells remain explicitly unscored. Results expose declared, scored and
unscored denominators, exact windows, observation digests, baseline predictions,
absolute error, signed bias, MAE, WAPE, underprediction and overprediction units.
Relative rates are null when actual units are zero. Counterfactual service rate
means the share of actual units covered by the prediction; it excludes inventory,
supplier delays and observed physical service performance.

The independent fixture contains alternating demand, true zeros, and difficult
intermittent demand. Three SKUs and two origins produce six cells per horizon.
For the two-day horizon, the last-value baseline's errors are `+2, 0, -6, +2, 0,
+12`: absolute error 22, signed error 10, six underpredicted units and 16
overpredicted units against 18 actual units. The seasonal baseline and two-day
mean candidate each have absolute error six. A tie is not an improvement.

## Forecast scope, uncertainty and review

`InventoryForecasts.create` binds one catalog resource, variant, location, `each`
unit and evaluated horizon to exact snapshot and backtest digests. It also pins
the current catalog version and content. The candidate is chosen only for strictly
lower per-SKU, per-horizon MAE on complete identical cells. Otherwise the selected
method remains the named baseline. No model confidence value is accepted as input.

At least four uncensored historical days and two fully scored cells for both
methods are required by this bounded implementation. Missing historical days,
at least half of history being censored, or an unavailable recent prediction
produce `unsupported` quality and null quantities. These implementation choices
do not replace the original formal acceptance criteria.

The uncertainty envelope uses the maximum measured absolute residual for the
selected method and exact SKU/horizon. Bounds are nonnegative integer units;
planning quantity rounds up, lower bounds round down, and upper bounds round up.
The sample count is visible. This is an empirical envelope with no probability
or coverage guarantee. Zero-width bounds can mean a constant short fixture with
zero historical residuals; they never mean future demand is certain.

The shared consumer API is:

```ts
const forecasts = new InventoryForecasts(kernel);
const forecast = forecasts.assertReviewed(scope, {
  forecast_id: storedId,
  expected_digest: storedDigest,
});
```

The result includes stored quantities, bounds, units, location, horizon, method,
baseline comparison, dataset/backtest pins and the actual current review reference.
It is suitable for an explainable replenishment draft. It grants no purchase,
payment, inventory or supplier-send authority.

`approve` requires current `action.approve` permission on the same resource, a
different actor from the proposer, an exact forecast digest and an expiry within
the forecast's own horizon. `assertReviewed` rechecks the current proposer and
reviewer permissions and their revisions, current catalog pin, immutable dataset
and backtest pins, review expiry and revocation. Historical `read` remains available
after expiry; it does not claim that approval is current.

## Storage, privacy and recovery

Migration 042 adds five store-scoped tables: demand observations, snapshots,
forecast backtests, inventory forecasts and forecast reviews. Resource columns
refer to customer-free catalog records. No customer identity is invented for
merchant planning data. Customer subject export returns empty arrays for these
tables, and unrelated subjects cannot gain access to a merchant's forecasts.

`forecast-privacy.mts` provides explicit nested field allowlists. Every hash-only
subject erasure reapplies those allowlists so malformed restored extra fields do
not persist. Whole-store import, restore and uninstall revoke every forecast review
even without a subject tombstone. Restore strips reviewer authority fields and
requires a new authenticated review after current record checks. A changed or
malformed saved dependency fails its digest check; it is not silently repaired into
an approved forecast. Canonical erasure performs no deletion in the independent
fixture source or historical checkpoints.

The prior unresolved-inventory restriction remains with the canonical inventory
owner. A reviewed forecast cannot make uncertain stock or a missing movement
known; procurement must still check inventory reconciliation before using it.

## Development evidence and rollback

The 12 whole-file native cases and independent fixture were committed first in
`0e04437`. The three fault cases mutate actual isolated implementation files to
ignore correction availability, mix later rows into training, or replace measured
comparison with a high confidence score. Each has an independent behavioral
assertion. The author executes no product modules, tests, demos or runners; root
captures the integrated bounded invocation and all actual native results.

The public methods use the existing CommerceKernel and permission system. No new
dependencies, execution owner, live connector or migration of an old table is
introduced. Rollback means disabling use of new records and restoring the prior
reviewed source/database checkpoint; do not drop records needed to explain a
later procurement draft or migrate a live database backwards by deleting history.
