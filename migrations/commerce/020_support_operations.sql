CREATE TABLE commerce_support_links (
 tenant_id TEXT NOT NULL, store_id TEXT NOT NULL, id TEXT NOT NULL, case_id TEXT NOT NULL,
 resource_id TEXT NOT NULL, customer_id TEXT NOT NULL, channel TEXT NOT NULL,
 account_id TEXT NOT NULL, external_id TEXT NOT NULL, history TEXT NOT NULL,
 source_revision INTEGER NOT NULL, verified_at INTEGER NOT NULL, erased INTEGER NOT NULL DEFAULT 0,
 PRIMARY KEY(tenant_id,store_id,id), UNIQUE(tenant_id,store_id,channel,account_id,external_id),
 FOREIGN KEY(tenant_id,store_id,case_id) REFERENCES commerce_cases(tenant_id,store_id,id)
) STRICT;
CREATE TABLE commerce_support_messages (
 tenant_id TEXT NOT NULL,store_id TEXT NOT NULL,id TEXT NOT NULL,case_id TEXT NOT NULL,resource_id TEXT NOT NULL,
 link_id TEXT NOT NULL,external_id TEXT NOT NULL,direction TEXT NOT NULL,visibility TEXT NOT NULL,
 body TEXT NOT NULL,digest TEXT NOT NULL,source_at INTEGER NOT NULL,observed_at INTEGER NOT NULL,
 erased INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(tenant_id,store_id,id),UNIQUE(tenant_id,store_id,link_id,external_id),
 FOREIGN KEY(tenant_id,store_id,link_id) REFERENCES commerce_support_links(tenant_id,store_id,id)
) STRICT;
CREATE TABLE commerce_support_ownership (
 tenant_id TEXT NOT NULL,store_id TEXT NOT NULL,case_id TEXT NOT NULL,resource_id TEXT NOT NULL,
 generation INTEGER NOT NULL,owner TEXT NOT NULL,mode TEXT NOT NULL,changed_at INTEGER NOT NULL,
 PRIMARY KEY(tenant_id,store_id,case_id),FOREIGN KEY(tenant_id,store_id,case_id) REFERENCES commerce_cases(tenant_id,store_id,id)
) STRICT;
CREATE TABLE commerce_support_events (
 seq INTEGER PRIMARY KEY,tenant_id TEXT NOT NULL,store_id TEXT NOT NULL,case_id TEXT NOT NULL,
 code TEXT NOT NULL,actor_id TEXT NOT NULL,generation INTEGER NOT NULL,ref TEXT NOT NULL,at INTEGER NOT NULL
) STRICT;
CREATE TABLE commerce_support_documents (
 tenant_id TEXT NOT NULL,store_id TEXT NOT NULL,kind TEXT NOT NULL,id TEXT NOT NULL,version INTEGER NOT NULL,
 body TEXT NOT NULL,digest TEXT NOT NULL,author TEXT NOT NULL,state TEXT NOT NULL,
 reviewer TEXT,review_digest TEXT,created_at INTEGER NOT NULL,expires_at INTEGER,
 PRIMARY KEY(tenant_id,store_id,kind,id,version)
) STRICT;
CREATE TABLE commerce_support_contacts (
 tenant_id TEXT NOT NULL,store_id TEXT NOT NULL,link_id TEXT NOT NULL,channel TEXT NOT NULL,address TEXT,
 address_digest TEXT NOT NULL,revision INTEGER NOT NULL,verified_at INTEGER NOT NULL,erased INTEGER NOT NULL DEFAULT 0,
 PRIMARY KEY(tenant_id,store_id,link_id)
) STRICT;
CREATE TABLE commerce_support_consent (
 tenant_id TEXT NOT NULL,store_id TEXT NOT NULL,customer_id TEXT NOT NULL,sender_id TEXT NOT NULL,
 channel TEXT NOT NULL,purpose TEXT NOT NULL,state TEXT NOT NULL,source_id TEXT NOT NULL,
 source_version INTEGER NOT NULL,effective_at INTEGER NOT NULL,observed_at INTEGER NOT NULL,digest TEXT NOT NULL,
 PRIMARY KEY(tenant_id,store_id,customer_id,sender_id,channel,purpose)
) STRICT;
CREATE TABLE commerce_support_consent_events (
 tenant_id TEXT NOT NULL,store_id TEXT NOT NULL,id TEXT NOT NULL,customer_id TEXT NOT NULL,
 body TEXT NOT NULL,digest TEXT NOT NULL,observed_at INTEGER NOT NULL,PRIMARY KEY(tenant_id,store_id,id)
) STRICT;
CREATE TABLE commerce_support_deliveries (
 tenant_id TEXT NOT NULL,store_id TEXT NOT NULL,operation_id TEXT NOT NULL,case_id TEXT NOT NULL,resource_id TEXT NOT NULL,
 link_id TEXT NOT NULL,kind TEXT NOT NULL,purpose TEXT NOT NULL,channel TEXT NOT NULL,sender_id TEXT NOT NULL,
 source_identity TEXT NOT NULL,source_contract TEXT NOT NULL,account_id TEXT NOT NULL,sender_revision INTEGER NOT NULL,
 generation INTEGER NOT NULL,owner TEXT NOT NULL,owner_session_hash TEXT NOT NULL,
 body TEXT NOT NULL,digest TEXT NOT NULL,created_at INTEGER NOT NULL,expires_at INTEGER NOT NULL,
 observation TEXT,observation_digest TEXT,erased INTEGER NOT NULL DEFAULT 0,
 PRIMARY KEY(tenant_id,store_id,operation_id)
) STRICT;
CREATE TABLE commerce_support_delivery_events (
 tenant_id TEXT NOT NULL,store_id TEXT NOT NULL,id TEXT NOT NULL,operation_id TEXT NOT NULL,
 version INTEGER NOT NULL,body TEXT NOT NULL,digest TEXT NOT NULL,observed_at INTEGER NOT NULL,
 PRIMARY KEY(tenant_id,store_id,id)
) STRICT;
CREATE TABLE commerce_support_rule_jobs (
 tenant_id TEXT NOT NULL,store_id TEXT NOT NULL,id TEXT NOT NULL,case_id TEXT NOT NULL,resource_id TEXT NOT NULL,
 rule_id TEXT NOT NULL,version INTEGER NOT NULL,rule_digest TEXT NOT NULL,event_id TEXT NOT NULL,
 event_body TEXT NOT NULL,generation INTEGER NOT NULL,due_at INTEGER NOT NULL,state TEXT NOT NULL,result TEXT,
 PRIMARY KEY(tenant_id,store_id,id),UNIQUE(tenant_id,store_id,rule_id,event_id)
) STRICT;
CREATE TABLE commerce_model_budgets (
 tenant_id TEXT NOT NULL,store_id TEXT NOT NULL,provider_id TEXT NOT NULL,period_id TEXT NOT NULL,
 starts_at INTEGER NOT NULL,ends_at INTEGER NOT NULL,limit_micro TEXT NOT NULL,input_micro TEXT NOT NULL,output_micro TEXT NOT NULL,
 max_input_bytes INTEGER NOT NULL,max_output_tokens INTEGER NOT NULL,revision INTEGER NOT NULL,
 PRIMARY KEY(tenant_id,store_id,provider_id,period_id)
) STRICT;
CREATE TABLE commerce_model_reservations (
 tenant_id TEXT NOT NULL,store_id TEXT NOT NULL,id TEXT NOT NULL,provider_id TEXT NOT NULL,period_id TEXT NOT NULL,
 request_digest TEXT NOT NULL,maximum_micro TEXT NOT NULL,state TEXT NOT NULL,charged_micro TEXT,
 input_micro TEXT NOT NULL,output_micro TEXT NOT NULL,usage_digest TEXT,owner_actor TEXT NOT NULL,owner_session_hash TEXT NOT NULL,created_at INTEGER NOT NULL,
 PRIMARY KEY(tenant_id,store_id,id)
) STRICT;
CREATE TABLE commerce_model_circuits (
 tenant_id TEXT NOT NULL,store_id TEXT NOT NULL,configuration_id TEXT NOT NULL,failures INTEGER NOT NULL,
 open_until INTEGER NOT NULL,PRIMARY KEY(tenant_id,store_id,configuration_id)
) STRICT;
CREATE TABLE commerce_support_attempts (
 tenant_id TEXT NOT NULL,store_id TEXT NOT NULL,id TEXT NOT NULL,case_id TEXT NOT NULL,resource_id TEXT NOT NULL,
 generation INTEGER NOT NULL,body TEXT NOT NULL,digest TEXT NOT NULL,at INTEGER NOT NULL,erased INTEGER NOT NULL DEFAULT 0,
 PRIMARY KEY(tenant_id,store_id,id)
) STRICT;
CREATE TABLE commerce_support_costs (
 tenant_id TEXT NOT NULL,store_id TEXT NOT NULL,id TEXT NOT NULL,case_id TEXT NOT NULL,resource_id TEXT NOT NULL,
 category TEXT NOT NULL,currency TEXT NOT NULL,amount_minor TEXT,source_ref TEXT NOT NULL,adjustment_of TEXT,
 body TEXT NOT NULL,digest TEXT NOT NULL,at INTEGER NOT NULL,PRIMARY KEY(tenant_id,store_id,id)
) STRICT;
CREATE TABLE commerce_support_completions (
 tenant_id TEXT NOT NULL,store_id TEXT NOT NULL,id TEXT NOT NULL,case_id TEXT NOT NULL,resource_id TEXT NOT NULL,
 kind TEXT NOT NULL,body TEXT NOT NULL,digest TEXT NOT NULL,at INTEGER NOT NULL,
 PRIMARY KEY(tenant_id,store_id,id)
) STRICT;
CREATE INDEX support_case_messages ON commerce_support_messages(tenant_id,store_id,case_id,source_at,id);
CREATE INDEX support_resource_ownership ON commerce_support_ownership(tenant_id,store_id,resource_id);
CREATE INDEX support_case_events ON commerce_support_events(tenant_id,store_id,case_id,seq);
CREATE TRIGGER support_costs_no_update BEFORE UPDATE ON commerce_support_costs BEGIN SELECT RAISE(ABORT,'APPEND_ONLY'); END;
CREATE TRIGGER support_costs_no_delete BEFORE DELETE ON commerce_support_costs BEGIN SELECT RAISE(ABORT,'APPEND_ONLY'); END;
CREATE TRIGGER support_events_no_update BEFORE UPDATE ON commerce_support_events BEGIN SELECT RAISE(ABORT,'APPEND_ONLY'); END;
CREATE TRIGGER support_events_no_delete BEFORE DELETE ON commerce_support_events BEGIN SELECT RAISE(ABORT,'APPEND_ONLY'); END;
CREATE TABLE commerce_customer_proof_bindings (
 token_hash TEXT PRIMARY KEY,customer_resource_id TEXT NOT NULL,owner_hash TEXT NOT NULL
) STRICT;
