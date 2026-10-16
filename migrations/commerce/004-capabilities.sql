CREATE TABLE commerce_connections (
  tenant_id TEXT NOT NULL, store_id TEXT NOT NULL, adapter TEXT NOT NULL,
  contract_version TEXT NOT NULL, granted_scopes TEXT NOT NULL CHECK(json_valid(granted_scopes)),
  qualification TEXT NOT NULL CHECK(qualification IN ('synthetic','unverified')),
  evidence_hash TEXT NOT NULL, revision INTEGER NOT NULL CHECK(revision>0),
  PRIMARY KEY(tenant_id,store_id),
  FOREIGN KEY(tenant_id,store_id) REFERENCES commerce_stores(tenant_id,store_id)
) STRICT;
