CREATE TABLE commerce_warehouse_return_events (
 tenant_id TEXT NOT NULL,store_id TEXT NOT NULL,event_id TEXT NOT NULL,
 request_id TEXT NOT NULL,resource_id TEXT NOT NULL,source_identity TEXT NOT NULL,
 sequence INTEGER NOT NULL CHECK(sequence>0),body TEXT NOT NULL,digest TEXT NOT NULL,
 observed_at INTEGER NOT NULL,
 PRIMARY KEY(tenant_id,store_id,event_id),
 UNIQUE(tenant_id,store_id,request_id,source_identity,sequence)
) STRICT;
