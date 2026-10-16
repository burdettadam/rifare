# M00 qualification and next implementation work

## Current local integration decision

The owner renewed delegation and authorized review and merging. The review in
[INTEGRATION-REVIEW.md](INTEGRATION-REVIEW.md) authorizes the accumulated diagnostic
source on `main`; separate independent review sessions were not claimed. This
removes the prior local-merge barrier, not the technical PostgreSQL/React or served
browser gaps. The sections below preserve the assessment at its earlier checkpoint.
Current integration state is in [the ledger](../work/integrations/2026-10-16.json).

## Historical assessment disposition

**M00-G99 is blocked.** This checkpoint assesses the combined M00 source; it does
not add an application feature or another acceptance framework. The governing
ledger accepts M00-G01 through M00-G04. M00-G05 through M00-G08 are implemented
only within their documented diagnostic boundaries and remain unaccepted.

The existing pinned regression/evidence controllers are reused unchanged. All
565 runnable obligations and all 676 planning scenarios are retained. No test is
added merely to make the count grow; no positive milestone case is claimed from
an expected rejection. Candidate-specific commands, native reports, controller
hashes, capture receipt and observed outcomes are in the separate evidence delivery.

## Original exit criteria

| Criterion | Evidence boundary |
| --- | --- |
| Clean checkout starts an isolated synthetic environment without production credentials or a paid agent service | Exercise the explicit smoke profile with the real API, worker, migration, UI HTTP server, queues and attachments. This is partial evidence, not PostgreSQL/React or a completed served-browser journey. |
| Scope, invariants, support envelope and licensing decisions approved | ADR-0004 records the prior delegated decisions. Do not request the same decisions again or invent new independent reviews. Public distribution remains separately gated. |
| First ten goals have owners or explicit unassigned status, dependencies and evidence criteria | The qualification work record lists the first eight M00 workers and M01-G01/M01-G02. Existing authors are recorded; future workers remain explicitly unassigned. |

The positive CASE-M00-G99-01 remains blocked. CASE-M00-G99-02 is assessed against
actual unaccepted dependencies and absent reviews. CASE-M00-G99-03 exercises the
retained assertion/registration guards and an older isolation behavior on temporary
candidates. Those demonstrations do not convert a partial milestone into a pass.

## Required closure order

1. **Resume M00-G05 target-stack work.** Implement and install the real pinned
   PostgreSQL/React target, validate migrations and two-worktree resource isolation,
   and make the documented target startup work. A zero-dependency smoke lockfile
   cannot establish target reproducibility.
2. **Complete M00-G06 connected qualification.** Test the repaired stack and the
   actual served browser journey. Component tests, mocked responses and SQLite
   remain useful regressions but cannot substitute for these results.
3. **Refresh M00-G07/M00-G08 evidence and reviews.** Retain previous checks, register
   target additions, run the combined candidate, capture exact evidence and obtain
   genuine separate authority/security and regression review. Record accepted
   prerequisites in dependency order without fabricating reviewer identities.
4. **Rerun M00-G99.** Use one integrated source/configuration and the real exit
   evidence. Do not begin M01 simply because its goal files are present.

[The machine-readable repair record](../work/qualification/M00.json) maps each gap
to its existing owning goal, required evidence and explicitly insufficient substitutes.
It is a work record, not a scheduler or an alternate acceptance ledger.

## Host qualification and observed limitations

The retained diagnostic environment uses the documented Node/Python host and the
separately installed browser tooling. On the assessment host, PostgreSQL, Docker
and Podman executables are absent; npm registry name resolution failed during an
availability probe. The target command itself is an explicit unqualified stub,
so installing host tools alone will not complete M00-G05.

A direct Chromium navigation to the real loopback UI returned
`net::ERR_BLOCKED_BY_ADMINISTRATOR`. Respect that restriction; do not disable policy
or replace the served test with an in-memory pass. Rerun the real journey on a
permitted development host. Existing component tests are still valid in their
narrow stated scope. These are observations of this host, not general product or
platform limitations.

The walkthrough here is author-performed. No independent contributor or reviewer
session, production operation, external customer workflow or paid service is claimed.

## Reproduce the available diagnostic portion

```sh
python3 tools/verify.py --runtime --harness
npm ci --offline --ignore-scripts
npm run db:migrate:smoke
npm run dev:smoke
# In a second terminal in the SAME worktree:
npm run stop:smoke
```

Read the assigned loopback UI address from the startup JSON; ports are not global.
The default target `npm run dev` currently exits 2 with
`TARGET_STACK_NOT_QUALIFIED`. That result must not be reported as a startup pass.

The separate evidence archive retains an exact-source walkthrough driver, the
pinned existing controllers, requests/receipts, fault checks and restore commands.
Use the source bundle/ZIP to recover source, not to recover runtime data or accounts.

## Preserve accumulated work when repairing

Create a new repair branch from this integrated checkpoint, not from the older
`goal/M00-G05` tip. That older tip intentionally remains preserved history and does
not contain the later harness, regression and evidence work.

```sh
git status
git worktree add ../Rifare-target-repair -b repair/M00-G05-target-stack HEAD
```

This is a proposed next assignment, not automatic dispatch. Keep all 565 retained
IDs, protected assertions, fixtures, planning contracts, authority and component
notices. Any required change to a protected oracle needs the prior reviewed process.
Do not modify the original planning snapshots merely to mark implementation done.

Main and the accepted ledger are unchanged. The assessment branch is recoverable,
not merged, released or accepted. Current status is recorded in
[the work record](../work/records/M00-G99.md).
