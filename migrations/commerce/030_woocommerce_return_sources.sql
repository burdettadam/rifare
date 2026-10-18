CREATE TABLE commerce_woo_return_sources (
 tenant_id TEXT NOT NULL, store_id TEXT NOT NULL, resource_id TEXT NOT NULL,
 source_identity TEXT NOT NULL, account_id TEXT NOT NULL, native_order_id TEXT NOT NULL,
 revision INTEGER NOT NULL, source_revision INTEGER NOT NULL, source_digest TEXT NOT NULL,
 body TEXT NOT NULL CHECK(json_valid(body)), digest TEXT NOT NULL, observed_at INTEGER NOT NULL,
 PRIMARY KEY(tenant_id,store_id,resource_id),
 UNIQUE(tenant_id,store_id,source_identity,native_order_id)
) STRICT;
CREATE TABLE commerce_woo_rma_bindings (
 tenant_id TEXT NOT NULL, store_id TEXT NOT NULL, request_id TEXT NOT NULL, resource_id TEXT NOT NULL,
 body TEXT NOT NULL CHECK(json_valid(body)), digest TEXT NOT NULL, created_at INTEGER NOT NULL,
 PRIMARY KEY(tenant_id,store_id,request_id)
) STRICT;
CREATE TABLE commerce_woo_event_observations (
 tenant_id TEXT NOT NULL, store_id TEXT NOT NULL, event_id TEXT NOT NULL, resource_id TEXT NOT NULL,
 body TEXT NOT NULL CHECK(json_valid(body)), digest TEXT NOT NULL, observed_at INTEGER NOT NULL,
 PRIMARY KEY(tenant_id,store_id,event_id)
) STRICT;
