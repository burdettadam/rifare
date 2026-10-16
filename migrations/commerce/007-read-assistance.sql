CREATE TABLE commerce_assistance_receipts (
  tenant_id TEXT NOT NULL,
  store_id TEXT NOT NULL,
  id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  body TEXT NOT NULL,
  PRIMARY KEY(tenant_id,store_id,id),
  FOREIGN KEY(tenant_id,store_id,task_id) REFERENCES commerce_context_tasks(tenant_id,store_id,id)
) STRICT;
