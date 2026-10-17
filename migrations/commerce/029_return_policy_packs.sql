CREATE TABLE commerce_return_policy_packs (
  tenant_id TEXT NOT NULL,
  store_id TEXT NOT NULL,
  id TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK(revision > 0),
  body TEXT NOT NULL,
  digest TEXT NOT NULL,
  author TEXT NOT NULL,
  observed_at INTEGER NOT NULL,
  PRIMARY KEY(tenant_id, store_id, id, revision),
  FOREIGN KEY(tenant_id, store_id) REFERENCES commerce_stores(tenant_id, store_id)
) STRICT;
