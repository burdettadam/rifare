CREATE TABLE commerce_optional_configurations (
  tenant_id TEXT NOT NULL, store_id TEXT NOT NULL, kind TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK(revision > 0), enabled INTEGER NOT NULL CHECK(enabled IN (0,1)),
  body TEXT NOT NULL, digest TEXT NOT NULL, expires_at INTEGER NOT NULL,
  PRIMARY KEY(tenant_id,store_id,kind),
  FOREIGN KEY(tenant_id,store_id) REFERENCES commerce_stores(tenant_id,store_id)
) STRICT;

CREATE TABLE commerce_optional_consents (
  tenant_id TEXT NOT NULL, store_id TEXT NOT NULL, id TEXT NOT NULL, resource_id TEXT NOT NULL,
  subject_hash TEXT NOT NULL, kind TEXT NOT NULL, state TEXT NOT NULL CHECK(state IN ('granted','withdrawn')),
  body TEXT NOT NULL, digest TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL,
  PRIMARY KEY(tenant_id,store_id,id),
  FOREIGN KEY(tenant_id,store_id) REFERENCES commerce_stores(tenant_id,store_id)
) STRICT;

CREATE TABLE commerce_optional_media (
  tenant_id TEXT NOT NULL, store_id TEXT NOT NULL, id TEXT NOT NULL, resource_id TEXT NOT NULL,
  subject_hash TEXT NOT NULL, consent_id TEXT NOT NULL, state TEXT NOT NULL CHECK(state IN ('available','erased')),
  body TEXT NOT NULL, digest TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL,
  PRIMARY KEY(tenant_id,store_id,id),
  FOREIGN KEY(tenant_id,store_id) REFERENCES commerce_stores(tenant_id,store_id)
) STRICT;

CREATE TABLE commerce_optional_quality (
  tenant_id TEXT NOT NULL, store_id TEXT NOT NULL, id TEXT NOT NULL, kind TEXT NOT NULL,
  configuration_digest TEXT NOT NULL, state TEXT NOT NULL CHECK(state IN ('active','revoked')),
  body TEXT NOT NULL, digest TEXT NOT NULL, expires_at INTEGER NOT NULL,
  PRIMARY KEY(tenant_id,store_id,id),
  FOREIGN KEY(tenant_id,store_id) REFERENCES commerce_stores(tenant_id,store_id)
) STRICT;

CREATE TABLE commerce_optional_operations (
  tenant_id TEXT NOT NULL, store_id TEXT NOT NULL, id TEXT NOT NULL, resource_id TEXT NOT NULL,
  subject_hash TEXT NOT NULL, kind TEXT NOT NULL, consent_id TEXT NOT NULL, logical_key TEXT NOT NULL,
  source_identity TEXT NOT NULL, native_id TEXT,
  state TEXT NOT NULL CHECK(state IN ('queued','unknown','applied','blocked','cancelled','rejected')),
  body TEXT NOT NULL, digest TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL,
  PRIMARY KEY(tenant_id,store_id,id), UNIQUE(tenant_id,store_id,logical_key),
  FOREIGN KEY(tenant_id,store_id) REFERENCES commerce_stores(tenant_id,store_id)
) STRICT;

CREATE TABLE commerce_optional_deletions (
  tenant_id TEXT NOT NULL, store_id TEXT NOT NULL, id TEXT NOT NULL, resource_id TEXT NOT NULL,
  subject_hash TEXT NOT NULL, source_identity TEXT NOT NULL, original_operation_id TEXT NOT NULL,
  native_id TEXT, state TEXT NOT NULL CHECK(state IN ('pending','deleted')),
  body TEXT NOT NULL, digest TEXT NOT NULL, created_at INTEGER NOT NULL,
  PRIMARY KEY(tenant_id,store_id,id), UNIQUE(tenant_id,store_id,source_identity,original_operation_id),
  FOREIGN KEY(tenant_id,store_id) REFERENCES commerce_stores(tenant_id,store_id)
) STRICT;
