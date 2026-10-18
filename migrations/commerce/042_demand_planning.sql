CREATE TABLE commerce_demand_observations (
 tenant_id TEXT NOT NULL, store_id TEXT NOT NULL, id TEXT NOT NULL,
 resource_id TEXT NOT NULL, source_identity TEXT NOT NULL,
 observation_id TEXT NOT NULL, revision INTEGER NOT NULL,
 body TEXT NOT NULL CHECK(json_valid(body)), digest TEXT NOT NULL,
 PRIMARY KEY(tenant_id,store_id,id),
 UNIQUE(tenant_id,store_id,source_identity,observation_id,revision)
) STRICT;
CREATE TABLE commerce_demand_snapshots (
 tenant_id TEXT NOT NULL, store_id TEXT NOT NULL, id TEXT NOT NULL,
 body TEXT NOT NULL CHECK(json_valid(body)), digest TEXT NOT NULL,
 PRIMARY KEY(tenant_id,store_id,id)
) STRICT;
CREATE TABLE commerce_forecast_backtests (
 tenant_id TEXT NOT NULL, store_id TEXT NOT NULL, id TEXT NOT NULL,
 state TEXT NOT NULL CHECK(state IN ('declared','evaluated')),
 body TEXT NOT NULL CHECK(json_valid(body)), digest TEXT NOT NULL,
 PRIMARY KEY(tenant_id,store_id,id)
) STRICT;
CREATE TABLE commerce_inventory_forecasts (
 tenant_id TEXT NOT NULL, store_id TEXT NOT NULL, id TEXT NOT NULL,
 resource_id TEXT NOT NULL, state TEXT NOT NULL,
 body TEXT NOT NULL CHECK(json_valid(body)), digest TEXT NOT NULL,
 PRIMARY KEY(tenant_id,store_id,id)
) STRICT;
CREATE TABLE commerce_forecast_reviews (
 tenant_id TEXT NOT NULL, store_id TEXT NOT NULL, id TEXT NOT NULL,
 resource_id TEXT NOT NULL, forecast_id TEXT NOT NULL,
 state TEXT NOT NULL CHECK(state IN ('approved','revoked')),
 body TEXT NOT NULL CHECK(json_valid(body)), digest TEXT NOT NULL,
 PRIMARY KEY(tenant_id,store_id,id)
) STRICT;
CREATE INDEX commerce_demand_observations_resource ON commerce_demand_observations(tenant_id,store_id,resource_id);
CREATE INDEX commerce_forecast_reviews_target ON commerce_forecast_reviews(tenant_id,store_id,forecast_id,state);
