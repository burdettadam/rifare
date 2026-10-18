-- Trial records hold terms, consent and observations. Existing instant payment
-- tables remain the only authorization, operation and capture owner.
CREATE TABLE commerce_trial_terms (
 tenant_id TEXT NOT NULL, store_id TEXT NOT NULL, id TEXT NOT NULL,
 version INTEGER NOT NULL, author TEXT NOT NULL, authority_revision INTEGER NOT NULL,
 body TEXT NOT NULL CHECK(json_valid(body)), digest TEXT NOT NULL,
 PRIMARY KEY(tenant_id,store_id,id,version)
) STRICT;
CREATE TABLE commerce_trial_term_approvals (
 tenant_id TEXT NOT NULL, store_id TEXT NOT NULL, id TEXT NOT NULL,
 terms_id TEXT NOT NULL, version INTEGER NOT NULL, approver TEXT NOT NULL,
 authority_revision INTEGER NOT NULL, expires_at INTEGER NOT NULL,
 revoked INTEGER NOT NULL DEFAULT 0,
 body TEXT NOT NULL CHECK(json_valid(body)), digest TEXT NOT NULL,
 PRIMARY KEY(tenant_id,store_id,id), UNIQUE(tenant_id,store_id,terms_id,version)
) STRICT;
CREATE TABLE commerce_delivery_trials (
 tenant_id TEXT NOT NULL, store_id TEXT NOT NULL, id TEXT NOT NULL,
 case_id TEXT NOT NULL, resource_id TEXT NOT NULL, customer_id TEXT NOT NULL,
 subject_hash TEXT NOT NULL, revision INTEGER NOT NULL, state TEXT NOT NULL,
 body TEXT NOT NULL CHECK(json_valid(body)), digest TEXT NOT NULL,
 PRIMARY KEY(tenant_id,store_id,id), UNIQUE(tenant_id,store_id,resource_id)
) STRICT;
CREATE TABLE commerce_trial_consents (
 tenant_id TEXT NOT NULL, store_id TEXT NOT NULL, id TEXT NOT NULL,
 trial_id TEXT NOT NULL, resource_id TEXT NOT NULL, customer_id TEXT NOT NULL,
 subject_hash TEXT NOT NULL, revoked INTEGER NOT NULL DEFAULT 0,
 body TEXT NOT NULL CHECK(json_valid(body)), digest TEXT NOT NULL,
 PRIMARY KEY(tenant_id,store_id,id)
) STRICT;
CREATE TABLE commerce_trial_events (
 tenant_id TEXT NOT NULL, store_id TEXT NOT NULL, id TEXT NOT NULL,
 trial_id TEXT NOT NULL, resource_id TEXT NOT NULL, customer_id TEXT NOT NULL,
 subject_hash TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('delivery','return')),
 body TEXT NOT NULL CHECK(json_valid(body)), digest TEXT NOT NULL,
 PRIMARY KEY(tenant_id,store_id,id)
) STRICT;
