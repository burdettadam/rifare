CREATE TABLE commerce_edit_workflow_pins (
 tenant_id TEXT NOT NULL, store_id TEXT NOT NULL, case_id TEXT NOT NULL,
 body TEXT NOT NULL,digest TEXT NOT NULL,PRIMARY KEY(tenant_id,store_id,case_id)
);
