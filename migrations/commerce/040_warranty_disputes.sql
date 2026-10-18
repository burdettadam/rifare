CREATE TABLE commerce_warranty_terms (
 tenant_id TEXT NOT NULL, store_id TEXT NOT NULL, id TEXT NOT NULL,
 product_id TEXT NOT NULL, version INTEGER NOT NULL,
 body TEXT NOT NULL CHECK(json_valid(body)), digest TEXT NOT NULL,
 PRIMARY KEY(tenant_id,store_id,id), UNIQUE(tenant_id,store_id,product_id,version)
) STRICT;
CREATE TABLE commerce_warranty_registrations (
 tenant_id TEXT NOT NULL, store_id TEXT NOT NULL, id TEXT NOT NULL,
 resource_id TEXT NOT NULL, customer_id TEXT NOT NULL, subject_hash TEXT NOT NULL,
 state TEXT NOT NULL, serial_hash TEXT NOT NULL, purchase_key TEXT NOT NULL,
 body TEXT NOT NULL CHECK(json_valid(body)), digest TEXT NOT NULL,
 PRIMARY KEY(tenant_id,store_id,id), UNIQUE(tenant_id,store_id,serial_hash), UNIQUE(tenant_id,store_id,purchase_key)
) STRICT;
CREATE TABLE commerce_warranty_claims (
 tenant_id TEXT NOT NULL, store_id TEXT NOT NULL, id TEXT NOT NULL,
 resource_id TEXT NOT NULL, customer_id TEXT NOT NULL, subject_hash TEXT NOT NULL,
 state TEXT NOT NULL, approval_id TEXT, operation_id TEXT NOT NULL,
 body TEXT NOT NULL CHECK(json_valid(body)), digest TEXT NOT NULL,
 PRIMARY KEY(tenant_id,store_id,id)
) STRICT;
CREATE TABLE commerce_warranty_entitlements (
 tenant_id TEXT NOT NULL, store_id TEXT NOT NULL, id TEXT NOT NULL,
 resource_id TEXT NOT NULL, customer_id TEXT NOT NULL, subject_hash TEXT NOT NULL,
 claim_id TEXT NOT NULL, state TEXT NOT NULL,
 body TEXT NOT NULL CHECK(json_valid(body)), digest TEXT NOT NULL,
 PRIMARY KEY(tenant_id,store_id,id)
) STRICT;
CREATE TABLE commerce_shipping_claims (
 tenant_id TEXT NOT NULL, store_id TEXT NOT NULL, id TEXT NOT NULL,
 resource_id TEXT NOT NULL, customer_id TEXT NOT NULL, subject_hash TEXT NOT NULL,
 state TEXT NOT NULL, approval_id TEXT, operation_id TEXT, business_key TEXT NOT NULL,
 body TEXT NOT NULL CHECK(json_valid(body)), digest TEXT NOT NULL,
 PRIMARY KEY(tenant_id,store_id,id), UNIQUE(tenant_id,store_id,business_key)
) STRICT;
CREATE TABLE commerce_dispute_packets (
 tenant_id TEXT NOT NULL, store_id TEXT NOT NULL, id TEXT NOT NULL,
 resource_id TEXT NOT NULL, customer_id TEXT NOT NULL, subject_hash TEXT NOT NULL,
 state TEXT NOT NULL, revision INTEGER NOT NULL,
 body TEXT NOT NULL CHECK(json_valid(body)), digest TEXT NOT NULL,
 PRIMARY KEY(tenant_id,store_id,id)
) STRICT;
CREATE TABLE commerce_claim_approvals (
 tenant_id TEXT NOT NULL, store_id TEXT NOT NULL, id TEXT NOT NULL,
 resource_id TEXT NOT NULL, customer_id TEXT NOT NULL, subject_hash TEXT NOT NULL,
 state TEXT NOT NULL, target_kind TEXT NOT NULL, target_id TEXT NOT NULL,
 body TEXT NOT NULL CHECK(json_valid(body)), digest TEXT NOT NULL,
 PRIMARY KEY(tenant_id,store_id,id)
) STRICT;
CREATE TABLE commerce_claim_submissions (
 tenant_id TEXT NOT NULL, store_id TEXT NOT NULL, id TEXT NOT NULL,
 resource_id TEXT NOT NULL, customer_id TEXT NOT NULL, subject_hash TEXT NOT NULL,
 state TEXT NOT NULL, kind TEXT NOT NULL, target_id TEXT NOT NULL, business_key TEXT NOT NULL,
 native_id TEXT, body TEXT NOT NULL CHECK(json_valid(body)), digest TEXT NOT NULL,
 PRIMARY KEY(tenant_id,store_id,id), UNIQUE(tenant_id,store_id,kind,business_key)
) STRICT;
CREATE TABLE commerce_claim_observations (
 tenant_id TEXT NOT NULL, store_id TEXT NOT NULL, id TEXT NOT NULL,
 resource_id TEXT NOT NULL, customer_id TEXT NOT NULL, subject_hash TEXT NOT NULL,
 state TEXT NOT NULL, target_kind TEXT NOT NULL, target_id TEXT NOT NULL, operation_id TEXT NOT NULL,
 body TEXT NOT NULL CHECK(json_valid(body)), digest TEXT NOT NULL,
 PRIMARY KEY(tenant_id,store_id,id)
) STRICT;
CREATE INDEX commerce_claim_submissions_subject ON commerce_claim_submissions(tenant_id,store_id,resource_id,kind,state);
CREATE INDEX commerce_claim_approvals_target ON commerce_claim_approvals(tenant_id,store_id,target_kind,target_id,state);
