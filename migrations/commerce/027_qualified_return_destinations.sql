-- Additive routing history; native carrier and capacity effects remain in the separate fixture source.
CREATE TABLE commerce_destination_policies (
 tenant_id TEXT NOT NULL,store_id TEXT NOT NULL,revision INTEGER NOT NULL CHECK(revision>0),
 body TEXT NOT NULL CHECK(json_valid(body)),digest TEXT NOT NULL,
 PRIMARY KEY(tenant_id,store_id,revision)
) STRICT;
CREATE TABLE commerce_destination_bindings (
 tenant_id TEXT NOT NULL,store_id TEXT NOT NULL,request_id TEXT NOT NULL,
 case_id TEXT NOT NULL,resource_id TEXT NOT NULL,revision INTEGER NOT NULL CHECK(revision>0),
 source_identity TEXT NOT NULL,body TEXT NOT NULL CHECK(json_valid(body)),digest TEXT NOT NULL,observed_at INTEGER NOT NULL,
 PRIMARY KEY(tenant_id,store_id,request_id,revision)
) STRICT;
CREATE TABLE commerce_destination_selections (
 tenant_id TEXT NOT NULL,store_id TEXT NOT NULL,request_id TEXT NOT NULL,
 case_id TEXT NOT NULL,resource_id TEXT NOT NULL,revision INTEGER NOT NULL CHECK(revision>0),
 source_identity TEXT NOT NULL,body TEXT NOT NULL CHECK(json_valid(body)),digest TEXT NOT NULL,observed_at INTEGER NOT NULL,
 PRIMARY KEY(tenant_id,store_id,request_id,revision)
) STRICT;
