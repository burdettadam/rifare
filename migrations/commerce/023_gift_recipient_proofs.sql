CREATE TABLE commerce_gift_challenges (
 id TEXT PRIMARY KEY, proof_hash TEXT NOT NULL, tenant_id TEXT, store_id TEXT NOT NULL,
 resource_id TEXT, gift_digest TEXT NOT NULL, expires_at INTEGER NOT NULL,
 attempts INTEGER NOT NULL DEFAULT 0, consumed INTEGER NOT NULL DEFAULT 0
) STRICT;
CREATE TABLE commerce_gift_sessions (
 token_hash TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, store_id TEXT NOT NULL,
 resource_id TEXT NOT NULL, gift_id TEXT NOT NULL, gift_digest TEXT NOT NULL,
 recipient_customer_id TEXT NOT NULL, expires_at INTEGER NOT NULL, revoked INTEGER NOT NULL DEFAULT 0
) STRICT;
CREATE TABLE commerce_gift_cases (
 tenant_id TEXT NOT NULL, store_id TEXT NOT NULL, case_id TEXT NOT NULL,
 resource_id TEXT NOT NULL, token_hash TEXT NOT NULL,
 body TEXT NOT NULL CHECK(json_valid(body)), digest TEXT NOT NULL, revision INTEGER NOT NULL,
 PRIMARY KEY(tenant_id,store_id,case_id)
) STRICT;
