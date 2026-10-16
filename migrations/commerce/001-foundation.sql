CREATE TABLE commerce_stores (
  tenant_id TEXT NOT NULL, store_id TEXT NOT NULL, market TEXT NOT NULL,
  active INTEGER NOT NULL CHECK(active IN (0,1)),
  PRIMARY KEY(tenant_id, store_id), UNIQUE(store_id)
) STRICT;
CREATE TABLE commerce_members (
  tenant_id TEXT NOT NULL, store_id TEXT NOT NULL, actor_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('operator','worker')), active INTEGER NOT NULL CHECK(active IN (0,1)),
  PRIMARY KEY(tenant_id,store_id,actor_id),
  FOREIGN KEY(tenant_id,store_id) REFERENCES commerce_stores(tenant_id,store_id)
) STRICT;
CREATE TABLE commerce_sessions (
  token_hash TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, store_id TEXT NOT NULL,
  actor_id TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('operator','worker','customer')),
  resource_id TEXT, customer_id TEXT, expires_at INTEGER NOT NULL, last_seen INTEGER NOT NULL,
  revoked INTEGER NOT NULL DEFAULT 0 CHECK(revoked IN (0,1)),
  FOREIGN KEY(tenant_id,store_id) REFERENCES commerce_stores(tenant_id,store_id)
) STRICT;
CREATE TABLE commerce_resources (
  tenant_id TEXT NOT NULL, store_id TEXT NOT NULL, id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('order','customer','shipment','catalog','payment')),
  source_system TEXT NOT NULL, external_id TEXT NOT NULL, source_version INTEGER NOT NULL CHECK(source_version>0),
  source_updated_at INTEGER NOT NULL, observed_at INTEGER NOT NULL,
  customer_id TEXT, payload TEXT NOT NULL CHECK(json_valid(payload)),
  PRIMARY KEY(tenant_id,store_id,id), UNIQUE(tenant_id,store_id,kind,source_system,external_id),
  FOREIGN KEY(tenant_id,store_id) REFERENCES commerce_stores(tenant_id,store_id)
) STRICT;
CREATE TABLE commerce_read_jobs (
  tenant_id TEXT NOT NULL, store_id TEXT NOT NULL, id TEXT NOT NULL, resource_id TEXT NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('pending','completed')), result TEXT,
  PRIMARY KEY(tenant_id,store_id,id),
  FOREIGN KEY(tenant_id,store_id,resource_id) REFERENCES commerce_resources(tenant_id,store_id,id)
) STRICT;
CREATE TABLE commerce_attachments (
  tenant_id TEXT NOT NULL, store_id TEXT NOT NULL, id TEXT NOT NULL, resource_id TEXT NOT NULL,
  content TEXT NOT NULL CHECK(json_valid(content)),
  PRIMARY KEY(tenant_id,store_id,id),
  FOREIGN KEY(tenant_id,store_id,resource_id) REFERENCES commerce_resources(tenant_id,store_id,id)
) STRICT;
CREATE TABLE commerce_audit (
  id INTEGER PRIMARY KEY, tenant_id TEXT NOT NULL, store_id TEXT NOT NULL,
  actor_id TEXT NOT NULL, operation TEXT NOT NULL, decision TEXT NOT NULL, observed_at INTEGER NOT NULL,
  FOREIGN KEY(tenant_id,store_id) REFERENCES commerce_stores(tenant_id,store_id)
) STRICT;
