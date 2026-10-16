CREATE TABLE commerce_skill_archive (
 tenant_id TEXT NOT NULL, store_id TEXT NOT NULL, skill_id TEXT NOT NULL, bundle_digest TEXT NOT NULL,
 bundle TEXT NOT NULL CHECK(json_valid(bundle)), approval_id TEXT,
 PRIMARY KEY(tenant_id,store_id,skill_id,bundle_digest),
 FOREIGN KEY(tenant_id,store_id) REFERENCES commerce_stores(tenant_id,store_id)
) STRICT;
INSERT INTO commerce_skill_archive SELECT s.tenant_id,s.store_id,s.id,s.bundle_digest,s.bundle,i.approval_id
 FROM commerce_skills s LEFT JOIN commerce_skill_installations i
 ON s.tenant_id=i.tenant_id AND s.store_id=i.store_id AND s.id=i.skill_id;
CREATE TABLE commerce_skill_revocations (
 tenant_id TEXT NOT NULL, store_id TEXT NOT NULL, skill_id TEXT NOT NULL, bundle_digest TEXT NOT NULL,
 actor_id TEXT NOT NULL, revoked_at INTEGER NOT NULL,
 PRIMARY KEY(tenant_id,store_id,skill_id,bundle_digest)
) STRICT;
CREATE TABLE commerce_skill_releases (
 tenant_id TEXT NOT NULL, store_id TEXT NOT NULL, id TEXT NOT NULL, skill_id TEXT NOT NULL, bundle_digest TEXT NOT NULL,
 rollout_percent INTEGER NOT NULL CHECK(rollout_percent BETWEEN 1 AND 100), author TEXT NOT NULL,
 state TEXT NOT NULL CHECK(state IN ('draft','evaluated','reviewed','published')),
 test_digest TEXT, reviewer TEXT, reviewer_revision INTEGER, created_at INTEGER NOT NULL,
 PRIMARY KEY(tenant_id,store_id,id),
 FOREIGN KEY(tenant_id,store_id,skill_id,bundle_digest) REFERENCES commerce_skill_archive(tenant_id,store_id,skill_id,bundle_digest)
) STRICT;
CREATE TABLE commerce_skill_activation (
 tenant_id TEXT NOT NULL, store_id TEXT NOT NULL, skill_id TEXT NOT NULL, revision INTEGER NOT NULL,
 release_id TEXT NOT NULL, fallback_id TEXT,
 PRIMARY KEY(tenant_id,store_id,skill_id),
 FOREIGN KEY(tenant_id,store_id,release_id) REFERENCES commerce_skill_releases(tenant_id,store_id,id)
) STRICT;
CREATE TABLE commerce_skill_activation_log (
 tenant_id TEXT NOT NULL, store_id TEXT NOT NULL, skill_id TEXT NOT NULL, revision INTEGER NOT NULL,
 release_id TEXT NOT NULL, fallback_id TEXT, operation TEXT NOT NULL, actor TEXT NOT NULL, created_at INTEGER NOT NULL,
 PRIMARY KEY(tenant_id,store_id,skill_id,revision)
) STRICT;
CREATE TABLE commerce_cases (
 tenant_id TEXT NOT NULL, store_id TEXT NOT NULL, id TEXT NOT NULL, revision INTEGER NOT NULL,
 resource_id TEXT NOT NULL, customer_id TEXT NOT NULL, verification_hash TEXT, author TEXT NOT NULL,
 PRIMARY KEY(tenant_id,store_id,id),
 FOREIGN KEY(tenant_id,store_id,resource_id) REFERENCES commerce_resources(tenant_id,store_id,id)
) STRICT;
CREATE TABLE commerce_case_configurations (
 tenant_id TEXT NOT NULL, store_id TEXT NOT NULL, case_id TEXT NOT NULL, revision INTEGER NOT NULL,
 body TEXT NOT NULL CHECK(json_valid(body)), digest TEXT NOT NULL, reason TEXT NOT NULL, actor TEXT NOT NULL, created_at INTEGER NOT NULL,
 PRIMARY KEY(tenant_id,store_id,case_id,revision),
 FOREIGN KEY(tenant_id,store_id,case_id) REFERENCES commerce_cases(tenant_id,store_id,id)
) STRICT;
CREATE TABLE commerce_execution_settings (
 tenant_id TEXT NOT NULL, store_id TEXT NOT NULL, enabled INTEGER NOT NULL CHECK(enabled IN (0,1)), revision INTEGER NOT NULL,
 profile_id TEXT NOT NULL, policy_id TEXT NOT NULL,
 PRIMARY KEY(tenant_id,store_id), FOREIGN KEY(tenant_id,store_id) REFERENCES commerce_stores(tenant_id,store_id)
) STRICT;
CREATE TABLE commerce_action_previews (
 tenant_id TEXT NOT NULL, store_id TEXT NOT NULL, id TEXT NOT NULL, case_id TEXT NOT NULL,
 body TEXT NOT NULL CHECK(json_valid(body)), digest TEXT NOT NULL, proposer TEXT NOT NULL,
 PRIMARY KEY(tenant_id,store_id,id), FOREIGN KEY(tenant_id,store_id,case_id) REFERENCES commerce_cases(tenant_id,store_id,id)
) STRICT;
CREATE TABLE commerce_action_approvals (
 tenant_id TEXT NOT NULL, store_id TEXT NOT NULL, id TEXT NOT NULL, preview_id TEXT NOT NULL, preview_digest TEXT NOT NULL,
 approver TEXT NOT NULL, authority_revision INTEGER NOT NULL, expires_at INTEGER NOT NULL,
 max_uses INTEGER NOT NULL CHECK(max_uses=1), uses INTEGER NOT NULL DEFAULT 0 CHECK(uses BETWEEN 0 AND 1),
 revoked INTEGER NOT NULL DEFAULT 0 CHECK(revoked IN (0,1)),
 PRIMARY KEY(tenant_id,store_id,id), UNIQUE(tenant_id,store_id,preview_id),
 FOREIGN KEY(tenant_id,store_id,preview_id) REFERENCES commerce_action_previews(tenant_id,store_id,id)
) STRICT;
CREATE TABLE commerce_case_effects (
 tenant_id TEXT NOT NULL, store_id TEXT NOT NULL, case_id TEXT NOT NULL, revision INTEGER NOT NULL,
 resolution TEXT NOT NULL CHECK(resolution IN ('none','refund','exchange')), amount_minor TEXT NOT NULL, currency TEXT NOT NULL,
 PRIMARY KEY(tenant_id,store_id,case_id), FOREIGN KEY(tenant_id,store_id,case_id) REFERENCES commerce_cases(tenant_id,store_id,id)
) STRICT;
CREATE TABLE commerce_action_receipts (
 tenant_id TEXT NOT NULL, store_id TEXT NOT NULL, id TEXT NOT NULL, case_id TEXT NOT NULL, preview_id TEXT NOT NULL,
 body TEXT NOT NULL CHECK(json_valid(body)), digest TEXT NOT NULL,
 PRIMARY KEY(tenant_id,store_id,id), UNIQUE(tenant_id,store_id,preview_id),
 FOREIGN KEY(tenant_id,store_id,preview_id) REFERENCES commerce_action_previews(tenant_id,store_id,id)
) STRICT;
CREATE TABLE commerce_webhook_routes (
 id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, store_id TEXT NOT NULL, provider TEXT NOT NULL,
 topic TEXT NOT NULL, shop_domain TEXT NOT NULL, api_version TEXT NOT NULL,
 key_ref TEXT NOT NULL, key_fingerprint TEXT NOT NULL, enabled INTEGER NOT NULL CHECK(enabled IN (0,1)),
 FOREIGN KEY(tenant_id,store_id) REFERENCES commerce_stores(tenant_id,store_id)
) STRICT;
CREATE TABLE commerce_webhook_inbox (
 tenant_id TEXT NOT NULL, store_id TEXT NOT NULL, id TEXT NOT NULL, route_id TEXT NOT NULL,
 delivery_id TEXT NOT NULL, body BLOB NOT NULL, sha256 TEXT NOT NULL, metadata TEXT NOT NULL CHECK(json_valid(metadata)),
 status TEXT NOT NULL CHECK(status IN ('pending','quarantined')), received_at INTEGER NOT NULL,
 PRIMARY KEY(tenant_id,store_id,id), UNIQUE(route_id,delivery_id),
 FOREIGN KEY(route_id) REFERENCES commerce_webhook_routes(id)
) STRICT;
