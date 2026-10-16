CREATE TABLE dev_markers (
    id TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    created_at INTEGER NOT NULL
) STRICT;
CREATE TABLE dev_jobs (
    id TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    state TEXT NOT NULL CHECK (state IN ('pending','running','completed','failed')),
    lease_owner TEXT,
    lease_until INTEGER NOT NULL DEFAULT 0,
    attempts INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    completed_at INTEGER,
    failure_code TEXT
) STRICT;
CREATE INDEX dev_jobs_ready ON dev_jobs(state, lease_until, created_at);
CREATE TABLE dev_heartbeat (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    updated_at INTEGER NOT NULL
) STRICT;
