# Development steering and release governance

**Status:** proposed process. No repository was created, changed, published or pushed by this planning task.

## Source of truth

`planning/roadmap.json` defines milestone outcomes, dependencies and gates. `planning/backlog.json` assigns stable goal IDs and acceptance criteria. `planning/capability-targets.json` links all 44 previously researched capabilities to a milestone, partner dependency, optional module or non-feature decision. `planning/acceptance-tests.json` contains designed scenarios, all initially marked not run. `ROADMAP.md` explains the accepted direction; preserve changes to it with an ADR or explicit product decision.

A milestone label is a release boundary, not one giant coding issue. Split a goal when a reviewer cannot verify its outcome independently. Preserve the parent ID and rationale. The completion milestone is the point where full acceptance is due; a read-only or simulator slice can ship earlier without being represented as complete.

## Work selection

Begin with M00 and the first connected order-status slice. Keep one writer per worktree/branch. When capacity is limited, complete one customer-visible vertical slice at a time. A goal with unresolved API permissions, provider access, source-of-truth ownership or financial semantics starts with a bounded investigation goal whose result is an explicit decision.

Recommended active lanes are core workflow, adapter/conformance and customer experience. Open only as many lanes as there are people able to integrate and review their work. Parallel agent runs do not remove human review or eliminate shared-schema conflicts.

M00–M07 define the v1 dependency path. After v1, M08 logistics, M09 growth, M10 claims/international and M12 ecosystem may progress independently. M11 planning depends on M08 inventory foundations. Do not interpret milestone numbers as a requirement to complete every earlier expansion before beginning a later independent one.

Dates are intentionally unset. Staffing, pilot recruitment, partner access and integration unknowns have not been established. Use completed-goal throughput and measured review/rework after two accepted milestones to forecast ranges. Reforecast remaining goals, not safety standards. A public date must never be satisfied by silently deleting an accepted feature or redefining the eligible cohort after testing.

## Goal record

Each work goal should identify its user outcome, milestone, owner, permitted scope, exclusions, dependencies, modified contracts, data/risk classification, implementation plan, failing test, acceptance scenarios and evidence path. Attach source links for platform assumptions. A dependency on a third party needs a named credential/configuration owner and a documented test environment.

Before implementation, state who owns authoritative records: store, payment provider, carrier, warehouse or this product. Record which effects are reversible, which require compensation and which require reconciliation. This prevents an agent from treating every external failure as permission to retry.

Use the installed git-agent framework's actual goal and artifact conventions after inspecting its version. Do not invent a competing command set or copy a framework from another project. Keep developer skill permissions separate from merchant product-agent permissions.

## Definition of ready

An item is ready only when its dependencies are accepted, its API and capability assumptions are documented, the success/failure fixtures exist or are explicitly included in scope, and the implementation can be reviewed without access to unknown private context. A blank owner is unassigned, not implicitly the assistant or a background worker.

## Definition of done

A goal requires passing local unit, contract and integration tests; a recorded UI/API demonstration where relevant; reconciled source-system records for side effects; configuration/skill/profile compatibility tests; updated operational/user documentation; and evidence bound to the exact commit/build. Tests must cover both the proposed feature and regression of already accepted behavior.

Require independent security/adversarial and regression review. The regression reviewer explicitly looks for removed features, disabled tests, weakened assertions, hidden capability downgrades and altered customer behavior. Reviewer number and rounds remain configurable through the existing framework. Critical financial/permission work cannot be accepted solely by the same agent that authored it.

A human approves merges that produce tagged releases. A feature flag does not excuse unsafe code paths reachable by another interface. Optional unsupported combinations must be disabled consistently across UI, REST, MCP and automation.

## Evidence bundle

Every accepted goal should record source commit, artifact digests, test environment, adapter/API versions, skill/profile/policy pins, normalized requests and receipts, failing/passing tests, independent reviews, unresolved limits, migration/rollback effects and an acceptance decision. Customer data in evidence must be synthetic or suitably minimized and authorized.

