CREATE TABLE commerce_challenges (
  id TEXT PRIMARY KEY, proof_hash TEXT NOT NULL, tenant_id TEXT, store_id TEXT NOT NULL,
  resource_id TEXT, customer_id TEXT, owner_hash TEXT NOT NULL,
  expires_at INTEGER NOT NULL, attempts INTEGER NOT NULL DEFAULT 0,
  consumed INTEGER NOT NULL DEFAULT 0 CHECK(consumed IN (0,1))
) STRICT;
CREATE TABLE commerce_challenge_rates (
  bucket TEXT PRIMARY KEY, window_start INTEGER NOT NULL, count INTEGER NOT NULL CHECK(count>0)
) STRICT;
