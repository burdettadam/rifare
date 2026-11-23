# COMMERCE-ENGINE-02 - Standalone native Admin delivery

State: assigned; qualification pending.
Contract: [ADR-0089](../../docs/decisions/0089-standalone-admin-delivery.md).
Base: `5aa050e9ccdf8b8156c2e0455605ef4011a5d633`.
Branch: `feat/medusa-standalone-admin`; root writer/integration owner.

Rifare has one active primary and zero linked checkouts; root resumes it without
creating another checkout. The earlier standalone branch is an ancestor of canonical
development and its PR5 work is already integrated. PR9 is verified merged; its full
tree matches published b0d3cfb. C10 runtime and compiler output are absent after fresh
Windows gates and 88,799 DELETE/share probes, with source/cache/configuration/refs and
raw evidence preserved. Removed allocated file bytes were 563,001,512; Windows host
free space rose 343,678,976 under concurrent unrelated activity. All task DBs stopped.

The previous goal turn made authoritative progress through reviewed PR9 integration
and verified retirement. The broad handoff objective remains active. This assignment
advances actual native operator delivery while external provider endpoints, account
link and custody remain unavailable; it duplicates no other worker's deployment.

Existing source node_modules remain reusable. No compatible standalone runtime is
retained from C10. Initial host C free space is recorded by the qualification owner
before build/runtime allocation. Generated types remain inspected and preserved;
no unrelated cache or user configuration is deleted.

Next: inspect upstream build/static serving and run the actual Admin-enabled build,
then reproduce standalone browser behavior and fix demonstrated delivery gaps. Root
owns the checkout; independent roles will review fixed source and actual evidence.

## Exploratory evidence and prior implementation decision

The first Admin-enabled build and own-dependency runtime served the normal login and
operator pages. A filesystem regression first showed two positive build controls pass
while enabled missing-index/missing-entry/path cases incorrectly advertised a runtime.
The builder now validates the compiled configuration and referenced local entry assets;
five new and eight retained configuration cases pass. Its first compiled-config read
used the source CWD and failed custom-module resolution; the corrected builder loads
the normal source environment, reads config from compiled CWD and restores CWD.

The initial test-profile Admin emitted React development code. Selecting production
React alone produced a genuine `jsxDEV is not a function` browser failure; production
JSX in Vite8 OXC must match that runtime. Both observations remain failures, not passes.
With both selected, the login works but create-product still has two hidden dialogs.
Source inspection demonstrates separate native table and LayoutComposer Outlets.
The root maintainer adopted the narrowly pinned compatibility correction in ADR0089
before implementing it. It does not substitute a custom commerce UI or weaken the
unchanged single-accessible-dialog requirement. Other workers' deployments stay intact.

The owned runtime keeps the two failed generated Admin bundles outside its served
public tree for review; both are task-owned rebuildable data and retire with this
runtime. PostgreSQL and the loopback backend are task-owned and currently active.
No exact-candidate or completed browser qualification is claimed yet.
