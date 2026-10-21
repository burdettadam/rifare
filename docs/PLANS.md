# Current development plan

The current source includes the bounded local **M20-G03 item-level drop-off
handoff** implementation. Start with the [architecture](ARCHITECTURE.md) for
existing modules and [roadmap](ROADMAP.md) for remaining work.

## Next commerce increment

**M20-G04: consolidation and custody continuity**, followed by **M20-G05: shopper
drop-off experience**, is the next recorded commerce direction. Reuse the current
handoff and custody owners. Preserve original units, partial acceptance,
corrections, disputes and the separation between custody, receipt, inspection,
stock and settlement. The [M20 record](../work/records/M20-dropoff-milestone.md)
contains the latest source/review checkpoint and exact limits.

This is a continuation point, not an automatic assignment. The owner's current
request covers planning cleanup and portfolio presentation. Product implementation
requires its own bounded scope and evidence.

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
   follow-ups. Inspect the current code, native contracts and tests first.
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
