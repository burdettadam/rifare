CREATE TABLE commerce_execution_stops (
 scope_key TEXT PRIMARY KEY, tenant_id TEXT, store_id TEXT, action TEXT NOT NULL,
 revision INTEGER NOT NULL, stopped INTEGER NOT NULL CHECK(stopped IN (0,1)),
 reason TEXT NOT NULL, changed_by TEXT NOT NULL, changed_at INTEGER NOT NULL
) STRICT;
CREATE TABLE commerce_operation_controls (
 tenant_id TEXT NOT NULL, store_id TEXT NOT NULL, operation_id TEXT NOT NULL,
 stamp TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 1,
 PRIMARY KEY(tenant_id,store_id,operation_id),
 FOREIGN KEY(tenant_id,store_id,operation_id) REFERENCES commerce_operations(tenant_id,store_id,id)
) STRICT;
INSERT INTO commerce_operation_controls SELECT tenant_id,store_id,id,'0:0:0',1 FROM commerce_operations;
CREATE TABLE commerce_control_events (
 seq INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id TEXT, store_id TEXT,
 code TEXT NOT NULL, actor_id TEXT NOT NULL, subject_id TEXT NOT NULL,
 generation INTEGER NOT NULL, observed_at INTEGER NOT NULL
) STRICT;
CREATE TRIGGER commerce_control_events_no_update BEFORE UPDATE ON commerce_control_events
 BEGIN SELECT RAISE(ABORT,'CONTROL_EVENT_IMMUTABLE'); END;
CREATE TRIGGER commerce_control_events_no_delete BEFORE DELETE ON commerce_control_events
 BEGIN SELECT RAISE(ABORT,'CONTROL_EVENT_IMMUTABLE'); END;
CREATE TABLE commerce_worker_grants (
 token_hash TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, store_id TEXT NOT NULL,
 case_id TEXT NOT NULL, actor_id TEXT NOT NULL, parent_session_hash TEXT NOT NULL,
 audience TEXT NOT NULL, expires_at INTEGER NOT NULL, revoked INTEGER NOT NULL DEFAULT 0,
 FOREIGN KEY(tenant_id,store_id,case_id) REFERENCES commerce_cases(tenant_id,store_id,id)
) STRICT;
CREATE TABLE commerce_case_work (
 tenant_id TEXT NOT NULL, store_id TEXT NOT NULL, case_id TEXT NOT NULL, resource_id TEXT NOT NULL,
 generation INTEGER NOT NULL, owner TEXT NOT NULL, grant_hash TEXT NOT NULL,
 state TEXT NOT NULL CHECK(state IN ('active','completed','revoked')),
 expires_at INTEGER NOT NULL, deadline_at INTEGER NOT NULL,
 configuration_digest TEXT NOT NULL, control_stamp TEXT NOT NULL,
 PRIMARY KEY(tenant_id,store_id,case_id),
 FOREIGN KEY(tenant_id,store_id,case_id) REFERENCES commerce_cases(tenant_id,store_id,id)
) STRICT;
CREATE TABLE commerce_worker_submissions (
 tenant_id TEXT NOT NULL, store_id TEXT NOT NULL, id TEXT NOT NULL, case_id TEXT NOT NULL,
 generation INTEGER NOT NULL, grant_hash TEXT NOT NULL, request_key TEXT NOT NULL,
 request_digest TEXT NOT NULL, body TEXT NOT NULL CHECK(json_valid(body)), digest TEXT NOT NULL,
 PRIMARY KEY(tenant_id,store_id,id), UNIQUE(grant_hash,generation,request_key)
) STRICT;
CREATE TABLE commerce_worker_completions (
 tenant_id TEXT NOT NULL, store_id TEXT NOT NULL, case_id TEXT NOT NULL,
 generation INTEGER NOT NULL, grant_hash TEXT NOT NULL,
 request_digest TEXT NOT NULL, body TEXT NOT NULL CHECK(json_valid(body)), digest TEXT NOT NULL,
 PRIMARY KEY(tenant_id,store_id,case_id,generation)
) STRICT;
CREATE TABLE commerce_credential_slots (
 tenant_id TEXT NOT NULL, store_id TEXT NOT NULL, id TEXT NOT NULL,
 provider TEXT NOT NULL, adapter TEXT NOT NULL, version INTEGER NOT NULL,
 revision INTEGER NOT NULL, active INTEGER NOT NULL CHECK(active IN (0,1)),
 PRIMARY KEY(tenant_id,store_id,id)
) STRICT;
CREATE TABLE commerce_credential_versions (
 tenant_id TEXT NOT NULL, store_id TEXT NOT NULL, slot_id TEXT NOT NULL, version INTEGER NOT NULL,
 secret_ref TEXT NOT NULL, created_at INTEGER NOT NULL,
 PRIMARY KEY(tenant_id,store_id,slot_id,version),
 FOREIGN KEY(tenant_id,store_id,slot_id) REFERENCES commerce_credential_slots(tenant_id,store_id,id)
) STRICT;
CREATE TRIGGER commerce_credential_versions_no_update BEFORE UPDATE ON commerce_credential_versions
 BEGIN SELECT RAISE(ABORT,'CREDENTIAL_VERSION_IMMUTABLE'); END;
CREATE TABLE commerce_credential_calls (
 tenant_id TEXT NOT NULL, store_id TEXT NOT NULL, id TEXT NOT NULL, slot_id TEXT NOT NULL,
 version INTEGER NOT NULL, revision INTEGER NOT NULL, state TEXT NOT NULL,
 started_at INTEGER NOT NULL, finished_at INTEGER,
 PRIMARY KEY(tenant_id,store_id,id)
) STRICT;
CREATE TABLE commerce_worker_effects (
 tenant_id TEXT NOT NULL, store_id TEXT NOT NULL, submission_id TEXT NOT NULL,
 approval_id TEXT NOT NULL, body TEXT NOT NULL CHECK(json_valid(body)), digest TEXT NOT NULL,
 PRIMARY KEY(tenant_id,store_id,submission_id),
 FOREIGN KEY(tenant_id,store_id,submission_id) REFERENCES commerce_worker_submissions(tenant_id,store_id,id)
) STRICT;
