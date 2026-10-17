CREATE TABLE commerce_edit_settings (
 tenant_id TEXT NOT NULL, store_id TEXT NOT NULL, revision INTEGER NOT NULL,
 body TEXT NOT NULL, digest TEXT NOT NULL, PRIMARY KEY(tenant_id,store_id)
) STRICT;
CREATE TABLE commerce_edit_snapshots (
 tenant_id TEXT NOT NULL, store_id TEXT NOT NULL, resource_id TEXT NOT NULL,
 source_identity TEXT NOT NULL, observed_at INTEGER NOT NULL, body TEXT NOT NULL,
 digest TEXT NOT NULL, PRIMARY KEY(tenant_id,store_id,resource_id)
) STRICT;
CREATE TABLE commerce_edit_inputs (
 tenant_id TEXT NOT NULL, store_id TEXT NOT NULL, id TEXT NOT NULL,
 case_id TEXT NOT NULL, resource_id TEXT NOT NULL, body TEXT NOT NULL, digest TEXT NOT NULL,
 PRIMARY KEY(tenant_id,store_id,id)
) STRICT;
CREATE TABLE commerce_edit_quotes (
 tenant_id TEXT NOT NULL, store_id TEXT NOT NULL, id TEXT NOT NULL,
 case_id TEXT NOT NULL, resource_id TEXT NOT NULL, body TEXT NOT NULL, digest TEXT NOT NULL,
 PRIMARY KEY(tenant_id,store_id,id)
) STRICT;
CREATE TABLE commerce_order_edits (
 tenant_id TEXT NOT NULL, store_id TEXT NOT NULL, id TEXT NOT NULL,
 case_id TEXT NOT NULL, resource_id TEXT NOT NULL, quote_id TEXT NOT NULL, receipt_id TEXT NOT NULL,
 state TEXT NOT NULL, revision INTEGER NOT NULL, source_identity TEXT NOT NULL,
 body TEXT NOT NULL, digest TEXT NOT NULL, PRIMARY KEY(tenant_id,store_id,id),
 UNIQUE(tenant_id,store_id,quote_id)
) STRICT;
CREATE UNIQUE INDEX commerce_one_active_order_edit ON commerce_order_edits(tenant_id,store_id,resource_id)
 WHERE state NOT IN ('released','cancelled','abandoned');
CREATE TABLE commerce_edit_steps (
 tenant_id TEXT NOT NULL, store_id TEXT NOT NULL, edit_id TEXT NOT NULL, stage TEXT NOT NULL,
 operation_id TEXT NOT NULL, command_digest TEXT NOT NULL, state TEXT NOT NULL,
 result TEXT, result_digest TEXT, started_at INTEGER NOT NULL,
 PRIMARY KEY(tenant_id,store_id,edit_id,stage), UNIQUE(tenant_id,store_id,operation_id)
) STRICT;
CREATE TABLE commerce_edit_events (
 sequence INTEGER PRIMARY KEY, tenant_id TEXT NOT NULL, store_id TEXT NOT NULL,
 edit_id TEXT NOT NULL, event TEXT NOT NULL, observed_at INTEGER NOT NULL,
 body TEXT NOT NULL, digest TEXT NOT NULL
) STRICT;
CREATE TRIGGER commerce_edit_events_no_update BEFORE UPDATE ON commerce_edit_events BEGIN SELECT RAISE(ABORT,'APPEND_ONLY'); END;
CREATE TRIGGER commerce_edit_events_no_delete BEFORE DELETE ON commerce_edit_events BEGIN SELECT RAISE(ABORT,'APPEND_ONLY'); END;
