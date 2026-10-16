CREATE TABLE commerce_policy_versions (
 tenant_id TEXT NOT NULL, store_id TEXT NOT NULL, policy_id TEXT NOT NULL, version INTEGER NOT NULL,
 body TEXT NOT NULL CHECK(json_valid(body)), digest TEXT NOT NULL, author TEXT NOT NULL,
 state TEXT NOT NULL CHECK(state IN ('draft','tested','reviewed','published','revoked')),
 test_digest TEXT, reviewer TEXT, reviewer_revision INTEGER, effective_at INTEGER, created_at INTEGER NOT NULL,
 PRIMARY KEY(tenant_id,store_id,policy_id,version),
 FOREIGN KEY(tenant_id,store_id) REFERENCES commerce_stores(tenant_id,store_id)
) STRICT;
CREATE UNIQUE INDEX commerce_policy_activation ON commerce_policy_versions(tenant_id,store_id,policy_id,effective_at) WHERE effective_at IS NOT NULL;
CREATE TABLE commerce_policy_pins (
 tenant_id TEXT NOT NULL, store_id TEXT NOT NULL, id TEXT NOT NULL, policy_id TEXT NOT NULL, version INTEGER NOT NULL,
 mode TEXT NOT NULL, facts TEXT NOT NULL CHECK(json_valid(facts)), author TEXT NOT NULL,
 PRIMARY KEY(tenant_id,store_id,id),
 FOREIGN KEY(tenant_id,store_id,policy_id,version) REFERENCES commerce_policy_versions(tenant_id,store_id,policy_id,version)
) STRICT;
CREATE TABLE commerce_configuration_drafts (
 tenant_id TEXT NOT NULL, store_id TEXT NOT NULL, id TEXT NOT NULL, revision INTEGER NOT NULL,
 body TEXT NOT NULL CHECK(json_valid(body)), history TEXT NOT NULL CHECK(json_valid(history)),
 actor TEXT NOT NULL, simulation_digest TEXT, request_digest TEXT,
 PRIMARY KEY(tenant_id,store_id,id),
 FOREIGN KEY(tenant_id,store_id) REFERENCES commerce_stores(tenant_id,store_id)
) STRICT;
CREATE TABLE commerce_skill_approvals (
 tenant_id TEXT NOT NULL, store_id TEXT NOT NULL, id TEXT NOT NULL, origin TEXT NOT NULL,
 bundle_digest TEXT NOT NULL, skill_id TEXT NOT NULL, version TEXT NOT NULL, expires_at INTEGER NOT NULL,
 approver TEXT NOT NULL, revoked INTEGER NOT NULL DEFAULT 0 CHECK(revoked IN (0,1)),
 PRIMARY KEY(tenant_id,store_id,id),
 FOREIGN KEY(tenant_id,store_id) REFERENCES commerce_stores(tenant_id,store_id)
) STRICT;
CREATE TABLE commerce_skill_installations (
 tenant_id TEXT NOT NULL, store_id TEXT NOT NULL, skill_id TEXT NOT NULL, approval_id TEXT NOT NULL, bundle_digest TEXT NOT NULL,
 PRIMARY KEY(tenant_id,store_id,skill_id),
 FOREIGN KEY(tenant_id,store_id,approval_id) REFERENCES commerce_skill_approvals(tenant_id,store_id,id)
) STRICT;
