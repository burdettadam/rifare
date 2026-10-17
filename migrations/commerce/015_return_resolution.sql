CREATE TABLE commerce_resolution_settings (
 tenant_id TEXT NOT NULL, store_id TEXT NOT NULL, revision INTEGER NOT NULL,
 body TEXT NOT NULL CHECK(json_valid(body)), digest TEXT NOT NULL,
 PRIMARY KEY(tenant_id,store_id)
) STRICT;
CREATE TABLE commerce_resolution_plans (
 tenant_id TEXT NOT NULL, store_id TEXT NOT NULL, id TEXT NOT NULL, request_id TEXT NOT NULL,
 case_id TEXT NOT NULL, resource_id TEXT NOT NULL, request_key TEXT NOT NULL,
 body TEXT NOT NULL CHECK(json_valid(body)), digest TEXT NOT NULL,
 PRIMARY KEY(tenant_id,store_id,id), UNIQUE(tenant_id,store_id,request_id), UNIQUE(tenant_id,store_id,request_key)
) STRICT;
CREATE TABLE commerce_resolution_allocations (
 tenant_id TEXT NOT NULL, store_id TEXT NOT NULL, id TEXT NOT NULL, plan_id TEXT NOT NULL,
 case_id TEXT NOT NULL, resource_id TEXT NOT NULL, line_id TEXT NOT NULL,
 outcome TEXT NOT NULL CHECK(outcome IN ('refund','store_credit','exchange')),
 body TEXT NOT NULL CHECK(json_valid(body)), digest TEXT NOT NULL,
 PRIMARY KEY(tenant_id,store_id,id)
) STRICT;
CREATE TABLE commerce_resolution_units (
 tenant_id TEXT NOT NULL, store_id TEXT NOT NULL, resource_id TEXT NOT NULL,
 line_id TEXT NOT NULL, unit_index INTEGER NOT NULL CHECK(unit_index>0), allocation_id TEXT NOT NULL,
 PRIMARY KEY(tenant_id,store_id,resource_id,line_id,unit_index)
) STRICT;
CREATE TABLE commerce_resolution_quotes (
 tenant_id TEXT NOT NULL, store_id TEXT NOT NULL, id TEXT NOT NULL, allocation_id TEXT NOT NULL,
 case_id TEXT NOT NULL, resource_id TEXT NOT NULL,
 body TEXT NOT NULL CHECK(json_valid(body)), digest TEXT NOT NULL,
 PRIMARY KEY(tenant_id,store_id,id)
) STRICT;
CREATE TABLE commerce_resolution_operations (
 tenant_id TEXT NOT NULL, store_id TEXT NOT NULL, id TEXT NOT NULL, allocation_id TEXT NOT NULL,
 case_id TEXT NOT NULL, resource_id TEXT NOT NULL, receipt_id TEXT NOT NULL, quote_id TEXT NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN ('refund','store_credit')), amount_minor TEXT NOT NULL, currency TEXT NOT NULL,
 source_identity TEXT NOT NULL, command TEXT NOT NULL CHECK(json_valid(command)), digest TEXT NOT NULL,
 state TEXT NOT NULL CHECK(state IN ('authorized','unknown','accepted','settled','issued','rejected')),
 native_id TEXT, observed_at INTEGER NOT NULL,
 PRIMARY KEY(tenant_id,store_id,id), UNIQUE(tenant_id,store_id,allocation_id), UNIQUE(tenant_id,store_id,source_identity,native_id)
) STRICT;
CREATE TABLE commerce_resolution_observations (
 seq INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id TEXT NOT NULL, store_id TEXT NOT NULL,
 operation_id TEXT NOT NULL, resource_id TEXT NOT NULL, stage TEXT NOT NULL,
 body TEXT NOT NULL CHECK(json_valid(body)), digest TEXT NOT NULL, observed_at INTEGER NOT NULL
) STRICT;
CREATE TRIGGER commerce_resolution_observations_no_update BEFORE UPDATE ON commerce_resolution_observations BEGIN SELECT RAISE(ABORT,'RESOLUTION_RECEIPT_IMMUTABLE'); END;
CREATE TRIGGER commerce_resolution_observations_no_delete BEFORE DELETE ON commerce_resolution_observations BEGIN SELECT RAISE(ABORT,'RESOLUTION_RECEIPT_IMMUTABLE'); END;
CREATE TABLE commerce_exchange_quotes (
 tenant_id TEXT NOT NULL, store_id TEXT NOT NULL, id TEXT NOT NULL, allocation_id TEXT NOT NULL,
 case_id TEXT NOT NULL, resource_id TEXT NOT NULL, body TEXT NOT NULL CHECK(json_valid(body)), digest TEXT NOT NULL,
 PRIMARY KEY(tenant_id,store_id,id)
) STRICT;
CREATE INDEX commerce_resolution_operations_order ON commerce_resolution_operations(tenant_id,store_id,resource_id,state);
