# ADR-0007 — Deterministic test harness on an explicit diagnostic profile

Status: delegated implementation decision recorded before source changes; not goal acceptance.

The owner requested the next goal and previously delegated project decisions.
M00-G02 is accepted. M00-G05 is implemented only for the `smoke-sqlite` profile and
is not accepted for the target PostgreSQL/React stack. Its source is `2883cd4`.

Authorize only preparatory M00-G06 work on that diagnostic branch. This supersedes
ADR-0006's instruction not to start M00-G06 solely for this bounded work. It does
not change either goal's dependency/acceptance criteria, extend the bootstrap
review exception, or qualify the target stack. Keep main and the accepted-goal
ledger unchanged. No later goal is authorized by this record.

Use the existing Node test runner and Python unittest. Add deterministic synthetic
two-merchant fixtures, frozen time, an in-memory faultable provider, SQLite fixture
tests, and Playwright browser-component tests. The browser component mounts the
unchanged HTML/JavaScript source with fake responses; it is not a served end-to-end
qualification, a React test, or a way to bypass managed browser networking policy.

Native runner adapters must fail on zero/missing/extra/duplicate IDs, skips, todos,
failures, hidden network attempts, leaked synthetic secret canaries, or mismatched
fixture versions. Run under an allowlisted environment; deny JavaScript network
APIs and browser requests by default. These controls are not an OS sandbox for
malicious tests/native binaries. Do not disable browser policies.

No new npm packages, mandatory agent/model provider, scheduler, production access,
paid service, hosted publication, or release is authorized. Use the host-installed
Playwright/Chromium only if available; document exact observed versions, fail
closed otherwise, and do not fabricate an install lock or bundle third-party code.
Root npm scripts may be extended through explicit intake while retaining every
existing script, engine, private flag, lock graph, and original manifest fixture.

New fixtures and test inventories are additional proposed contracts. Original
requirements, 676 scenario specifications, accepted baselines, benchmark oracles,
and merchant examples remain unchanged. Independent reviews remain required for
full goal acceptance. Record partial diagnostic results precisely.
