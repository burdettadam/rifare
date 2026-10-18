-- Local M09 shopping/catalog preparation. Existing order edits own every upsell effect.
CREATE TABLE commerce_shopping_carts (
 tenant_id TEXT NOT NULL, store_id TEXT NOT NULL, cart_id TEXT NOT NULL,
 resource_id TEXT NOT NULL, customer_id TEXT NOT NULL,
 state TEXT NOT NULL CHECK(state IN ('proposed','unknown','committed')),
 body TEXT NOT NULL CHECK(json_valid(body)), digest TEXT NOT NULL,
 PRIMARY KEY(tenant_id,store_id,cart_id)
) STRICT;
CREATE TABLE commerce_upsell_offers (
 tenant_id TEXT NOT NULL, store_id TEXT NOT NULL, offer_id TEXT NOT NULL,
 case_id TEXT NOT NULL, resource_id TEXT NOT NULL, customer_id TEXT NOT NULL,
 quote_id TEXT NOT NULL, body TEXT NOT NULL CHECK(json_valid(body)), digest TEXT NOT NULL,
 PRIMARY KEY(tenant_id,store_id,offer_id), UNIQUE(tenant_id,store_id,quote_id)
) STRICT;
CREATE TABLE commerce_upsell_confirmations (
 tenant_id TEXT NOT NULL, store_id TEXT NOT NULL, quote_id TEXT NOT NULL,
 resource_id TEXT NOT NULL, customer_id TEXT NOT NULL, session_hash TEXT NOT NULL,
 revoked INTEGER NOT NULL CHECK(revoked IN (0,1)),
 body TEXT NOT NULL CHECK(json_valid(body)), digest TEXT NOT NULL,
 PRIMARY KEY(tenant_id,store_id,quote_id)
) STRICT;
CREATE TABLE commerce_catalog_evaluations (
 tenant_id TEXT NOT NULL, store_id TEXT NOT NULL, evaluation_id TEXT NOT NULL,
 resource_id TEXT NOT NULL, customer_id TEXT NOT NULL,
 body TEXT NOT NULL CHECK(json_valid(body)), digest TEXT NOT NULL,
 PRIMARY KEY(tenant_id,store_id,evaluation_id)
) STRICT;
CREATE TABLE commerce_catalog_changes (
 tenant_id TEXT NOT NULL, store_id TEXT NOT NULL, change_id TEXT NOT NULL,
 resource_id TEXT NOT NULL, customer_id TEXT NOT NULL,
 state TEXT NOT NULL CHECK(state IN ('proposed','unknown','applied')),
 body TEXT NOT NULL CHECK(json_valid(body)), digest TEXT NOT NULL,
 PRIMARY KEY(tenant_id,store_id,change_id)
) STRICT;
CREATE TABLE commerce_catalog_approvals (
 tenant_id TEXT NOT NULL, store_id TEXT NOT NULL, change_id TEXT NOT NULL,
 resource_id TEXT NOT NULL, customer_id TEXT NOT NULL, actor_id TEXT NOT NULL,
 authority_revision INTEGER NOT NULL, expires_at INTEGER NOT NULL,
 revoked INTEGER NOT NULL CHECK(revoked IN (0,1)),
 body TEXT NOT NULL CHECK(json_valid(body)), digest TEXT NOT NULL,
 PRIMARY KEY(tenant_id,store_id,change_id)
) STRICT;
