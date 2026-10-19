CREATE TABLE commerce_extension_artifacts (
 tenant_id TEXT NOT NULL, store_id TEXT NOT NULL, id TEXT NOT NULL,
 extension_id TEXT NOT NULL, version TEXT NOT NULL, kind TEXT NOT NULL,
 state TEXT NOT NULL, body TEXT NOT NULL CHECK(json_valid(body)), digest TEXT NOT NULL,
 PRIMARY KEY(tenant_id,store_id,id),
 FOREIGN KEY(tenant_id,store_id) REFERENCES commerce_stores(tenant_id,store_id)
) STRICT;
CREATE UNIQUE INDEX commerce_extension_version ON commerce_extension_artifacts(tenant_id,store_id,extension_id,version);
CREATE UNIQUE INDEX commerce_extension_installed ON commerce_extension_artifacts(tenant_id,store_id,extension_id) WHERE state='installed';
CREATE TABLE commerce_extension_reviews (
 tenant_id TEXT NOT NULL, store_id TEXT NOT NULL, id TEXT NOT NULL, artifact_id TEXT NOT NULL,
 state TEXT NOT NULL, body TEXT NOT NULL CHECK(json_valid(body)), digest TEXT NOT NULL,
 PRIMARY KEY(tenant_id,store_id,id),
 FOREIGN KEY(tenant_id,store_id,artifact_id) REFERENCES commerce_extension_artifacts(tenant_id,store_id,id)
) STRICT;
CREATE TABLE commerce_extension_transitions (
 tenant_id TEXT NOT NULL, store_id TEXT NOT NULL, id TEXT NOT NULL, extension_id TEXT NOT NULL,
 state TEXT NOT NULL, body TEXT NOT NULL CHECK(json_valid(body)), digest TEXT NOT NULL,
 PRIMARY KEY(tenant_id,store_id,id),
 FOREIGN KEY(tenant_id,store_id) REFERENCES commerce_stores(tenant_id,store_id)
) STRICT;
CREATE TABLE commerce_extension_retirements (
 tenant_id TEXT NOT NULL, store_id TEXT NOT NULL, id TEXT NOT NULL, extension_id TEXT NOT NULL,
 state TEXT NOT NULL, body TEXT NOT NULL CHECK(json_valid(body)), digest TEXT NOT NULL,
 PRIMARY KEY(tenant_id,store_id,id),
 FOREIGN KEY(tenant_id,store_id) REFERENCES commerce_stores(tenant_id,store_id)
) STRICT;
