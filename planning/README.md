# Active development plan

This directory now distinguishes remaining work from the contracts that protect
landed behavior. Start with the [roadmap](../docs/ROADMAP.md) to choose work and
the [architecture](../docs/ARCHITECTURE.md) to find its existing implementation.

## Remaining work

There are **55 active packets**: 47 worker scopes and eight future milestone
gates. Ten worker scopes describe only an unfinished portion of landed work.
An additional **27 compact integration entries** identify real source adapters
that still need implementation; they reuse the completed local workflow owners.

| Material | Entry point |
| --- | --- |
| Active packets and integration follow-ups | [Markdown catalogue](WORKER-GOALS.md) · [Searchable HTML](WORKER-GOALS.html) |
| Individual remaining scopes | [`goals/`](goals/) |
| Remaining milestone/follow-up groups | [`milestones/`](milestones/) |
| Canonical active inputs | [`goals.json`](goals.json) · [`milestones.json`](milestones.json) |
| Current source and continuity | [Architecture](../docs/ARCHITECTURE.md) · [Current plan](../docs/PLANS.md) |
| Outstanding release evidence | [Qualification](../docs/QUALIFICATION.md) |

The former 281-packet catalogue and completed milestone descriptions are available
in Git. They are not copied into an archive in this tree. Retiring a packet means
its landed implementation instructions no longer belong in the work queue;
unfinished integrations and formal qualification remain visible.

## Retained behavioral contracts

The complete 949 [behavioral specifications](test-specifications.json), 216
[requirement mappings](requirement-coverage.json), 57
[capability targets](capability-targets.json), and [frozen source criteria](reference/)
remain alongside executable test registrations and independent oracles. They are
regression/qualification contracts, not 281 newly unstarted tasks. Their original
`not_run` and proposed fields describe specification provenance, not current
native test results.

Historical goal IDs in these contracts still resolve formal dependencies. A
dependency without an active packet has not automatically been accepted. The
[acceptance ledger](../work/accepted-goals.json), current code/evidence and actual
qualification decisions determine that status.

## Maintain the plan

Change the canonical inputs, then regenerate and check from the repository root:

```sh
python3 tools/render_plan.py --root .
python3 tools/check_generated.py --root .
python3 tools/validate_plan.py --root .
```

When work lands, remove its completed instructions from the canonical inputs and
delete its generated packet. Carry forward concrete remaining code or evidence
in a narrowed scope, an integration entry, or the qualification guide. Update the
architecture when ownership or runtime behavior changes. Generated orphan checks
catch obsolete cards; regeneration cannot restore a packet absent from the inputs.

Preserve original acceptance criteria, dependencies, executable cases, oracle
fixtures and release thresholds. Follow [development](../docs/DEVELOPMENT.md) and
[agent instructions](../AGENTS.md). Assignment and actual outcomes belong in
[work records](../work/README.md); no initial-state database or static dispatch
queue needs to be maintained.

## Assign a compact entry or qualify a retired gate

Compact integration rows are planning summaries. The existing work-goal,
workflow and evidence checks require a goal packet at their trusted base commit;
they intentionally reject a historical ID that is absent from that base's active
`goals` list. Before assigning one of these rows, or formally qualifying a retired
gate:

1. Retrieve only the selected original goal and its milestone definition from
   `d1fb45b94e14b276f7fa6e04f50173fe8cf39c77` in Git. Add a narrowed active packet
   to the current inputs with its original ID, criteria, test bindings and formal
   dependencies intact. Its instructions should describe only the remaining work.
2. Add or update the smallest milestone/follow-up group containing that packet.
   Preserve the original gate identity and exit criteria; an implementation
   follow-up may leave the historical gate outside the active group. Remove the
   selected compact row once its packet owns the same scope.
3. Regenerate views, update active counts and source membership, then review and
   commit that bounded planning assignment. Select the trusted execution/evidence
   base only after this commit includes the packet.

This promotes one useful scope, not the completed catalogue. A restored gate still
requires every original worker and predecessor dependency to be accepted. Do not
change an evidence controller or invent acceptance to bypass a missing packet.

## Retrieve a previous packet

```sh
git show d1fb45b94e14b276f7fa6e04f50173fe8cf39c77:planning/goals/M20/M20-G03.md
git show d1fb45b94e14b276f7fa6e04f50173fe8cf39c77:planning/goals.json
```

See [ADR-0065](../docs/decisions/0065-retire-landed-planning.md) for the retirement
decision. Historical work links use the immutable tree that contains their original
packet; new assignments use the active inputs above.
