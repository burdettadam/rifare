# ADR-0031 — Second-platform local development and conformance

Date: 2026-10-18. Recorded before implementation of this batch.

The owner said “Continue” after delivery of the reviewed M06-G11–G14/G99 local
checkpoint. The next five worker packets are M07-G01 through M07-G05. Protected
main is `ad6c5105f3ce806230375833f69eb491a7b93d89`, tree
`15d78486b8576318ffb94e6a8eb96f764dd97225`, with 1,110 tracked source files,
2,410 registered native cases, 119 capability objects and 52 retained branch heads.

DELEGATED-LOCAL-21 assigns a bounded local development slice of these five
packets under the owner's continuing maintainer delegation. This new assignment
follows the completed ADR-0030 batch; it does not retrospectively expand that
batch. M05-G99 and M06-G99 remain formally unaccepted. Original connected-test
criteria, dependency gates and permanent scenario obligations remain unchanged.
Local fixture development is useful preparation, not formal milestone entry,
connected qualification or permission to represent a simulator as a live store.

## Writers and concrete ownership

- `/root`, sole writer on `goal/M07-first-five`, owns G03 shared lifecycle and
  notification integration, G05 reusable
  adapter conformance, API/staff UI hooks, migration 032 if needed, privacy/storage
  inventory, additive registration/capability proposals and source-count records,
  scoped documentation, decisions and integration work records.
- `/root/m07_scope`, sole writer on `goal/M07-woo-returns`, owns G01 Woo source
  facts and composed return semantics: new modules under
  `packages/adapters/woocommerce/`, the narrow existing return eligibility,
  intake-core, intake and case-configuration source/capability seams, migration
  030 if needed, Woo event normalization
  and signature/inbox hooks, new return/webhook fixtures and tests, and scoped
  return documentation and G01 work record.
- `/root/m07_runtime`, sole writer on `goal/M07-runtime-switch`, owns G04
  portable return context/actions in `worker-api.mts`, `work-leases.mts`, new
  independently implemented TypeScript and Python runtime clients, their local
  HTTP contract harness and permanent fixtures/tests, and scoped runtime
  documentation and G04 work record. Root retains server routing and existing
  support ownership; any necessary ownership seam is coordinated before writing.
- `/root/woo_finance`, sole writer on `goal/M07-woo-finance`, owns G02 financial
  source and gateway fixture contracts, the narrow existing resolution-ledger,
  refund-quotes and resolution-execution seams, migration 031 if needed, new
  independent financial ledger fixtures, permanent tests, and scoped financial
  documentation and G02 work record.

All branches derive from the protected main through this prior scope record.
The G04 writer assignment and G01 case-configuration seam were refined after
read-only interface inspection and before either affected implementation began.
Each writer uses a separate native Git worktree and isolated fixture databases,
processes and ports. Shared files have one assigned writer; interface changes
are coordinated with the integration owner before implementation. Existing
eligibility, policy, case pins, approval, receipt, money, ownership and message
pipelines remain canonical. No alternative approval engine, worker scheduler,
private runtime state authority or merchant-specific core branch is assigned.

## Required behavior and proof

Woo local RMA records retain a null native return reference. Missing delivery,
item quantities, paid allocation or source history blocks the relevant action.
A Woo refund record and a gateway effect are separate observations; manual
records remain external-settlement pending and no live settlement is inferred.
Unknown effects retain their original operation identity across retries, restarts
and runtime changes. Runtime changes fence the previous owner and preserve case
configuration and approval receipts. Notification content and its final send
check use verified financial facts. Adapter conformance checks independent source
records, exact version/scope bindings and honest support classifications.

Preserve all previous registrations, capabilities, source/test paths, oracles,
thresholds, timeouts, native branch/history objects and cumulative handoff
evidence. The original external regression controller and its protected baseline
remain unchanged. The prior licensing normalization remains limited to source
count and its reason. New registrations must use the actual native runner IDs.
The five packet faults require behavioral detection, alongside retained money,
tenant, authority, privacy, no-AI and portability invariants.

The final exact candidate must pass the complete unchanged native gate and
separate nonauthor authority/security and regression reviews. The regression
reviewer is `/root/final_regression`; a separate nonauthor session will review
authority/security. These are independent assistant sessions in the same runtime,
not external provider, merchant or human attestations. Changed candidates require
refreshed evidence and review. Authors report readiness, not self-acceptance.

No connected Woo store, gateway account, provider API version/account/scopes,
budget or endpoint authorization has been established. Fixture contract versions
will be explicit; external versions and real effects remain unqualified. No real
messages, paid/model/provider effects, production, deployment, account changes,
remote push, hosted publication or release tags are assigned. G05 publication
means preparing a reusable local fixture package in this slice. Deliver reviewed
local source, cumulative evidence, recovery artifacts and the remaining formal
qualification gaps. M07-G06 and later goals are outside this batch.
