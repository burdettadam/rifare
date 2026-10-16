# ADR-0020 — Integration readiness, privacy, safe recovery and return drafts

The owner's next-five instruction assigns M02-G23 through M02-G27 from `aff14cc`.
Decisions, same-assistant maintainer review and local nonrelease merges remain
explicitly delegated. One writer owns `goal/readiness-privacy-batch`. This authority
checkpoint precedes implementation; no independent reviews are represented.

Implement current per-action readiness, a complete inventory of current SQLite
storage with scoped privacy handling, an isolated restore with effect channels
blocked, a fixture-qualified WooCommerce read adapter, and one reusable synthetic
return-draft workflow through the existing gateway. Reuse existing models, profiles,
worker contracts, receipt identity, stops and native tests. No live store changes,
model calls, payment, message, remote publication, package dependency or scheduler.

DELEGATED-LOCAL-11 permits bounded diagnostic integration following documented
security and regression review. It does not waive failures, broaden the release
support envelope, accept incomplete upstream milestones, or claim live qualification.
Retain existing tests, registrations, original benchmark definitions and package
inputs. Approved baseline additions follow review of immutable candidate evidence.

Owned paths: additive commerce privacy/readiness/recovery/draft and WooCommerce
adapter modules and migrations; minimal hooks into existing kernel, gateway,
credential, worker, read and HTTP boundaries; new tests/fixtures/demo/client/docs,
registration and source inventory additions, and five work records. Imported research,
private runtime data and raw evidence remain outside tracked source. Application
controls are not a sandbox against hostile code with direct database access.
