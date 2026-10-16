# Read contract

The task identifies a canonical order, profile revision, and base-skill digest.
Use order.status for current typed facts and source references. Use knowledge.search
for permitted references and knowledge.get with an exact revision to refresh them.
A missing source or unavailable order is not permission to use another store.
Use skill.read with declared relative resources; never request an absolute path.
All operations use the current authenticated session. Profiles can restrict
available reads but cannot grant any new action or change tenant/store ownership.
