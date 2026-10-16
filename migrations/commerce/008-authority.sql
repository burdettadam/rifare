CREATE TABLE commerce_members_v2 (
  tenant_id TEXT NOT NULL, store_id TEXT NOT NULL, actor_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('owner','operator','reviewer','integration','agent','worker')),
  active INTEGER NOT NULL CHECK(active IN (0,1)), PRIMARY KEY(tenant_id,store_id,actor_id),
  FOREIGN KEY(tenant_id,store_id) REFERENCES commerce_stores(tenant_id,store_id)
) STRICT;
INSERT INTO commerce_members_v2 SELECT * FROM commerce_members;
DROP TABLE commerce_members;
ALTER TABLE commerce_members_v2 RENAME TO commerce_members;
CREATE TABLE commerce_sessions_v2 (
  token_hash TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, store_id TEXT NOT NULL,
  actor_id TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('owner','operator','reviewer','integration','agent','worker','customer')),
  resource_id TEXT, customer_id TEXT, expires_at INTEGER NOT NULL, last_seen INTEGER NOT NULL,
  revoked INTEGER NOT NULL DEFAULT 0 CHECK(revoked IN (0,1)),
  FOREIGN KEY(tenant_id,store_id) REFERENCES commerce_stores(tenant_id,store_id)
) STRICT;
INSERT INTO commerce_sessions_v2 SELECT * FROM commerce_sessions;
DROP TABLE commerce_sessions;
ALTER TABLE commerce_sessions_v2 RENAME TO commerce_sessions;
CREATE TABLE commerce_permissions (
  tenant_id TEXT NOT NULL, store_id TEXT NOT NULL, actor_id TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK(revision>0), actions TEXT, resource_ids TEXT,
  PRIMARY KEY(tenant_id,store_id,actor_id),
  FOREIGN KEY(tenant_id,store_id,actor_id) REFERENCES commerce_members(tenant_id,store_id,actor_id),
  CHECK(actions IS NULL OR json_valid(actions)), CHECK(resource_ids IS NULL OR json_valid(resource_ids))
) STRICT;
CREATE TABLE commerce_security_events (
  id INTEGER PRIMARY KEY, tenant_id TEXT NOT NULL, store_id TEXT NOT NULL,
  actor_id TEXT NOT NULL, target_actor TEXT, operation TEXT NOT NULL,
  decision TEXT NOT NULL CHECK(decision IN ('allowed','denied')),
  authority_revision INTEGER NOT NULL, observed_at INTEGER NOT NULL,
  FOREIGN KEY(tenant_id,store_id) REFERENCES commerce_stores(tenant_id,store_id)
) STRICT;
