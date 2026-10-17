-- Additive local fixture mandate state. Existing financial and stock ledgers remain authoritative.
CREATE TABLE commerce_instant_settings (
 tenant_id TEXT NOT NULL, store_id TEXT NOT NULL, revision INTEGER NOT NULL,
 body TEXT NOT NULL CHECK(json_valid(body)), digest TEXT NOT NULL,
 PRIMARY KEY(tenant_id,store_id)
) STRICT;
CREATE TABLE commerce_instant_quotes (
 tenant_id TEXT NOT NULL, store_id TEXT NOT NULL, id TEXT NOT NULL,
 case_id TEXT NOT NULL, resource_id TEXT NOT NULL, kind TEXT NOT NULL,
 obligation_id TEXT NOT NULL, body TEXT NOT NULL CHECK(json_valid(body)), digest TEXT NOT NULL,
 PRIMARY KEY(tenant_id,store_id,id)
) STRICT;
CREATE TABLE commerce_instant_obligations (
 tenant_id TEXT NOT NULL, store_id TEXT NOT NULL, id TEXT NOT NULL,
 allocation_id TEXT NOT NULL, case_id TEXT NOT NULL, resource_id TEXT NOT NULL,
 body TEXT NOT NULL CHECK(json_valid(body)), digest TEXT NOT NULL,
 PRIMARY KEY(tenant_id,store_id,id), UNIQUE(tenant_id,store_id,allocation_id)
) STRICT;
CREATE TABLE commerce_instant_operations (
 tenant_id TEXT NOT NULL, store_id TEXT NOT NULL, id TEXT NOT NULL,
 obligation_id TEXT NOT NULL, case_id TEXT NOT NULL, resource_id TEXT NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN ('authorize','reauthorize','capture','cancel')),
 generation INTEGER NOT NULL, quote_id TEXT NOT NULL, receipt_id TEXT NOT NULL,
 state TEXT NOT NULL CHECK(state IN ('authorized','unknown','mandate_active','captured','canceled','rejected')),
 command TEXT NOT NULL CHECK(json_valid(command)), digest TEXT NOT NULL,
 native_id TEXT, observed_at INTEGER NOT NULL,
 PRIMARY KEY(tenant_id,store_id,id), UNIQUE(tenant_id,store_id,obligation_id,kind,generation)
) STRICT;
CREATE TABLE commerce_instant_observations (
 seq INTEGER PRIMARY KEY, tenant_id TEXT NOT NULL, store_id TEXT NOT NULL,
 operation_id TEXT NOT NULL, stage TEXT NOT NULL,
 body TEXT NOT NULL CHECK(json_valid(body)), digest TEXT NOT NULL, observed_at INTEGER NOT NULL
) STRICT;
CREATE TRIGGER instant_observations_no_update BEFORE UPDATE ON commerce_instant_observations
 BEGIN SELECT RAISE(ABORT,'APPEND_ONLY_RECEIPT'); END;
CREATE TRIGGER instant_observations_no_delete BEFORE DELETE ON commerce_instant_observations
 BEGIN SELECT RAISE(ABORT,'APPEND_ONLY_RECEIPT'); END;