Never mark a proposed test as passed because the design document says it should pass. This planning package's structural validation only checks IDs, dependency relationships, links and example schemas; it does not exercise a commerce platform, an agent, a payment provider or a production deployment.

## Release gates

| Gate | Proposed criterion | What it does not prove |
|---|---|---|
| Critical correctness | 100% of declared mandatory permission, money, tenant-isolation and inventory invariants pass; zero observed duplicate side effects or unauthorized actions. | A mathematical guarantee of no future failures. |
| Scenario coverage | At least 200 versioned scenario variants for the v1 support envelope, expanded from the 67 seed specifications. Use unseen variants and failure injection. | That the 67 design specifications are already executable tests. |
| Resolution quality | Target at least 95% correct handling on a predeclared in-scope evaluation set for each supported autonomy configuration; report denominator and error classes. | That appropriate escalation counts as an autonomous resolution. Track those separately. |
| Portability | Two commerce platforms complete the shared subset; two independently implemented agent runtimes pass; two cloud-provider configurations and one local endpoint have declared scope/quality results. | Universal compatibility or identical output across models. |
| Merchant evidence | Recommended target: three independent merchant profiles, 100 in-scope case outcomes and 30 days of bounded pilot observation. Obtain actual merchant approval. | A statistically conclusive market study or guaranteed ROI. Insufficient live evidence means beta/RC. |
| Operability | A non-author installs/upgrades/restores; declared hardware and traffic profile is load-tested; no replay of restored live writes. | An unspecified enterprise SLA. |
| Economics | Cost per correctly resolved case, operator time, retained contribution margin and seven-day reopen rate are reported against the measured prior/manual workflow. | That exchanged revenue alone is profit or deflection alone is successful support. |
| Release review | No unresolved critical/high release-blocking findings; accepted scope, known gaps, privacy, license and operations responsibilities are documented. | Removal of all commercial, legal or service risk. |

The numeric thresholds above are proposed product gates, not measured results or industry benchmarks. At M00, define the support envelope, denominators, load profile and operational RPO/RTO/latency targets. Then freeze them for the evaluated release. Lowering a gate requires an explicit decision and an honest downgrade of the release claim, not a silent edit.

## Metrics and decision rules

Maintain separate measures for correct handling, autonomous correct resolution, human handoff, attempts, repeat contact and financial reconciliation. Count in-scope hard cases in the denominator. Report provider costs, messaging, shipping, hosting and operator effort separately. Customer satisfaction and appeal rates matter alongside merchant economics.

Track quality by skill/model/profile combination and by action risk. A passing read-only model does not inherit approval for money-moving autonomy. Sample actual case outcomes and reconcile against native systems; do not score success only from an agent's final message.

When deciding between breadth and depth, prioritize merchant-blocking correctness, high-frequency workflows and integration evidence. A new platform integration is justified by demonstrated demand plus conformance feasibility. A new native subsystem is justified only when an adapter cannot meet the supported workflow economically or reliably.

## Operational rollout

Use simulator -> connected test store -> shadow -> approval-only pilot -> constrained autonomy -> broader release. Choose cohorts by named action/merchant configuration rather than randomly enabling irreversible operations. Keep rollback and emergency stop available before expansion.

During migration or parallel operation, designate one writer and notification owner per workflow. Reconcile exports and native IDs before switching ownership. Stop new write work before a rollback; reconcile outstanding operations before another installation resumes them.

Operational targets must be tied to deployment class. Specify backup interval/RPO, recovery procedure/RTO, p95 gateway latency excluding external waiting, expected order/event volumes, retry budget and maximum reconciliation lag. A self-hosted installation cannot inherit an untested hosted service promise.

## Change control

Record architecture or scope changes with context, alternatives, decision, consequences, evidence and affected goal/capability/test IDs. A new customer need can enter as a platform pack or merchant profile when existing actions suffice. Add core code only for a shared business capability or necessary adapter semantics—not as a shortcut for a customer-specific hard-coded exception.

Maintain compatibility policy for action schemas and skill/profile versions. API removal, policy meaning changes and migration of in-flight state require explicit release notes, migration and tests. Deprecation decisions must preserve the ability to export merchant-owned data.
