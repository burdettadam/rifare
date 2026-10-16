> Current development decision: accepted under delegated bootstrap authority; see [ADR-0004](0004-delegated-development-authority.md). Original submission/proposal wording below is retained for audit and is not the current acceptance state. No product qualification or independent review is implied.

# ADR-0002 — Release benchmark and bounded pilot protocol

Status: proposed; human approval pending
Goal: M00-G02
Human decision: pending
Dependency decision: M00-G01 / ADR-0001 remains proposed

## Context

A quality percentage is misleading when a worker removes failed cases, treats a
handoff as autonomous resolution, pools incompatible configurations, or labels
fixtures as live evidence. The next goal needs a versioned benchmark, independent
arithmetic oracle and pilot responsibilities before later product instrumentation.

## Proposed decision

Adopt `rifare-v1-benchmark` revision 1 and its linked scenario inventory after
accepting the exact first-release scope and independent reviews. Retain every
existing case ID/content digest. Freeze enrollment independently of outcomes,
keep all in-scope cases in correctness denominators, and report source/configuration
strata separately. No global model or platform approval follows from one passing
workflow. Gate changes require review against the previously retained contract.

Preserve the roadmap's 95% correctness, 200 unique executed product variants and
3/100/30 pilot targets. Add an explicit proposed 20-case-per-quality-stratum floor,
seven-day mature follow-up rules and deployment-specific operational targets.
No automatic acceptance or minimum autonomous-resolution target is introduced.

Use a small Python standard-library document/arithmetic helper alongside the
existing local tools, not a new experiment service or worker orchestration stack.
The declared live-input shape is not an authenticated intake implementation. The
actual pilot implementation and observation collection remain M07-G17 and M07-G18.

## Alternatives considered

Outcome-only reports are simpler but allow denominator changes. A weighted aggregate
can hide a bad configuration. Treating every handoff as failure incentivizes unsafe
automation; treating it as autonomous success inflates claims. A generic measurement
service would broaden this planning goal prematurely. The proposal instead uses
frozen inputs, exact arithmetic and independently reviewed outcome references.

## Consequences and open decisions

Release may need more than 100 cases when many supported configurations each need
20 in-scope cases, and seven-day follow-up may extend beyond the collection window.
The concrete hardware, latency, RPO/RTO, consent, retention and numeric choices need
owner acceptance. They are not deployed services or guarantees. All eight role
assignees remain unset; no reviewer, merchant or observation is invented.

The continuation request permits preparing this proposal, not retroactive acceptance
of M00-G01 or a waiver of independent review. Do not merge, advance product acceptance,
recruit merchants, use production systems, spend, or publish from this ADR.

## Evidence and supersession

See [the benchmark guide](../RELEASE-BENCHMARK.md), [pilot plan](../PILOT-PLAN.md)
and [work record](../../work/records/M00-G02.md). Raw tests, targeted faults and
candidate identity live in ignored evidence. SHA-256 identifies bytes, not human
authority. A future accepted decision must name the actual candidate/revision and
trusted review references. It must not silently overwrite this pending record.
