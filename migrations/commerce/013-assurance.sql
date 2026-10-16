CREATE TABLE commerce_action_readiness (
 tenant_id TEXT NOT NULL, store_id TEXT NOT NULL, action TEXT NOT NULL,
 connection_revision INTEGER NOT NULL, contract_digest TEXT NOT NULL, settings_revision INTEGER NOT NULL,
 evidence_digest TEXT NOT NULL, checked_at INTEGER NOT NULL, expires_at INTEGER NOT NULL,
 revoked INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(tenant_id,store_id,action)
) STRICT;
CREATE TABLE commerce_privacy_subjects (
 tenant_id TEXT NOT NULL, store_id TEXT NOT NULL, subject_hash TEXT NOT NULL,
 erased_at INTEGER NOT NULL, PRIMARY KEY(tenant_id,store_id,subject_hash)
) STRICT;
CREATE TABLE commerce_privacy_resources (
 tenant_id TEXT NOT NULL, store_id TEXT NOT NULL, resource_id TEXT NOT NULL,
 subject_hash TEXT NOT NULL, erased_at INTEGER NOT NULL,
 PRIMARY KEY(tenant_id,store_id,resource_id)
) STRICT;
CREATE TABLE commerce_privacy_holds (
 tenant_id TEXT NOT NULL, store_id TEXT NOT NULL, subject_hash TEXT NOT NULL,
 reason TEXT NOT NULL, authority_ref TEXT NOT NULL, expires_at INTEGER NOT NULL, released INTEGER NOT NULL DEFAULT 0,
 PRIMARY KEY(tenant_id,store_id,subject_hash)
) STRICT;
CREATE TABLE commerce_privacy_events (
 seq INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id TEXT NOT NULL, store_id TEXT NOT NULL,
 subject_hash TEXT NOT NULL, event TEXT NOT NULL, reason TEXT NOT NULL, observed_at INTEGER NOT NULL
) STRICT;
CREATE TABLE commerce_recovery_state (
 id INTEGER PRIMARY KEY CHECK(id=1), restore_id TEXT NOT NULL,
 mode TEXT NOT NULL CHECK(mode IN ('quarantine','diagnostic_only')),
 source_digest TEXT NOT NULL, suppression_digest TEXT NOT NULL, created_at INTEGER NOT NULL
) STRICT;
CREATE TABLE commerce_restored_operations (
 tenant_id TEXT NOT NULL, store_id TEXT NOT NULL, operation_id TEXT NOT NULL,
 PRIMARY KEY(tenant_id,store_id,operation_id)
) STRICT;
CREATE TABLE commerce_woocommerce_connections (
 tenant_id TEXT NOT NULL, store_id TEXT NOT NULL, origin TEXT NOT NULL, secret_ref TEXT NOT NULL,
 granted_scopes TEXT NOT NULL CHECK(json_valid(granted_scopes)), mode TEXT NOT NULL CHECK(mode='fixture'),
 revision INTEGER NOT NULL, PRIMARY KEY(tenant_id,store_id)
) STRICT;
CREATE TABLE commerce_woocommerce_observations (
 tenant_id TEXT NOT NULL, store_id TEXT NOT NULL, resource_id TEXT NOT NULL, native_id TEXT NOT NULL,
 connection_revision INTEGER NOT NULL, revision INTEGER NOT NULL, state TEXT NOT NULL,
 observed_at INTEGER NOT NULL, source_updated_at INTEGER, payload TEXT, digest TEXT,
 PRIMARY KEY(tenant_id,store_id,resource_id)
) STRICT;
CREATE TABLE commerce_return_drafts (
 tenant_id TEXT NOT NULL, store_id TEXT NOT NULL, case_id TEXT NOT NULL, request_key TEXT NOT NULL,
 request_digest TEXT NOT NULL, preview_id TEXT NOT NULL,
 PRIMARY KEY(tenant_id,store_id,case_id), UNIQUE(tenant_id,store_id,request_key),
 FOREIGN KEY(tenant_id,store_id,preview_id) REFERENCES commerce_action_previews(tenant_id,store_id,id)
) STRICT;
CREATE TRIGGER commerce_resource_redaction_guard BEFORE UPDATE OF payload,customer_id ON commerce_resources
 WHEN EXISTS(SELECT 1 FROM commerce_privacy_resources p WHERE p.tenant_id=NEW.tenant_id AND p.store_id=NEW.store_id AND p.resource_id=NEW.id)
 AND (NEW.payload!='{"redacted":true}' OR NEW.customer_id IS NOT NULL)
 BEGIN SELECT RAISE(ABORT,'SUBJECT_ERASED'); END;
CREATE TRIGGER commerce_resource_redaction_insert BEFORE INSERT ON commerce_resources
 WHEN EXISTS(SELECT 1 FROM commerce_privacy_resources p WHERE p.tenant_id=NEW.tenant_id AND p.store_id=NEW.store_id AND p.resource_id=NEW.id)
 BEGIN SELECT RAISE(ABORT,'SUBJECT_ERASED'); END;
CREATE TRIGGER commerce_knowledge_redaction_guard BEFORE INSERT ON commerce_knowledge
 WHEN EXISTS(SELECT 1 FROM commerce_privacy_resources p WHERE p.tenant_id=NEW.tenant_id AND p.store_id=NEW.store_id AND p.resource_id=NEW.resource_id)
 BEGIN SELECT RAISE(ABORT,'SUBJECT_ERASED'); END;
CREATE TRIGGER commerce_knowledge_redaction_update BEFORE UPDATE ON commerce_knowledge
 WHEN EXISTS(SELECT 1 FROM commerce_privacy_resources p WHERE p.tenant_id=NEW.tenant_id AND p.store_id=NEW.store_id AND p.resource_id=NEW.resource_id)
 BEGIN SELECT RAISE(ABORT,'SUBJECT_ERASED'); END;
