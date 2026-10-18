CREATE TABLE commerce_procurement_suppliers (
 tenant_id TEXT NOT NULL, store_id TEXT NOT NULL, id TEXT NOT NULL, resource_id TEXT NOT NULL,
 state TEXT NOT NULL, body TEXT NOT NULL, digest TEXT NOT NULL, PRIMARY KEY(tenant_id,store_id,id)
) STRICT;
CREATE TABLE commerce_replenishment_drafts (
 tenant_id TEXT NOT NULL, store_id TEXT NOT NULL, id TEXT NOT NULL, resource_id TEXT NOT NULL,
 state TEXT NOT NULL, body TEXT NOT NULL, digest TEXT NOT NULL, PRIMARY KEY(tenant_id,store_id,id)
) STRICT;
CREATE TABLE commerce_purchase_orders (
 tenant_id TEXT NOT NULL, store_id TEXT NOT NULL, id TEXT NOT NULL, resource_id TEXT NOT NULL,
 current_version INTEGER NOT NULL, state TEXT NOT NULL, body TEXT NOT NULL, digest TEXT NOT NULL,
 PRIMARY KEY(tenant_id,store_id,id)
) STRICT;
CREATE TABLE commerce_purchase_order_versions (
 tenant_id TEXT NOT NULL, store_id TEXT NOT NULL, id TEXT NOT NULL, resource_id TEXT NOT NULL,
 po_id TEXT NOT NULL, version INTEGER NOT NULL, state TEXT NOT NULL, body TEXT NOT NULL, digest TEXT NOT NULL,
 PRIMARY KEY(tenant_id,store_id,id), UNIQUE(tenant_id,store_id,po_id,version)
) STRICT;
CREATE TABLE commerce_procurement_budgets (
 tenant_id TEXT NOT NULL, store_id TEXT NOT NULL, id TEXT NOT NULL, resource_id TEXT NOT NULL,
 state TEXT NOT NULL, body TEXT NOT NULL, digest TEXT NOT NULL, PRIMARY KEY(tenant_id,store_id,id)
) STRICT;
CREATE TABLE commerce_procurement_approvals (
 tenant_id TEXT NOT NULL, store_id TEXT NOT NULL, id TEXT NOT NULL, resource_id TEXT NOT NULL,
 po_id TEXT NOT NULL, po_version INTEGER NOT NULL, state TEXT NOT NULL, body TEXT NOT NULL, digest TEXT NOT NULL,
 PRIMARY KEY(tenant_id,store_id,id)
) STRICT;
CREATE TABLE commerce_procurement_reservations (
 tenant_id TEXT NOT NULL, store_id TEXT NOT NULL, id TEXT NOT NULL, resource_id TEXT NOT NULL,
 budget_id TEXT NOT NULL, po_id TEXT NOT NULL, po_version INTEGER NOT NULL, state TEXT NOT NULL,
 amount_minor TEXT NOT NULL, currency_code TEXT NOT NULL, body TEXT NOT NULL, digest TEXT NOT NULL,
 PRIMARY KEY(tenant_id,store_id,id)
) STRICT;
CREATE TABLE commerce_procurement_sends (
 tenant_id TEXT NOT NULL, store_id TEXT NOT NULL, id TEXT NOT NULL, resource_id TEXT NOT NULL,
 po_id TEXT NOT NULL, po_version INTEGER NOT NULL, state TEXT NOT NULL, body TEXT NOT NULL, digest TEXT NOT NULL,
 PRIMARY KEY(tenant_id,store_id,id), UNIQUE(tenant_id,store_id,po_id,po_version)
) STRICT;
