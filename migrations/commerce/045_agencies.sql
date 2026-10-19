CREATE TABLE commerce_agency_grants (
 tenant_id TEXT NOT NULL, store_id TEXT NOT NULL, id TEXT NOT NULL,
 revision INTEGER NOT NULL CHECK(revision>0), state TEXT NOT NULL CHECK(state IN ('active','revoked')),
 body TEXT NOT NULL CHECK(json_valid(body)), digest TEXT NOT NULL,
 PRIMARY KEY(tenant_id,store_id,id),
 FOREIGN KEY(tenant_id,store_id) REFERENCES commerce_stores(tenant_id,store_id)
) STRICT;
CREATE TABLE commerce_shared_templates (
 tenant_id TEXT NOT NULL, store_id TEXT NOT NULL, id TEXT NOT NULL,
 version INTEGER NOT NULL CHECK(version>0), state TEXT NOT NULL CHECK(state IN ('published','inert')),
 body TEXT NOT NULL CHECK(json_valid(body)), digest TEXT NOT NULL,
 PRIMARY KEY(tenant_id,store_id,id,version),
 FOREIGN KEY(tenant_id,store_id) REFERENCES commerce_stores(tenant_id,store_id)
) STRICT;
CREATE TABLE commerce_template_offers (
 tenant_id TEXT NOT NULL, store_id TEXT NOT NULL, id TEXT NOT NULL,
 revision INTEGER NOT NULL CHECK(revision=1), state TEXT NOT NULL CHECK(state IN ('pending','accepted','rejected','rolled_back','revoked')),
 body TEXT NOT NULL CHECK(json_valid(body)), digest TEXT NOT NULL,
 PRIMARY KEY(tenant_id,store_id,id),
 FOREIGN KEY(tenant_id,store_id) REFERENCES commerce_stores(tenant_id,store_id)
) STRICT;
CREATE TABLE commerce_template_decisions (
 tenant_id TEXT NOT NULL, store_id TEXT NOT NULL, id TEXT NOT NULL,
 version INTEGER NOT NULL CHECK(version IN (1,2)), state TEXT NOT NULL CHECK(state IN ('accepted','rejected','rolled_back','revoked')),
 body TEXT NOT NULL CHECK(json_valid(body)), digest TEXT NOT NULL,
 PRIMARY KEY(tenant_id,store_id,id,version),
 FOREIGN KEY(tenant_id,store_id) REFERENCES commerce_stores(tenant_id,store_id)
) STRICT;
