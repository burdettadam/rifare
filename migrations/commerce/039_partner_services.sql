CREATE TABLE commerce_partner_configurations (
 tenant_id TEXT NOT NULL, store_id TEXT NOT NULL, service TEXT NOT NULL, account_id TEXT NOT NULL,
 revision INTEGER NOT NULL CHECK(revision>0), enabled INTEGER NOT NULL CHECK(enabled IN (0,1)),
 unavailable INTEGER NOT NULL CHECK(unavailable IN (0,1)), body TEXT NOT NULL, digest TEXT NOT NULL,
 expires_at INTEGER NOT NULL, PRIMARY KEY(tenant_id,store_id,service,account_id)
) STRICT;
CREATE TABLE commerce_partner_approvals (
 tenant_id TEXT NOT NULL, store_id TEXT NOT NULL, id TEXT NOT NULL, service TEXT NOT NULL, account_id TEXT NOT NULL,
 revision INTEGER NOT NULL, state TEXT NOT NULL CHECK(state IN ('approved','revoked')), body TEXT NOT NULL,
 digest TEXT NOT NULL, expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL,
 PRIMARY KEY(tenant_id,store_id,id)
) STRICT;
CREATE TABLE commerce_protection_proposals (
 tenant_id TEXT NOT NULL, store_id TEXT NOT NULL, id TEXT NOT NULL, resource_id TEXT NOT NULL, subject_hash TEXT NOT NULL,
 state TEXT NOT NULL, body TEXT NOT NULL, digest TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY(tenant_id,store_id,id)
) STRICT;
CREATE TABLE commerce_protection_confirmations (
 tenant_id TEXT NOT NULL, store_id TEXT NOT NULL, id TEXT NOT NULL, resource_id TEXT NOT NULL, subject_hash TEXT NOT NULL,
 state TEXT NOT NULL, body TEXT NOT NULL, digest TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY(tenant_id,store_id,id)
) STRICT;
CREATE TABLE commerce_protection_operations (
 tenant_id TEXT NOT NULL, store_id TEXT NOT NULL, id TEXT NOT NULL, resource_id TEXT NOT NULL, subject_hash TEXT NOT NULL,
 state TEXT NOT NULL, body TEXT NOT NULL, digest TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY(tenant_id,store_id,id)
) STRICT;
CREATE TABLE commerce_duty_assessments (
 tenant_id TEXT NOT NULL, store_id TEXT NOT NULL, id TEXT NOT NULL, resource_id TEXT NOT NULL, subject_hash TEXT NOT NULL,
 state TEXT NOT NULL, body TEXT NOT NULL, digest TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY(tenant_id,store_id,id)
) STRICT;
CREATE TABLE commerce_reverse_hub_routes (
 tenant_id TEXT NOT NULL, store_id TEXT NOT NULL, id TEXT NOT NULL, resource_id TEXT NOT NULL, subject_hash TEXT NOT NULL,
 state TEXT NOT NULL, body TEXT NOT NULL, digest TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY(tenant_id,store_id,id)
) STRICT;
CREATE TABLE commerce_international_handoffs (
 tenant_id TEXT NOT NULL, store_id TEXT NOT NULL, id TEXT NOT NULL, resource_id TEXT NOT NULL, subject_hash TEXT NOT NULL,
 state TEXT NOT NULL, body TEXT NOT NULL, digest TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY(tenant_id,store_id,id)
) STRICT;
CREATE TABLE commerce_hsa_fsa_eligibility (
 tenant_id TEXT NOT NULL, store_id TEXT NOT NULL, id TEXT NOT NULL, resource_id TEXT NOT NULL, subject_hash TEXT NOT NULL,
 state TEXT NOT NULL, body TEXT NOT NULL, digest TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY(tenant_id,store_id,id)
) STRICT;
CREATE TABLE commerce_network_alerts (
 tenant_id TEXT NOT NULL, store_id TEXT NOT NULL, id TEXT NOT NULL, resource_id TEXT NOT NULL, subject_hash TEXT NOT NULL,
 state TEXT NOT NULL, body TEXT NOT NULL, digest TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY(tenant_id,store_id,id)
) STRICT;
CREATE TABLE commerce_network_alert_actions (
 tenant_id TEXT NOT NULL, store_id TEXT NOT NULL, id TEXT NOT NULL, resource_id TEXT NOT NULL, subject_hash TEXT NOT NULL,
 state TEXT NOT NULL, body TEXT NOT NULL, digest TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY(tenant_id,store_id,id)
) STRICT;
CREATE INDEX commerce_partner_approvals_context ON commerce_partner_approvals(tenant_id,store_id,service,account_id,revision,state);
CREATE INDEX commerce_protection_subject ON commerce_protection_proposals(tenant_id,store_id,resource_id,subject_hash);
CREATE INDEX commerce_hsa_subject ON commerce_hsa_fsa_eligibility(tenant_id,store_id,resource_id,subject_hash);
CREATE INDEX commerce_handoff_subject ON commerce_international_handoffs(tenant_id,store_id,resource_id,subject_hash);
