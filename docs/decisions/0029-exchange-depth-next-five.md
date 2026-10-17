# ADR-0029 — Repeated exchanges and bounded financial qualification preparation

Date: 2026-10-17. Recorded before product implementation.

The owner requested “Proceed with next 5 goals” after the verified M06-G01–G05
handoff. The assigned scope is M06-G06 through M06-G10, based on integrated main
`2fe529eb379734b04470bf7f0663a5440c78c314`, tree
`4cc29fa11382b7b418715f8f6ca0dd0ef06d8bf2`. The preceding complete native run on
`4d0ec1cd3d0f4009891b6c902323150c8a43f616` passed all 2,173 registered cases.

DELEGATED-LOCAL-19 records the renewed bounded local assignment under the owner's
existing delegation. It permits local technical decisions, preparation,
implementation, testing, independent review, corrective work and a verified local
nonrelease merge. It does not extend ADR-0028 into acceptance authority or alter
any original goal obligation. M03-G99, M04-G99, M05-G99 and the financial connected
qualifications remain unaccepted. Missing prerequisites do not prevent isolated
code and deterministic tests; they do prevent formal acceptance and supported
connected-service claims. The implementation must reject unqualified combinations.

## Writers and concrete scope

- `/root` is integration owner and sole writer on `goal/M06-next-five`. It owns
  G06, new `packages/commerce/exchange-lineage.mts`, any narrowly required lineage
  fixture source, migration 024, lineage fixtures/tests, shared canonical
  allocation/quote/approval/fulfillment/privacy/API hooks, documentation/demo,
  additive registry/source inventory and concise decision/work records.
- `/root/finance_goals` is sole writer on `goal/M06-currency-fees`, owning G07/G08:
  new exchange-currency and exchange-fees modules, exchange-money fixture source,
  migration 025, currency/fee tests and golden fixtures, and scoped documentation.
- `/root/instant_exchanges` is sole writer on `goal/M06-instant-mandates`, owning
  G09/G10: new instant-exchanges module and fixture source, migration 026, mandate,
  lifecycle and race tests, exact terms fixtures and scoped documentation.

All three branches originate at the recorded base and have isolated local data.
The integration owner coordinates shared hooks; workers do not edit another
writer's worktree, shared registration or inventory. Existing financial,
fulfillment, intake and approval paths remain canonical. No new agent scheduler,
provider dependency, merchant-specific branch or unrelated refactor is assigned.

## Evidence and protection

Protect all 2,173 existing native registrations, 109 capability records, prior
test/oracle sources, original source paths and branch history. Keep the original
external controller and M05 baseline pins; additionally preserve the exact
G01–G05 source/control inventory outside candidate write paths. The existing
licensing source-count normalization applies only to its two declared fields.
No failing obligation, skip, deleted expectation or smaller denominator is
authorized. New independent hand-calculated fixtures and meaningful behavioral
red results or deliberately broken candidates are required for each critical goal.

Separate nonauthor agent sessions `/root/authority_review` and
`/root/regression_review` will perform authority/security and regression reviews.
These are same-runtime assistant reviews, not human, merchant or provider
attestations. The maintainer can decide local integration only after actual
retained checks pass and actionable findings are resolved. Changed candidates
require refreshed affected evidence and review within the existing review policy.

G07–G10 require genuine connected-test capabilities, scoped accounts/permissions,
source/API contracts, and required merchant/customer decisions for formal
qualification. Synthetic authority fixtures may demonstrate exact amounts,
provenance, finalization, expiry and concurrency, but cannot supply those external
facts. Keep unknown financial reservations and reconcile the original operation.
Mandates do not prove settlement of already owed additional payments.

No live or paid effects, real messages, account administration, production,
deployment, remote push, public publication or release tag is authorized. Keep
private proofs and new browser captures out of delivered artifacts. Finish with
reviewed source identities, permanent checks, explicit qualification blockers and
a reproducible ZIP/Git bundle. Stop at G10; G11 is not assigned.
