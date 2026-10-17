CREATE TABLE commerce_exchange_lineage_nodes (
 tenant_id TEXT NOT NULL, store_id TEXT NOT NULL, id TEXT NOT NULL,
 resource_id TEXT NOT NULL, parent_resource_id TEXT NOT NULL,
 operation_id TEXT NOT NULL, native_order_id TEXT NOT NULL,
 customer_id TEXT NOT NULL, body TEXT NOT NULL, digest TEXT NOT NULL,
 PRIMARY KEY(tenant_id,store_id,id),
 UNIQUE(tenant_id,store_id,resource_id),
 UNIQUE(tenant_id,store_id,operation_id),
 UNIQUE(tenant_id,store_id,native_order_id)
) STRICT;
CREATE TABLE commerce_exchange_lineage_imports (
 tenant_id TEXT NOT NULL, store_id TEXT NOT NULL, operation_id TEXT NOT NULL,
 case_id TEXT NOT NULL, resource_id TEXT NOT NULL,
 state TEXT NOT NULL CHECK(state IN ('unknown','imported')),
 node_id TEXT, PRIMARY KEY(tenant_id,store_id,operation_id)
) STRICT;
CREATE TRIGGER exchange_lineage_nodes_no_update BEFORE UPDATE ON commerce_exchange_lineage_nodes
 BEGIN SELECT RAISE(ABORT,'APPEND_ONLY_LINEAGE'); END;
CREATE TRIGGER exchange_lineage_nodes_no_delete BEFORE DELETE ON commerce_exchange_lineage_nodes
 BEGIN SELECT RAISE(ABORT,'APPEND_ONLY_LINEAGE'); END;
