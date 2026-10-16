CREATE TABLE commerce_operations (
 tenant_id TEXT NOT NULL, store_id TEXT NOT NULL, id TEXT NOT NULL, resource_id TEXT NOT NULL,
 source_kind TEXT NOT NULL CHECK(source_kind IN ('case','event')), source_id TEXT NOT NULL,
 command TEXT NOT NULL CHECK(json_valid(command)), payload_hash TEXT NOT NULL,
 state TEXT NOT NULL CHECK(state IN ('queued','sending','retry_wait','unknown','succeeded','failed')),
 revision INTEGER NOT NULL, provider_ref TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
 PRIMARY KEY(tenant_id,store_id,id), UNIQUE(tenant_id,store_id,source_kind,source_id),
 FOREIGN KEY(tenant_id,store_id,resource_id) REFERENCES commerce_resources(tenant_id,store_id,id)
) STRICT;
CREATE TABLE commerce_operation_keys (
 tenant_id TEXT NOT NULL, store_id TEXT NOT NULL, key TEXT NOT NULL, operation_id TEXT NOT NULL, payload_hash TEXT NOT NULL,
 PRIMARY KEY(tenant_id,store_id,key), FOREIGN KEY(tenant_id,store_id,operation_id) REFERENCES commerce_operations(tenant_id,store_id,id)
) STRICT;
CREATE TABLE commerce_operation_work (
 tenant_id TEXT NOT NULL, store_id TEXT NOT NULL, operation_id TEXT NOT NULL,
 state TEXT NOT NULL CHECK(state IN ('pending','leased','sending','retry_wait','unknown','done','dead')),
 attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 3), available_at INTEGER NOT NULL,
 lease_token TEXT, lease_until INTEGER, owner TEXT, last_code TEXT,
 PRIMARY KEY(tenant_id,store_id,operation_id),
 FOREIGN KEY(tenant_id,store_id,operation_id) REFERENCES commerce_operations(tenant_id,store_id,id)
) STRICT;
CREATE TABLE commerce_operation_receipts (
 seq INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id TEXT NOT NULL, store_id TEXT NOT NULL, operation_id TEXT NOT NULL,
 id TEXT NOT NULL UNIQUE, body TEXT NOT NULL CHECK(json_valid(body)), digest TEXT NOT NULL,
 FOREIGN KEY(tenant_id,store_id,operation_id) REFERENCES commerce_operations(tenant_id,store_id,id)
) STRICT;
CREATE TRIGGER commerce_operation_receipts_no_update BEFORE UPDATE ON commerce_operation_receipts
 BEGIN SELECT RAISE(ABORT,'RECEIPT_IMMUTABLE'); END;
CREATE TRIGGER commerce_operation_receipts_no_delete BEFORE DELETE ON commerce_operation_receipts
 BEGIN SELECT RAISE(ABORT,'RECEIPT_IMMUTABLE'); END;
CREATE TRIGGER commerce_operation_identity_no_update BEFORE UPDATE OF tenant_id,store_id,id,resource_id,source_kind,source_id,command,payload_hash,created_at ON commerce_operations
 BEGIN SELECT RAISE(ABORT,'OPERATION_IDENTITY_IMMUTABLE'); END;
CREATE TABLE commerce_receipt_payloads (
 tenant_id TEXT NOT NULL, store_id TEXT NOT NULL, id TEXT NOT NULL, receipt_id TEXT NOT NULL,
 subject_ref TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind='customer_note'), content TEXT NOT NULL,
 expires_at INTEGER NOT NULL, PRIMARY KEY(tenant_id,store_id,id), FOREIGN KEY(receipt_id) REFERENCES commerce_operation_receipts(id)
) STRICT;
CREATE TABLE commerce_event_consumption (
 tenant_id TEXT NOT NULL, store_id TEXT NOT NULL, inbox_id TEXT NOT NULL,
 event_id TEXT NOT NULL, event_hash TEXT NOT NULL, resource_id TEXT NOT NULL,
 disposition TEXT NOT NULL CHECK(disposition IN ('applied','duplicate','stale','conflict')),
 operation_id TEXT, observed_at INTEGER NOT NULL,
 PRIMARY KEY(tenant_id,store_id,inbox_id),
 FOREIGN KEY(tenant_id,store_id,inbox_id) REFERENCES commerce_webhook_inbox(tenant_id,store_id,id)
) STRICT;
CREATE TABLE commerce_event_identities (
 tenant_id TEXT NOT NULL, store_id TEXT NOT NULL, event_id TEXT NOT NULL, event_hash TEXT NOT NULL,
 inbox_id TEXT NOT NULL, resource_id TEXT NOT NULL,
 PRIMARY KEY(tenant_id,store_id,event_id)
) STRICT;
CREATE TABLE commerce_event_projections (
 tenant_id TEXT NOT NULL, store_id TEXT NOT NULL, resource_id TEXT NOT NULL,
 source_version INTEGER NOT NULL CHECK(source_version>0), source_updated_at INTEGER NOT NULL,
 state TEXT NOT NULL CHECK(state IN ('open','approved','closed')), state_hash TEXT NOT NULL,
 inbox_id TEXT NOT NULL, PRIMARY KEY(tenant_id,store_id,resource_id),
 FOREIGN KEY(tenant_id,store_id,resource_id) REFERENCES commerce_resources(tenant_id,store_id,id)
) STRICT;
CREATE TABLE commerce_reconciliation_runs (
 tenant_id TEXT NOT NULL, store_id TEXT NOT NULL, id TEXT NOT NULL, provider_id TEXT NOT NULL, provider_identity TEXT NOT NULL,
 cursor INTEGER NOT NULL, ceiling INTEGER NOT NULL, state TEXT NOT NULL CHECK(state IN ('running','completed')),
 PRIMARY KEY(tenant_id,store_id,id)
) STRICT;
CREATE TABLE commerce_reconciliation_drift (
 tenant_id TEXT NOT NULL, store_id TEXT NOT NULL, operation_id TEXT NOT NULL, code TEXT NOT NULL,
 source_ref TEXT NOT NULL, observed_at INTEGER NOT NULL,
 PRIMARY KEY(tenant_id,store_id,operation_id,code,source_ref)
) STRICT;
CREATE INDEX commerce_operation_ready ON commerce_operation_work(tenant_id,store_id,state,available_at);
CREATE INDEX commerce_operation_receipt_chain ON commerce_operation_receipts(tenant_id,store_id,operation_id,seq);
CREATE TABLE commerce_operation_targets (
 tenant_id TEXT NOT NULL, store_id TEXT NOT NULL, operation_id TEXT NOT NULL,
 provider_id TEXT NOT NULL, provider_identity TEXT NOT NULL, contract TEXT NOT NULL,
 PRIMARY KEY(tenant_id,store_id,operation_id),
 FOREIGN KEY(tenant_id,store_id,operation_id) REFERENCES commerce_operations(tenant_id,store_id,id)
) STRICT;
CREATE TRIGGER commerce_operation_target_no_update BEFORE UPDATE ON commerce_operation_targets
 BEGIN SELECT RAISE(ABORT,'SOURCE_BINDING_IMMUTABLE');END;
CREATE TRIGGER commerce_operation_target_no_delete BEFORE DELETE ON commerce_operation_targets
 BEGIN SELECT RAISE(ABORT,'SOURCE_BINDING_IMMUTABLE');END;
