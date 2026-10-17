-- Review assistance never writes eligibility policy. Prevention enrollment is durable;
-- explicit customer confirmation supplements the existing independent edit approval.
CREATE TABLE commerce_risk_assessments (
 tenant_id TEXT NOT NULL, store_id TEXT NOT NULL, id TEXT NOT NULL,
 case_id TEXT NOT NULL, resource_id TEXT NOT NULL, customer_id TEXT NOT NULL,
 author TEXT NOT NULL, body TEXT NOT NULL CHECK(json_valid(body)), digest TEXT NOT NULL,
 created_at INTEGER NOT NULL, PRIMARY KEY(tenant_id,store_id,id)
) STRICT;
CREATE TABLE commerce_risk_reviews (
 tenant_id TEXT NOT NULL, store_id TEXT NOT NULL, id TEXT NOT NULL,
 assessment_id TEXT NOT NULL, case_id TEXT NOT NULL, resource_id TEXT NOT NULL,
 actor_id TEXT NOT NULL, kind TEXT NOT NULL, body TEXT NOT NULL CHECK(json_valid(body)),
 digest TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY(tenant_id,store_id,id)
) STRICT;
CREATE TABLE commerce_prevention_configurations (
 tenant_id TEXT NOT NULL, store_id TEXT NOT NULL, id TEXT NOT NULL, version INTEGER NOT NULL,
 body TEXT NOT NULL CHECK(json_valid(body)), digest TEXT NOT NULL, author TEXT NOT NULL,
 reviewer TEXT, reviewer_revision INTEGER, state TEXT NOT NULL CHECK(state IN ('draft','approved')),
 created_at INTEGER NOT NULL, PRIMARY KEY(tenant_id,store_id,id,version)
) STRICT;
CREATE TABLE commerce_prevention_experiments (
 tenant_id TEXT NOT NULL, store_id TEXT NOT NULL, id TEXT NOT NULL,
 body TEXT NOT NULL CHECK(json_valid(body)), digest TEXT NOT NULL, created_at INTEGER NOT NULL,
 PRIMARY KEY(tenant_id,store_id,id)
) STRICT;
CREATE TABLE commerce_prevention_members (
 tenant_id TEXT NOT NULL, store_id TEXT NOT NULL, experiment_id TEXT NOT NULL,
 case_id TEXT NOT NULL, resource_id TEXT NOT NULL, customer_id TEXT NOT NULL,
 arm TEXT NOT NULL CHECK(arm IN ('baseline','control','treatment')),
 body TEXT NOT NULL CHECK(json_valid(body)), digest TEXT NOT NULL,
 PRIMARY KEY(tenant_id,store_id,experiment_id,resource_id), UNIQUE(tenant_id,store_id,resource_id)
) STRICT;
CREATE TABLE commerce_prevention_exposures (
 tenant_id TEXT NOT NULL, store_id TEXT NOT NULL, id TEXT NOT NULL,
 experiment_id TEXT NOT NULL, case_id TEXT NOT NULL, resource_id TEXT NOT NULL,
 customer_id TEXT NOT NULL, event_id TEXT NOT NULL,
 body TEXT NOT NULL CHECK(json_valid(body)), digest TEXT NOT NULL, created_at INTEGER NOT NULL,
 PRIMARY KEY(tenant_id,store_id,id), UNIQUE(tenant_id,store_id,resource_id),
 UNIQUE(tenant_id,store_id,event_id)
) STRICT;
CREATE TABLE commerce_prevention_previews (
 tenant_id TEXT NOT NULL, store_id TEXT NOT NULL, quote_id TEXT NOT NULL,
 case_id TEXT NOT NULL, resource_id TEXT NOT NULL, customer_id TEXT NOT NULL,
 body TEXT NOT NULL CHECK(json_valid(body)), digest TEXT NOT NULL,
 created_at INTEGER NOT NULL, PRIMARY KEY(tenant_id,store_id,quote_id)
) STRICT;
CREATE TABLE commerce_prevention_confirmations (
 tenant_id TEXT NOT NULL, store_id TEXT NOT NULL, quote_id TEXT NOT NULL,
 case_id TEXT NOT NULL, resource_id TEXT NOT NULL, customer_id TEXT NOT NULL,
 session_hash TEXT NOT NULL, body TEXT NOT NULL CHECK(json_valid(body)), digest TEXT NOT NULL,
 revoked INTEGER NOT NULL CHECK(revoked IN (0,1)), created_at INTEGER NOT NULL,
 PRIMARY KEY(tenant_id,store_id,quote_id)
) STRICT;
CREATE TABLE commerce_prevention_outcomes (
 tenant_id TEXT NOT NULL, store_id TEXT NOT NULL, experiment_id TEXT NOT NULL,
 case_id TEXT NOT NULL, resource_id TEXT NOT NULL, customer_id TEXT NOT NULL,
 source_version INTEGER NOT NULL, body TEXT NOT NULL CHECK(json_valid(body)),
 digest TEXT NOT NULL, observed_at INTEGER NOT NULL,
 PRIMARY KEY(tenant_id,store_id,experiment_id,resource_id,source_version)
) STRICT;
