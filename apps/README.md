# Rifare development applications

`api/`, `worker/` and `web/` run as separate owned processes from one codebase.
Only the explicitly selected `smoke-sqlite` diagnostic profile is executable at
this checkpoint. It processes synthetic markers, not orders, refunds or customers.

The web diagnostic is a plain browser shell, **not a React implementation**.
The PostgreSQL/React target stack is still blocked on dependency installation and
connected qualification; `npm run dev` exits nonzero rather than falling back.
See [development instructions](../docs/LOCAL-ENVIRONMENT.md).
