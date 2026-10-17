CREATE TABLE commerce_receiving_sessions (
 tenant_id TEXT NOT NULL,store_id TEXT NOT NULL,id TEXT NOT NULL,
 request_id TEXT NOT NULL,case_id TEXT NOT NULL,resource_id TEXT NOT NULL,
 revision INTEGER NOT NULL,state TEXT NOT NULL CHECK(state IN ('open','closed')),
 body TEXT NOT NULL,digest TEXT NOT NULL,
 PRIMARY KEY(tenant_id,store_id,id),UNIQUE(tenant_id,store_id,request_id)
) STRICT;
CREATE TABLE commerce_receiving_scans (
 seq INTEGER PRIMARY KEY,tenant_id TEXT NOT NULL,store_id TEXT NOT NULL,
 scan_id TEXT NOT NULL,session_id TEXT NOT NULL,actor_id TEXT NOT NULL,
 body TEXT NOT NULL,digest TEXT NOT NULL,observed_at INTEGER NOT NULL,
 UNIQUE(tenant_id,store_id,scan_id)
) STRICT;
CREATE TRIGGER receiving_scans_no_update BEFORE UPDATE ON commerce_receiving_scans BEGIN SELECT RAISE(ABORT,'RECEIPT_IMMUTABLE'); END;
CREATE TRIGGER receiving_scans_no_delete BEFORE DELETE ON commerce_receiving_scans BEGIN SELECT RAISE(ABORT,'RECEIPT_IMMUTABLE'); END;
CREATE TABLE commerce_received_units (
 tenant_id TEXT NOT NULL,store_id TEXT NOT NULL,id TEXT NOT NULL,
 request_id TEXT NOT NULL,session_id TEXT NOT NULL,scan_id TEXT NOT NULL,
 line_id TEXT,ordinal INTEGER,grade TEXT NOT NULL,
 body TEXT NOT NULL,digest TEXT NOT NULL,
 PRIMARY KEY(tenant_id,store_id,id),UNIQUE(tenant_id,store_id,request_id,line_id,ordinal)
) STRICT;
CREATE TRIGGER received_units_no_update BEFORE UPDATE ON commerce_received_units BEGIN SELECT RAISE(ABORT,'RECEIPT_IMMUTABLE'); END;
CREATE TRIGGER received_units_no_delete BEFORE DELETE ON commerce_received_units BEGIN SELECT RAISE(ABORT,'RECEIPT_IMMUTABLE'); END;
CREATE TABLE commerce_receiving_reviews (
 seq INTEGER PRIMARY KEY,tenant_id TEXT NOT NULL,store_id TEXT NOT NULL,
 session_id TEXT NOT NULL,revision INTEGER NOT NULL,actor_id TEXT NOT NULL,
 authority_revision INTEGER NOT NULL,decision TEXT NOT NULL,reason TEXT NOT NULL,
 observed_at INTEGER NOT NULL,UNIQUE(tenant_id,store_id,session_id,revision)
) STRICT;
CREATE TABLE commerce_warehouse_settings (
 tenant_id TEXT NOT NULL,store_id TEXT NOT NULL,revision INTEGER NOT NULL,
 body TEXT NOT NULL,digest TEXT NOT NULL,PRIMARY KEY(tenant_id,store_id)
) STRICT;
CREATE TABLE commerce_lifecycle_quotes (
 tenant_id TEXT NOT NULL,store_id TEXT NOT NULL,id TEXT NOT NULL,request_id TEXT NOT NULL,
 case_id TEXT NOT NULL,kind TEXT NOT NULL,body TEXT NOT NULL,digest TEXT NOT NULL,
 PRIMARY KEY(tenant_id,store_id,id)
) STRICT;
CREATE TABLE commerce_disposition_operations (
 tenant_id TEXT NOT NULL,store_id TEXT NOT NULL,id TEXT NOT NULL,request_id TEXT NOT NULL,
 case_id TEXT NOT NULL,resource_id TEXT NOT NULL,quote_id TEXT NOT NULL,receipt_id TEXT NOT NULL,
 state TEXT NOT NULL CHECK(state IN ('authorized','unknown','applied','rejected')),
 command TEXT NOT NULL,digest TEXT NOT NULL,native_id TEXT,
 PRIMARY KEY(tenant_id,store_id,id)
) STRICT;
CREATE TABLE commerce_disposition_units (
 tenant_id TEXT NOT NULL,store_id TEXT NOT NULL,unit_id TEXT NOT NULL,operation_id TEXT NOT NULL,
 PRIMARY KEY(tenant_id,store_id,unit_id)
) STRICT;
CREATE TABLE commerce_lifecycle_observations (
 seq INTEGER PRIMARY KEY,tenant_id TEXT NOT NULL,store_id TEXT NOT NULL,request_id TEXT NOT NULL,
 operation_id TEXT NOT NULL,stage TEXT NOT NULL,body TEXT NOT NULL,digest TEXT NOT NULL,observed_at INTEGER NOT NULL
) STRICT;
CREATE TRIGGER lifecycle_observations_no_update BEFORE UPDATE ON commerce_lifecycle_observations BEGIN SELECT RAISE(ABORT,'RECEIPT_IMMUTABLE'); END;
CREATE TRIGGER lifecycle_observations_no_delete BEFORE DELETE ON commerce_lifecycle_observations BEGIN SELECT RAISE(ABORT,'RECEIPT_IMMUTABLE'); END;
CREATE TABLE commerce_return_closures (
 tenant_id TEXT NOT NULL,store_id TEXT NOT NULL,request_id TEXT NOT NULL,case_id TEXT NOT NULL,
 resource_id TEXT NOT NULL,revision INTEGER NOT NULL,state TEXT NOT NULL CHECK(state IN ('cancelled','expired')),
 receipt_id TEXT NOT NULL,body TEXT NOT NULL,digest TEXT NOT NULL,
 PRIMARY KEY(tenant_id,store_id,request_id)
) STRICT;
CREATE TABLE commerce_return_lifecycle_events (
 tenant_id TEXT NOT NULL,store_id TEXT NOT NULL,event_id TEXT NOT NULL,request_id TEXT NOT NULL,
 kind TEXT NOT NULL,body TEXT NOT NULL,digest TEXT NOT NULL,
 PRIMARY KEY(tenant_id,store_id,event_id),UNIQUE(tenant_id,store_id,request_id,kind)
) STRICT;
CREATE TABLE commerce_native_change_settings (
 tenant_id TEXT NOT NULL,store_id TEXT NOT NULL,revision INTEGER NOT NULL,
 body TEXT NOT NULL,digest TEXT NOT NULL,PRIMARY KEY(tenant_id,store_id)
) STRICT;
CREATE TABLE commerce_native_change_snapshots (
 tenant_id TEXT NOT NULL,store_id TEXT NOT NULL,request_id TEXT NOT NULL,resource_id TEXT NOT NULL,
 source_identity TEXT NOT NULL,source_version INTEGER NOT NULL,body TEXT NOT NULL,digest TEXT NOT NULL,
 observed_at INTEGER NOT NULL,PRIMARY KEY(tenant_id,store_id,request_id)
) STRICT;
CREATE TABLE commerce_native_completed_units (
 tenant_id TEXT NOT NULL,store_id TEXT NOT NULL,resource_id TEXT NOT NULL,line_id TEXT NOT NULL,
 unit_index INTEGER NOT NULL,kind TEXT NOT NULL,native_id TEXT NOT NULL,request_id TEXT NOT NULL,
 PRIMARY KEY(tenant_id,store_id,resource_id,line_id,unit_index)
) STRICT;
CREATE TABLE commerce_native_receipts (
 tenant_id TEXT NOT NULL,store_id TEXT NOT NULL,request_id TEXT NOT NULL,native_id TEXT NOT NULL,
 line_id TEXT NOT NULL,ordinal INTEGER NOT NULL,body TEXT NOT NULL,digest TEXT NOT NULL,
 PRIMARY KEY(tenant_id,store_id,native_id),UNIQUE(tenant_id,store_id,request_id,line_id,ordinal)
) STRICT;
CREATE TABLE commerce_return_workflow_pins (
 tenant_id TEXT NOT NULL,store_id TEXT NOT NULL,request_id TEXT NOT NULL,workflow TEXT NOT NULL,
 body TEXT NOT NULL,digest TEXT NOT NULL,PRIMARY KEY(tenant_id,store_id,request_id,workflow)
) STRICT;
