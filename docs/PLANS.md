# Current development plan

The current source includes the bounded local **M20-G03 item-level drop-off
handoff** implementation. Start with the [architecture](ARCHITECTURE.md) for
existing modules and [roadmap](ROADMAP.md) for remaining work.

## Current assigned increment

The owner assigned **RCG-5C customer checkout review** under
[ADR-0073](decisions/0073-customer-checkout-review.md), extending the reviewed
RCG-5B original preparation recovery. The local `/checkout-review` page uses the
unchanged native API to review an existing proposal, prepare once, recover an
uncertain original request, observe history and cancel by observed revision.
[The guide](DELEGATED-CHECKOUT-REVIEW.md) and [work record](../work/records/RCG-5C.md)
keep native/controller evidence separate from actual served-browser execution.

The existing authorized AWS development host has now executed all nine served
Chromium cases successfully on candidate `3db6507`, within the unchanged
60-second budget. This follows three lifecycle and 21 HTTP/controller passes.
The actual browser run exposed a test wait-expression defect; equivalent function
predicates resolve it without changing the application or its security policy.
The [work record](../work/records/RCG-5C.md) binds the passing run and retained
earlier failures. Refresh independent source/evidence review and the Codex
handoff before broadening the customer flow. This is local plain-browser/SQLite
evidence, not target React/PostgreSQL or full RCG-5 qualification.

The last provider inspection lacked published delegated final-use and
uncertain-outcome transports; this UI assignment does not refresh that external
observation or supply a transport. Provider execution (RCG-4B), the full isolated
Rifare/ElevenID/merchant journey (RCG-5), canonical criteria and formal acceptance
remain open. Recovery absence never authorizes replacement preparation.

## Continuing commerce roadmap

**M20-G04: consolidation and custody continuity**, followed by **M20-G05: shopper
drop-off experience**, is the next recorded commerce direction. Reuse the current
handoff and custody owners. Preserve original units, partial acceptance,
corrections, disputes and the separation between custody, receipt, inspection,
stock and settlement. The [M20 record](../work/records/M20-dropoff-milestone.md)
contains the latest source/review checkpoint and exact limits.

This remains a roadmap continuation point rather than an automatic assignment.
It is separate from the newly authorized checkout-preparation slice above.

## Other open work

The [active catalogue](../planning/WORKER-GOALS.md) contains 55 remaining packets:
47 worker scopes and eight future integration gates. Ten packets are narrowed to
unfinished portions of existing work. The same catalogue carries 27 concise
connected-adapter follow-ups; their local workflow owners already exist.

Priority alternatives include completing loyalty attribution/reconciliation,
building the actual target application, and implementing a chosen real provider
adapter. M15/M16 source is missing from recovered history; M21–M25 remain future
implementation. See the [roadmap](ROADMAP.md) before selecting a lane.

[Remaining qualification](QUALIFICATION.md) records actual provider, model,
physical, deployment, independent-user and pilot obligations. Retired milestone
packets do not close those obligations. Formal dependency IDs and the
[acceptance ledger](../work/accepted-goals.json) retain their meaning.

## Continue without replaying completed work

1. Read the current architecture and the relevant domain guide.
2. Select a bounded remaining scope from the active catalogue or integration
   follow-ups. Inspect the current code, native contracts and tests first. Before
   assigning a compact entry, [promote just that entry](../planning/README.md#assign-a-compact-entry-or-qualify-a-retired-gate)
   to an active packet and commit the planning assignment so evidence checks can
   resolve it at their trusted base.
3. Record assignment, candidate, focused verification and independent reviews in
   an ordinary work record. Use [development commands](DEVELOPMENT.md).
4. Once a local implementation lands, remove its completed instructions from the
   active inputs. Carry any real code gap or qualification obligation forward
   concisely, then regenerate the views.

## Earlier plans

The chronological development diary and complete former goal catalogue are in
Git, with their underlying decisions and work records. Do not copy them into a
new completed-work archive.

```sh
git show d1fb45b94e14b276f7fa6e04f50173fe8cf39c77:docs/PLANS.md
git show d1fb45b94e14b276f7fa6e04f50173fe8cf39c77:planning/goals/M20/M20-G03.md
git log --all -- packages/commerce/dropoff-handoffs.mts
```

[ADR-0065](decisions/0065-retire-landed-planning.md) records the cleanup decision.
