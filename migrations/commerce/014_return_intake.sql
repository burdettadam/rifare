CREATE TABLE commerce_return_settings (
 tenant_id TEXT NOT NULL, store_id TEXT NOT NULL, revision INTEGER NOT NULL,
 body TEXT NOT NULL CHECK(json_valid(body)), digest TEXT NOT NULL,
 PRIMARY KEY(tenant_id,store_id)
) STRICT;
CREATE TABLE commerce_return_quotes (
 tenant_id TEXT NOT NULL, store_id TEXT NOT NULL, id TEXT NOT NULL,
 case_id TEXT NOT NULL, resource_id TEXT NOT NULL, actor_id TEXT NOT NULL,
 body TEXT NOT NULL CHECK(json_valid(body)), digest TEXT NOT NULL, expires_at INTEGER NOT NULL,
 PRIMARY KEY(tenant_id,store_id,id)
) STRICT;
CREATE TABLE commerce_return_evidence (
 tenant_id TEXT NOT NULL, store_id TEXT NOT NULL, id TEXT NOT NULL,
 case_id TEXT NOT NULL, resource_id TEXT NOT NULL, actor_id TEXT NOT NULL,
 state TEXT NOT NULL CHECK(state IN ('quarantined','clean','rejected','erased')),
 bytes BLOB, sha256 TEXT NOT NULL, mime TEXT NOT NULL, note TEXT NOT NULL,
 scanner TEXT, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL,
 PRIMARY KEY(tenant_id,store_id,id)
) STRICT;
CREATE TABLE commerce_return_overrides (
 tenant_id TEXT NOT NULL, store_id TEXT NOT NULL, id TEXT NOT NULL,
 quote_id TEXT NOT NULL, quote_digest TEXT NOT NULL, actor_id TEXT NOT NULL,
 authority_revision INTEGER NOT NULL, reason TEXT NOT NULL,
 expires_at INTEGER NOT NULL, revoked INTEGER NOT NULL DEFAULT 0,
 PRIMARY KEY(tenant_id,store_id,id)
) STRICT;
CREATE TABLE commerce_return_requests (
 tenant_id TEXT NOT NULL, store_id TEXT NOT NULL, id TEXT NOT NULL,
 case_id TEXT NOT NULL, resource_id TEXT NOT NULL, actor_id TEXT NOT NULL,
 request_key TEXT NOT NULL, quote_id TEXT NOT NULL, preview_id TEXT NOT NULL,
 state TEXT NOT NULL CHECK(state IN ('awaiting_review','submitted','native_unknown','native_created')),
 body TEXT NOT NULL CHECK(json_valid(body)), digest TEXT NOT NULL,
 receipt_id TEXT, created_at INTEGER NOT NULL,
 PRIMARY KEY(tenant_id,store_id,id), UNIQUE(tenant_id,store_id,request_key), UNIQUE(tenant_id,store_id,case_id)
) STRICT;
CREATE TABLE commerce_return_review_events (
 seq INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id TEXT NOT NULL, store_id TEXT NOT NULL,
 case_id TEXT NOT NULL, actor_id TEXT NOT NULL, event TEXT NOT NULL, reason TEXT NOT NULL,
 observed_at INTEGER NOT NULL
) STRICT;
CREATE TABLE commerce_native_return_operations (
 tenant_id TEXT NOT NULL, store_id TEXT NOT NULL, id TEXT NOT NULL,
 request_id TEXT NOT NULL, source_identity TEXT NOT NULL,
 state TEXT NOT NULL CHECK(state IN ('unknown','created','rejected')),
 request_digest TEXT NOT NULL, native_id TEXT, native_body TEXT, native_digest TEXT,
 observed_at INTEGER NOT NULL,
 PRIMARY KEY(tenant_id,store_id,id), UNIQUE(tenant_id,store_id,request_id), UNIQUE(tenant_id,store_id,source_identity,native_id)
) STRICT;
CREATE INDEX commerce_return_requests_resource ON commerce_return_requests(tenant_id,store_id,resource_id,state);
CREATE INDEX commerce_return_evidence_resource ON commerce_return_evidence(tenant_id,store_id,resource_id);
CREATE INDEX commerce_return_quotes_case ON commerce_return_quotes(tenant_id,store_id,case_id);
