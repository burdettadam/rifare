-- Stock keys are global within the tenant/store, never separate balances per order.
CREATE TABLE commerce_inventory_owners (
 tenant_id TEXT NOT NULL, store_id TEXT NOT NULL, resource_id TEXT NOT NULL,
 variant_id TEXT NOT NULL, location_id TEXT NOT NULL, field TEXT NOT NULL,
 source_identity TEXT NOT NULL, body TEXT NOT NULL, digest TEXT NOT NULL,
 PRIMARY KEY(tenant_id,store_id,variant_id,location_id,field)
) STRICT;
CREATE TABLE commerce_inventory_snapshots (
 tenant_id TEXT NOT NULL, store_id TEXT NOT NULL, resource_id TEXT NOT NULL,
 observation_id TEXT NOT NULL, source_identity TEXT NOT NULL, variant_id TEXT NOT NULL,
 location_id TEXT NOT NULL, body TEXT NOT NULL, digest TEXT NOT NULL,
 PRIMARY KEY(tenant_id,store_id,observation_id)
) STRICT;
CREATE TABLE commerce_inventory_movements (
 tenant_id TEXT NOT NULL, store_id TEXT NOT NULL, resource_id TEXT NOT NULL,
 movement_id TEXT NOT NULL, source_identity TEXT NOT NULL, variant_id TEXT NOT NULL,
 location_id TEXT NOT NULL, ledger_seq INTEGER NOT NULL CHECK(ledger_seq>0),
 previous_digest TEXT NOT NULL, chain_digest TEXT NOT NULL, body TEXT NOT NULL, digest TEXT NOT NULL,
 PRIMARY KEY(tenant_id,store_id,movement_id), UNIQUE(tenant_id,store_id,variant_id,location_id,ledger_seq)
) STRICT;
CREATE TABLE commerce_inventory_discrepancies (
 tenant_id TEXT NOT NULL, store_id TEXT NOT NULL, resource_id TEXT NOT NULL,
 id TEXT NOT NULL, variant_id TEXT NOT NULL, location_id TEXT NOT NULL,
 body TEXT NOT NULL, digest TEXT NOT NULL,
 PRIMARY KEY(tenant_id,store_id,id)
) STRICT;
CREATE TABLE commerce_inventory_transfers (
 tenant_id TEXT NOT NULL, store_id TEXT NOT NULL, resource_id TEXT NOT NULL,
 transfer_id TEXT NOT NULL, body TEXT NOT NULL, digest TEXT NOT NULL,
 PRIMARY KEY(tenant_id,store_id,transfer_id)
) STRICT;
CREATE TABLE commerce_inventory_transfer_operations (
 tenant_id TEXT NOT NULL, store_id TEXT NOT NULL, resource_id TEXT NOT NULL,
 transfer_id TEXT NOT NULL, operation_id TEXT NOT NULL, body TEXT NOT NULL, digest TEXT NOT NULL,
 PRIMARY KEY(tenant_id,store_id,operation_id)
) STRICT;
CREATE TABLE commerce_inventory_transfer_approvals (
 tenant_id TEXT NOT NULL, store_id TEXT NOT NULL, resource_id TEXT NOT NULL,
 operation_id TEXT NOT NULL, id TEXT NOT NULL, body TEXT NOT NULL, digest TEXT NOT NULL,
 revoked INTEGER NOT NULL DEFAULT 0 CHECK(revoked IN(0,1)),
 PRIMARY KEY(tenant_id,store_id,id)
) STRICT;
