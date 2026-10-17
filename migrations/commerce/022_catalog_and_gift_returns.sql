CREATE TABLE commerce_exchange_settings (
 tenant_id TEXT NOT NULL, store_id TEXT NOT NULL, revision INTEGER NOT NULL,
 body TEXT NOT NULL CHECK(json_valid(body)), digest TEXT NOT NULL,
 PRIMARY KEY(tenant_id,store_id)
) STRICT;
