-- Local synthetic packing observations. These rows do not settle stock or prove
-- physical shipment. Retain identities through privacy minimization and restore.
CREATE TABLE commerce_packing_sessions (
 tenant_id TEXT NOT NULL, store_id TEXT NOT NULL, id TEXT NOT NULL,
 resource_id TEXT NOT NULL, package_id TEXT NOT NULL,
 state TEXT NOT NULL CHECK(state IN ('open','confirmed','cancelled','shipped')),
 revision INTEGER NOT NULL CHECK(revision>=1), expected_count INTEGER NOT NULL CHECK(expected_count>=1),
 packed_count INTEGER NOT NULL CHECK(packed_count>=0), confirmation_id TEXT,
 body TEXT NOT NULL CHECK(json_valid(body)), digest TEXT NOT NULL,
 created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
 PRIMARY KEY(tenant_id,store_id,id), UNIQUE(tenant_id,store_id,package_id),
 FOREIGN KEY(tenant_id,store_id,resource_id) REFERENCES commerce_resources(tenant_id,store_id,id) DEFERRABLE INITIALLY DEFERRED
) STRICT;
CREATE INDEX commerce_packing_sessions_resource ON commerce_packing_sessions(tenant_id,store_id,resource_id);

CREATE TABLE commerce_packing_allocations (
 tenant_id TEXT NOT NULL, store_id TEXT NOT NULL, id TEXT NOT NULL,
 resource_id TEXT NOT NULL, session_id TEXT NOT NULL, unit_key TEXT NOT NULL,
 state TEXT NOT NULL CHECK(state IN ('allocated','shipped','released')),
 scanned INTEGER NOT NULL CHECK(scanned IN (0,1)),
 body TEXT NOT NULL CHECK(json_valid(body)), digest TEXT NOT NULL,
 PRIMARY KEY(tenant_id,store_id,id), UNIQUE(tenant_id,store_id,session_id,unit_key),
 FOREIGN KEY(tenant_id,store_id,session_id) REFERENCES commerce_packing_sessions(tenant_id,store_id,id) DEFERRABLE INITIALLY DEFERRED
) STRICT;
CREATE UNIQUE INDEX commerce_packing_units_reserved ON commerce_packing_allocations(tenant_id,store_id,resource_id,unit_key) WHERE state!='released';
CREATE INDEX commerce_packing_allocations_resource ON commerce_packing_allocations(tenant_id,store_id,resource_id);

CREATE TABLE commerce_packing_scans (
 tenant_id TEXT NOT NULL, store_id TEXT NOT NULL, id TEXT NOT NULL,
 resource_id TEXT NOT NULL, session_id TEXT NOT NULL, command_digest TEXT NOT NULL,
 outcome TEXT NOT NULL CHECK(outcome IN ('accepted','wrong_sku','unexpected_unit','duplicate_unit')),
 body TEXT NOT NULL CHECK(json_valid(body)), digest TEXT NOT NULL, created_at INTEGER NOT NULL,
 PRIMARY KEY(tenant_id,store_id,id),
 FOREIGN KEY(tenant_id,store_id,session_id) REFERENCES commerce_packing_sessions(tenant_id,store_id,id) DEFERRABLE INITIALLY DEFERRED
) STRICT;
CREATE INDEX commerce_packing_scans_resource ON commerce_packing_scans(tenant_id,store_id,resource_id);

CREATE TABLE commerce_packing_confirmations (
 tenant_id TEXT NOT NULL, store_id TEXT NOT NULL, id TEXT NOT NULL,
 resource_id TEXT NOT NULL, session_id TEXT NOT NULL,
 body TEXT NOT NULL CHECK(json_valid(body)), digest TEXT NOT NULL, created_at INTEGER NOT NULL,
 PRIMARY KEY(tenant_id,store_id,id), UNIQUE(tenant_id,store_id,session_id),
 FOREIGN KEY(tenant_id,store_id,session_id) REFERENCES commerce_packing_sessions(tenant_id,store_id,id) DEFERRABLE INITIALLY DEFERRED
) STRICT;
CREATE INDEX commerce_packing_confirmations_resource ON commerce_packing_confirmations(tenant_id,store_id,resource_id);
