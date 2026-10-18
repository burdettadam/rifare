-- Outbound shipping is distinct from the return-label engine. Every durable row
-- has one subject resource; mixed-customer batches have no shared payload row.
CREATE TABLE commerce_shipping_label_operations (
 tenant_id TEXT NOT NULL, store_id TEXT NOT NULL, resource_id TEXT NOT NULL,
 package_id TEXT NOT NULL, purchase_id TEXT NOT NULL,
 body TEXT NOT NULL CHECK(json_valid(body)), digest TEXT NOT NULL,
 PRIMARY KEY(tenant_id,store_id,package_id), UNIQUE(tenant_id,store_id,purchase_id)
) STRICT;
CREATE INDEX commerce_shipping_labels_subject ON commerce_shipping_label_operations(tenant_id,store_id,resource_id);
CREATE TABLE commerce_shipping_label_approvals (
 tenant_id TEXT NOT NULL, store_id TEXT NOT NULL, resource_id TEXT NOT NULL,
 package_id TEXT NOT NULL, id TEXT NOT NULL,
 body TEXT NOT NULL CHECK(json_valid(body)), digest TEXT NOT NULL,
 revoked INTEGER NOT NULL CHECK(revoked IN (0,1)),
 PRIMARY KEY(tenant_id,store_id,id)
) STRICT;
CREATE TABLE commerce_shipping_manifest_packages (
 tenant_id TEXT NOT NULL, store_id TEXT NOT NULL, resource_id TEXT NOT NULL,
 package_id TEXT NOT NULL, manifest_id TEXT NOT NULL,
 body TEXT NOT NULL CHECK(json_valid(body)), digest TEXT NOT NULL,
 PRIMARY KEY(tenant_id,store_id,package_id)
) STRICT;
CREATE INDEX commerce_shipping_manifest_members ON commerce_shipping_manifest_packages(tenant_id,store_id,manifest_id);
CREATE TABLE commerce_shipping_manifest_events (
 tenant_id TEXT NOT NULL, store_id TEXT NOT NULL, resource_id TEXT NOT NULL,
 package_id TEXT NOT NULL, event_id TEXT NOT NULL, manifest_id TEXT NOT NULL,
 body TEXT NOT NULL CHECK(json_valid(body)), digest TEXT NOT NULL,
 PRIMARY KEY(tenant_id,store_id,event_id)
) STRICT;
