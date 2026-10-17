-- Append observations; existing resolution money and operation identities remain canonical.
CREATE TABLE commerce_exchange_currency_bindings (
 tenant_id TEXT NOT NULL, store_id TEXT NOT NULL, allocation_id TEXT NOT NULL,
 case_id TEXT NOT NULL, resource_id TEXT NOT NULL, request_id TEXT NOT NULL,
 revision INTEGER NOT NULL CHECK(revision>0), source_identity TEXT NOT NULL,
 body TEXT NOT NULL CHECK(json_valid(body)), digest TEXT NOT NULL, observed_at INTEGER NOT NULL,
 PRIMARY KEY(tenant_id,store_id,allocation_id,revision),
 UNIQUE(tenant_id,store_id,allocation_id,digest)
) STRICT;
CREATE TABLE commerce_exchange_fee_observations (
 tenant_id TEXT NOT NULL, store_id TEXT NOT NULL, allocation_id TEXT NOT NULL,
 case_id TEXT NOT NULL, resource_id TEXT NOT NULL, request_id TEXT NOT NULL,
 event_id TEXT NOT NULL, phase TEXT NOT NULL CHECK(phase IN ('estimated','final')),
 revision INTEGER NOT NULL CHECK(revision>0), source_identity TEXT NOT NULL,
 body TEXT NOT NULL CHECK(json_valid(body)), digest TEXT NOT NULL, observed_at INTEGER NOT NULL,
 PRIMARY KEY(tenant_id,store_id,event_id),
 UNIQUE(tenant_id,store_id,allocation_id,phase,revision)
) STRICT;
CREATE TRIGGER commerce_exchange_currency_no_update BEFORE UPDATE ON commerce_exchange_currency_bindings BEGIN SELECT RAISE(ABORT,'CURRENCY_HISTORY_IMMUTABLE'); END;
CREATE TRIGGER commerce_exchange_currency_no_delete BEFORE DELETE ON commerce_exchange_currency_bindings BEGIN SELECT RAISE(ABORT,'CURRENCY_HISTORY_IMMUTABLE'); END;
CREATE TRIGGER commerce_exchange_fee_no_update BEFORE UPDATE ON commerce_exchange_fee_observations BEGIN SELECT RAISE(ABORT,'FEE_HISTORY_IMMUTABLE'); END;
CREATE TRIGGER commerce_exchange_fee_no_delete BEFORE DELETE ON commerce_exchange_fee_observations BEGIN SELECT RAISE(ABORT,'FEE_HISTORY_IMMUTABLE'); END;
