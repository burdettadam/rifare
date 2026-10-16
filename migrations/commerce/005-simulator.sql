CREATE TABLE commerce_simulator (
  tenant_id TEXT NOT NULL, store_id TEXT NOT NULL, profile TEXT NOT NULL,
  clock INTEGER NOT NULL, fault TEXT NOT NULL,
  PRIMARY KEY(tenant_id,store_id),
  FOREIGN KEY(tenant_id,store_id) REFERENCES commerce_stores(tenant_id,store_id)
) STRICT;
CREATE TABLE commerce_simulator_receipts (
  tenant_id TEXT NOT NULL, store_id TEXT NOT NULL, operation_id TEXT NOT NULL,
  input_hash TEXT NOT NULL, result TEXT NOT NULL CHECK(json_valid(result)),
  PRIMARY KEY(tenant_id,store_id,operation_id),
  FOREIGN KEY(tenant_id,store_id) REFERENCES commerce_stores(tenant_id,store_id)
) STRICT;
