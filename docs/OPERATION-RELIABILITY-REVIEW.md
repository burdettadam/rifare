# Operation reliability review

Scope: M02-G13 through M02-G17, starting from `2f37872`. Prior authority is
ADR-0018 / DELEGATED-LOCAL-09. Review was performed by the same delegated assistant;
no independent reviewer identities or external qualification are asserted.

## Findings and corrections

1. Resource-level serialization was missing from the first implementation. Two
   distinct approved operations could hold claims for one resource, and a later
   operation could proceed while an earlier result was unknown. Two meaningful
   assertions in `reliability-review.test.mts` failed before correction. Claiming
   now checks earlier unfinished receipt order and active resource leases inside
   the transaction. Unknown predecessors remain blockers until reconciled.
2. Linked corrections initially validated but dropped the chosen reason code.
   The third review assertion failed. Receipts now retain the bounded reason
   alongside both original and confirming receipt references.
3. Source identity needed stronger pinning than a display name. An immutable,
   persisted synthetic journal identity is now bound to each operation and scan.
   Tests substitute a different journal with the same name and reject confirmation,
   retry and checkpoint resumption. This is a local adapter integrity contract,
   not authentication of a production provider.

Pagination fixtures for the new tests use independent resources to demonstrate
independent progress without evading the resource-conflict invariant. Existing
retained tests and fixtures were not changed. New source-count entries are the
explicit structural extension already allowed by the baseline; no financial,
policy, timing or denominator oracle is weakened.

## Security and regression review

- Approved local effects and outgoing work share the gateway transaction. Alias
  binding cannot authorize another command or amount. Agents cannot dispatch or
  process inbound events; only permitted integration/operator roles can do so.
- Quarantined/unsigned-tenant events remain unusable. Current permission and store
  state are checked under the write transaction. Source versions and terminal
  state constraints prevent stale reopening.
- Unknown results do not retry. Lease fencing protects finalization. Reconciliation
  reads the pinned synthetic source and never calls its effect method. All pages
  advance checkpoints only with committed state/receipts.
- Append-only receipts exclude customer note bodies and subject mappings. Logical
  erasure and original-outcome preservation are tested separately. No absolute
  forensic-erasure or malicious-database-administrator protection is claimed.
- No dependency, agent framework, scheduler, model call, live provider, production
  action, publication or release is introduced. HTTP additions only inspect state
  or bind a request alias to an already executed gateway receipt.

Actual full-suite commands/counts, deliberately broken temporary candidates,
source/registry preservation, candidate commits and restoration runs are retained
in the separate verification and evidence packages. Test success is diagnostic
qualification, not full M02 or PostgreSQL/React acceptance. The local implementation
may be merged after passing the retained controller; no production release decision
is made by this record.
