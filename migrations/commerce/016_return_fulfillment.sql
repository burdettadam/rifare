CREATE TABLE commerce_fulfillment_settings (
 tenant_id TEXT NOT NULL, store_id TEXT NOT NULL, revision INTEGER NOT NULL,
 body TEXT NOT NULL, digest TEXT NOT NULL, PRIMARY KEY(tenant_id,store_id)
) STRICT;
CREATE TABLE commerce_inventory_reservations (
 tenant_id TEXT NOT NULL, store_id TEXT NOT NULL, id TEXT NOT NULL,
 allocation_id TEXT NOT NULL, case_id TEXT NOT NULL, resource_id TEXT NOT NULL,
 generation INTEGER NOT NULL, state TEXT NOT NULL, body TEXT NOT NULL, digest TEXT NOT NULL,
 PRIMARY KEY(tenant_id,store_id,id), UNIQUE(tenant_id,store_id,allocation_id,generation)
) STRICT;
CREATE TABLE commerce_return_parcels (
 tenant_id TEXT NOT NULL, store_id TEXT NOT NULL, request_id TEXT NOT NULL,
 case_id TEXT NOT NULL, resource_id TEXT NOT NULL, revision INTEGER NOT NULL,
 body TEXT NOT NULL, digest TEXT NOT NULL, PRIMARY KEY(tenant_id,store_id,request_id)
) STRICT;
CREATE TABLE commerce_fulfillment_quotes (
 tenant_id TEXT NOT NULL, store_id TEXT NOT NULL, id TEXT NOT NULL, case_id TEXT NOT NULL,
 resource_id TEXT NOT NULL, kind TEXT NOT NULL, obligation TEXT NOT NULL,
 body TEXT NOT NULL, digest TEXT NOT NULL, PRIMARY KEY(tenant_id,store_id,id)
) STRICT;
CREATE TABLE commerce_fulfillment_operations (
 tenant_id TEXT NOT NULL, store_id TEXT NOT NULL, id TEXT NOT NULL, case_id TEXT NOT NULL,
 resource_id TEXT NOT NULL, kind TEXT NOT NULL, obligation TEXT NOT NULL,
 quote_id TEXT NOT NULL, receipt_id TEXT NOT NULL, state TEXT NOT NULL,
 command TEXT NOT NULL, digest TEXT NOT NULL, native_id TEXT,
 PRIMARY KEY(tenant_id,store_id,id), UNIQUE(tenant_id,store_id,kind,obligation)
) STRICT;
CREATE TABLE commerce_fulfillment_observations (
 seq INTEGER PRIMARY KEY, tenant_id TEXT NOT NULL, store_id TEXT NOT NULL,
 operation_id TEXT NOT NULL, stage TEXT NOT NULL, body TEXT NOT NULL,
 digest TEXT NOT NULL, observed_at INTEGER NOT NULL
) STRICT;
CREATE TRIGGER fulfillment_observations_no_update BEFORE UPDATE ON commerce_fulfillment_observations
 BEGIN SELECT RAISE(ABORT,'APPEND_ONLY_RECEIPT'); END;
CREATE TRIGGER fulfillment_observations_no_delete BEFORE DELETE ON commerce_fulfillment_observations
 BEGIN SELECT RAISE(ABORT,'APPEND_ONLY_RECEIPT'); END;
CREATE TABLE commerce_replacement_orders (
 tenant_id TEXT NOT NULL, store_id TEXT NOT NULL, operation_id TEXT NOT NULL,
 allocation_id TEXT NOT NULL, native_id TEXT NOT NULL,
 source_version INTEGER NOT NULL, body TEXT NOT NULL, digest TEXT NOT NULL,
 PRIMARY KEY(tenant_id,store_id,operation_id), UNIQUE(tenant_id,store_id,allocation_id),
 UNIQUE(tenant_id,store_id,native_id)
) STRICT;
CREATE TABLE commerce_return_shipments (
 tenant_id TEXT NOT NULL, store_id TEXT NOT NULL, request_id TEXT NOT NULL,
 generation INTEGER NOT NULL, current_label_id TEXT NOT NULL,
 PRIMARY KEY(tenant_id,store_id,request_id)
) STRICT;
CREATE TABLE commerce_return_labels (
 tenant_id TEXT NOT NULL, store_id TEXT NOT NULL, id TEXT NOT NULL, operation_id TEXT NOT NULL,
 request_id TEXT NOT NULL, case_id TEXT NOT NULL, resource_id TEXT NOT NULL,
 generation INTEGER NOT NULL, replaces TEXT, replaced_by TEXT,
 source_version INTEGER NOT NULL, body TEXT NOT NULL, digest TEXT NOT NULL,
 PRIMARY KEY(tenant_id,store_id,id), UNIQUE(tenant_id,store_id,operation_id),
 UNIQUE(tenant_id,store_id,request_id,generation)
) STRICT;
CREATE TABLE commerce_carrier_events (
 tenant_id TEXT NOT NULL, store_id TEXT NOT NULL, event_id TEXT NOT NULL,
 label_id TEXT NOT NULL, source_version INTEGER NOT NULL,
 body TEXT NOT NULL, digest TEXT NOT NULL, received_at INTEGER NOT NULL,
 PRIMARY KEY(tenant_id,store_id,event_id)
) STRICT;
CREATE TRIGGER carrier_events_no_update BEFORE UPDATE ON commerce_carrier_events
 BEGIN SELECT RAISE(ABORT,'APPEND_ONLY_RECEIPT'); END;
CREATE TRIGGER carrier_events_no_delete BEFORE DELETE ON commerce_carrier_events
 BEGIN SELECT RAISE(ABORT,'APPEND_ONLY_RECEIPT'); END;
