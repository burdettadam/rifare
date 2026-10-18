-- Preserve existing operation identities, rows and uniqueness while adding an honest
-- state for Woo records that have no verified movement through a gateway.
DROP INDEX commerce_resolution_operations_order;
ALTER TABLE commerce_resolution_operations RENAME TO commerce_resolution_operations_before_woo;
CREATE TABLE commerce_resolution_operations (
 tenant_id TEXT NOT NULL, store_id TEXT NOT NULL, id TEXT NOT NULL, allocation_id TEXT NOT NULL,
 case_id TEXT NOT NULL, resource_id TEXT NOT NULL, receipt_id TEXT NOT NULL, quote_id TEXT NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN ('refund','store_credit','additional_payment')), amount_minor TEXT NOT NULL, currency TEXT NOT NULL,
 source_identity TEXT NOT NULL, command TEXT NOT NULL CHECK(json_valid(command)), digest TEXT NOT NULL,
 state TEXT NOT NULL CHECK(state IN ('authorized','unknown','accepted','settled','issued','rejected','unpaid','partial','failed','expired','manual_external_settlement_pending')),
 native_id TEXT, observed_at INTEGER NOT NULL,
 PRIMARY KEY(tenant_id,store_id,id), UNIQUE(tenant_id,store_id,allocation_id), UNIQUE(tenant_id,store_id,source_identity,native_id)
) STRICT;
INSERT INTO commerce_resolution_operations SELECT * FROM commerce_resolution_operations_before_woo;
DROP TABLE commerce_resolution_operations_before_woo;
CREATE INDEX commerce_resolution_operations_order ON commerce_resolution_operations(tenant_id,store_id,resource_id,state);
