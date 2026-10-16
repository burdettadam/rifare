CREATE TABLE commerce_knowledge (
  tenant_id TEXT NOT NULL, store_id TEXT NOT NULL, id TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK(revision>0), kind TEXT NOT NULL,
  title TEXT NOT NULL, content TEXT NOT NULL, source_uri TEXT NOT NULL,
  source_updated_at INTEGER NOT NULL, observed_at INTEGER NOT NULL, expires_at INTEGER NOT NULL,
  visibility TEXT NOT NULL CHECK(visibility IN ('store','staff','private')),
  owner_actor_id TEXT NOT NULL, resource_id TEXT, revoked INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(tenant_id,store_id,id),
  FOREIGN KEY(tenant_id,store_id) REFERENCES commerce_stores(tenant_id,store_id)
) STRICT;
CREATE TABLE commerce_skills (
  tenant_id TEXT NOT NULL, store_id TEXT NOT NULL, id TEXT NOT NULL,
  bundle_digest TEXT NOT NULL, bundle TEXT NOT NULL CHECK(json_valid(bundle)),
  PRIMARY KEY(tenant_id,store_id,id),
  FOREIGN KEY(tenant_id,store_id) REFERENCES commerce_stores(tenant_id,store_id)
) STRICT;
CREATE TABLE commerce_profiles (
  tenant_id TEXT NOT NULL, store_id TEXT NOT NULL, id TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK(revision>0), body TEXT NOT NULL CHECK(json_valid(body)),
  PRIMARY KEY(tenant_id,store_id,id),
  FOREIGN KEY(tenant_id,store_id) REFERENCES commerce_stores(tenant_id,store_id)
) STRICT;
CREATE TABLE commerce_context_tasks (
  tenant_id TEXT NOT NULL, store_id TEXT NOT NULL, id TEXT NOT NULL,
  resource_id TEXT NOT NULL, profile_id TEXT NOT NULL, profile_revision INTEGER NOT NULL,
  skill_digest TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL,
  PRIMARY KEY(tenant_id,store_id,id),
  FOREIGN KEY(tenant_id,store_id) REFERENCES commerce_stores(tenant_id,store_id)
) STRICT;
CREATE TABLE commerce_shopify_connections (
  tenant_id TEXT NOT NULL, store_id TEXT NOT NULL, domain TEXT NOT NULL,
  secret_ref TEXT NOT NULL, granted_scopes TEXT NOT NULL CHECK(json_valid(granted_scopes)),
  mode TEXT NOT NULL CHECK(mode IN ('fixture','live_test')), revision INTEGER NOT NULL,
  PRIMARY KEY(tenant_id,store_id),
  FOREIGN KEY(tenant_id,store_id) REFERENCES commerce_stores(tenant_id,store_id)
) STRICT;
CREATE TABLE commerce_order_observations (
  tenant_id TEXT NOT NULL, store_id TEXT NOT NULL, resource_id TEXT NOT NULL,
  native_id TEXT NOT NULL, connection_revision INTEGER NOT NULL,
  state TEXT NOT NULL, attempted_at INTEGER NOT NULL, successful_at INTEGER,
  response_digest TEXT, source_updated_at INTEGER, observation_revision INTEGER NOT NULL,
  retry_after_seconds INTEGER,
  PRIMARY KEY(tenant_id,store_id,resource_id),
  FOREIGN KEY(tenant_id,store_id) REFERENCES commerce_stores(tenant_id,store_id)
) STRICT;
