CREATE TABLE commerce_secrets (
  tenant_id TEXT NOT NULL, store_id TEXT NOT NULL, ref TEXT NOT NULL,
  provider TEXT NOT NULL, adapter TEXT NOT NULL, key_id TEXT NOT NULL,
  envelope TEXT NOT NULL CHECK(json_valid(envelope)), created_at INTEGER NOT NULL,
  revoked INTEGER NOT NULL DEFAULT 0 CHECK(revoked IN (0,1)),
  PRIMARY KEY(tenant_id,store_id,ref),
  FOREIGN KEY(tenant_id,store_id) REFERENCES commerce_stores(tenant_id,store_id)
) STRICT;
