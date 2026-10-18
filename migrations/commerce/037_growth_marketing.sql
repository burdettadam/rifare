-- Merchant configurations contain counts/digests, never a copied customer list.
CREATE TABLE commerce_checkout_experiments (
 tenant_id TEXT NOT NULL, store_id TEXT NOT NULL, id TEXT NOT NULL, version INTEGER NOT NULL,
 body TEXT NOT NULL, digest TEXT NOT NULL, created_at INTEGER NOT NULL,
 PRIMARY KEY(tenant_id,store_id,id)
) STRICT;
CREATE TABLE commerce_checkout_assignments (
 tenant_id TEXT NOT NULL, store_id TEXT NOT NULL, experiment_id TEXT NOT NULL,
 resource_id TEXT NOT NULL, customer_id TEXT NOT NULL, subject_hash TEXT NOT NULL,
 arm TEXT, body TEXT NOT NULL, digest TEXT NOT NULL,
 PRIMARY KEY(tenant_id,store_id,experiment_id,subject_hash),
 UNIQUE(tenant_id,store_id,experiment_id,resource_id)
) STRICT;
CREATE TABLE commerce_checkout_exposures (
 tenant_id TEXT NOT NULL, store_id TEXT NOT NULL, id TEXT NOT NULL, experiment_id TEXT NOT NULL,
 resource_id TEXT NOT NULL, customer_id TEXT NOT NULL, subject_hash TEXT NOT NULL,
 channel TEXT NOT NULL, body TEXT NOT NULL, digest TEXT NOT NULL,
 PRIMARY KEY(tenant_id,store_id,id), UNIQUE(tenant_id,store_id,experiment_id,subject_hash,channel)
) STRICT;
CREATE TABLE commerce_growth_observations (
 tenant_id TEXT NOT NULL, store_id TEXT NOT NULL, experiment_id TEXT NOT NULL, event_id TEXT NOT NULL,
 resource_id TEXT NOT NULL, customer_id TEXT NOT NULL, source_identity TEXT NOT NULL,
 body TEXT NOT NULL, digest TEXT NOT NULL,
 PRIMARY KEY(tenant_id,store_id,experiment_id,event_id)
) STRICT;
CREATE TABLE commerce_marketing_segments (
 tenant_id TEXT NOT NULL, store_id TEXT NOT NULL, id TEXT NOT NULL, revision INTEGER NOT NULL,
 body TEXT NOT NULL, digest TEXT NOT NULL, author_id TEXT NOT NULL,
 approval_body TEXT, approval_digest TEXT, revoked INTEGER NOT NULL DEFAULT 0 CHECK(revoked IN(0,1)),
 PRIMARY KEY(tenant_id,store_id,id)
) STRICT;
CREATE TABLE commerce_marketing_sync_operations (
 tenant_id TEXT NOT NULL, store_id TEXT NOT NULL, id TEXT NOT NULL, segment_id TEXT NOT NULL,
 state TEXT NOT NULL, body TEXT NOT NULL, digest TEXT NOT NULL,
 PRIMARY KEY(tenant_id,store_id,id)
) STRICT;
CREATE TABLE commerce_growth_campaigns (
 tenant_id TEXT NOT NULL, store_id TEXT NOT NULL, id TEXT NOT NULL, revision INTEGER NOT NULL,
 author_id TEXT NOT NULL, state TEXT NOT NULL, body TEXT NOT NULL, digest TEXT NOT NULL,
 PRIMARY KEY(tenant_id,store_id,id)
) STRICT;
CREATE TABLE commerce_growth_campaign_approvals (
 tenant_id TEXT NOT NULL, store_id TEXT NOT NULL, campaign_id TEXT NOT NULL,
 id TEXT NOT NULL, body TEXT NOT NULL, digest TEXT NOT NULL,
 revoked INTEGER NOT NULL DEFAULT 0 CHECK(revoked IN(0,1)),
 PRIMARY KEY(tenant_id,store_id,id)
) STRICT;
CREATE TABLE commerce_growth_campaign_recipients (
 tenant_id TEXT NOT NULL, store_id TEXT NOT NULL, campaign_id TEXT NOT NULL,
 resource_id TEXT NOT NULL, customer_id TEXT NOT NULL, case_id TEXT NOT NULL,
 operation_id TEXT, body TEXT NOT NULL, digest TEXT NOT NULL,
 PRIMARY KEY(tenant_id,store_id,campaign_id,resource_id),
 UNIQUE(tenant_id,store_id,operation_id)
) STRICT;
CREATE TABLE commerce_cart_recoveries (
 tenant_id TEXT NOT NULL, store_id TEXT NOT NULL, id TEXT NOT NULL, campaign_id TEXT NOT NULL,
 resource_id TEXT NOT NULL, customer_id TEXT NOT NULL, cart_id TEXT NOT NULL,
 body TEXT NOT NULL, digest TEXT NOT NULL,
 PRIMARY KEY(tenant_id,store_id,id), UNIQUE(tenant_id,store_id,cart_id)
) STRICT;
CREATE TABLE commerce_email_action_links (
 tenant_id TEXT NOT NULL, store_id TEXT NOT NULL, id TEXT NOT NULL,
 resource_id TEXT NOT NULL, customer_id TEXT NOT NULL, token_hash TEXT NOT NULL,
 state TEXT NOT NULL, body TEXT NOT NULL, digest TEXT NOT NULL,
 revoked INTEGER NOT NULL DEFAULT 0 CHECK(revoked IN(0,1)),
 PRIMARY KEY(tenant_id,store_id,id), UNIQUE(token_hash)
) STRICT;
