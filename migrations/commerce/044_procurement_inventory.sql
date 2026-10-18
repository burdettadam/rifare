-- Observation and approval records only. Native stock remains in the warehouse source.
CREATE TABLE commerce_purchase_receipts (
 tenant_id TEXT NOT NULL, store_id TEXT NOT NULL, resource_id TEXT NOT NULL,
 receipt_id TEXT NOT NULL, po_id TEXT NOT NULL, po_version INTEGER NOT NULL,
 operation_id TEXT NOT NULL, source_identity TEXT NOT NULL,
 body TEXT NOT NULL, digest TEXT NOT NULL,
 PRIMARY KEY(tenant_id,store_id,receipt_id), UNIQUE(tenant_id,store_id,operation_id)
) STRICT;
CREATE TABLE commerce_supplier_receipt_events (
 tenant_id TEXT NOT NULL, store_id TEXT NOT NULL, resource_id TEXT NOT NULL,
 event_id TEXT NOT NULL, receipt_id TEXT NOT NULL, operation_id TEXT NOT NULL,
 source_identity TEXT NOT NULL, kind TEXT NOT NULL, body TEXT NOT NULL, digest TEXT NOT NULL,
 PRIMARY KEY(tenant_id,store_id,event_id), UNIQUE(tenant_id,store_id,operation_id)
) STRICT;
CREATE TABLE commerce_material_items (
 tenant_id TEXT NOT NULL, store_id TEXT NOT NULL, resource_id TEXT NOT NULL,
 id TEXT NOT NULL, version INTEGER NOT NULL, body TEXT NOT NULL, digest TEXT NOT NULL,
 PRIMARY KEY(tenant_id,store_id,id,version)
) STRICT;
CREATE TABLE commerce_bom_versions (
 tenant_id TEXT NOT NULL, store_id TEXT NOT NULL, resource_id TEXT NOT NULL,
 id TEXT NOT NULL, version INTEGER NOT NULL, body TEXT NOT NULL, digest TEXT NOT NULL,
 PRIMARY KEY(tenant_id,store_id,id,version)
) STRICT;
CREATE TABLE commerce_production_orders (
 tenant_id TEXT NOT NULL, store_id TEXT NOT NULL, resource_id TEXT NOT NULL,
 id TEXT NOT NULL, source_identity TEXT NOT NULL, state TEXT NOT NULL,
 body TEXT NOT NULL, digest TEXT NOT NULL,
 PRIMARY KEY(tenant_id,store_id,id)
) STRICT;
CREATE TABLE commerce_stock_operations (
 tenant_id TEXT NOT NULL, store_id TEXT NOT NULL, resource_id TEXT NOT NULL,
 operation_id TEXT NOT NULL, source_identity TEXT NOT NULL, business_key TEXT NOT NULL,
 kind TEXT NOT NULL, state TEXT NOT NULL, body TEXT NOT NULL, digest TEXT NOT NULL,
 PRIMARY KEY(tenant_id,store_id,operation_id), UNIQUE(tenant_id,store_id,business_key)
) STRICT;
CREATE TABLE commerce_stock_approvals (
 tenant_id TEXT NOT NULL, store_id TEXT NOT NULL, resource_id TEXT NOT NULL,
 id TEXT NOT NULL, reference_id TEXT NOT NULL, kind TEXT NOT NULL,
 state TEXT NOT NULL, body TEXT NOT NULL, digest TEXT NOT NULL,
 PRIMARY KEY(tenant_id,store_id,id)
) STRICT;
