# ADR-0035: Locale, pilot and carrier quote development

## Prior assignment and goal order

The owner requested "Proceed with the next 5 goals" after the saved M07-G11
through M07-G15 checkpoint. From clean main
`0748116fe58901d318bf2f0d9c30fd35a8005d43`, the delegated maintainer assigns the
next five planning entries: **M07-G16, M07-G17, M07-G18, M07-G99 and M08-G01**.
The milestone gate counts as an entry. M08-G02 label purchasing is not assigned.

This is bounded development preparation and local nonrelease integration under
the renewed owner instruction. M07-G18 cannot collect a real pilot without actual
merchant authorization, source access and elapsed observations; its assigned work
is evidence intake/readiness and an empty real-observation register. M07-G99 is a
blocked assessment, not acceptance or a full-regression campaign. M08-G01 is an
explicitly assigned local quote implementation; the M07 prerequisite remains
blocked. Original cards, thresholds and accepted-goal records remain unchanged.

## Concrete ownership

Every writer uses one native Git worktree based on this committed assignment.
Root owns shared records, registrations, source inventory, integration and the
M07 gate assessment. No generated evidence, private data or runtime dependencies
are committed.

| Scope | Writer and allowed paths |
| --- | --- |
| M07-G16 | Locale author: new presentation helper/contract under `packages/presentation/` and/or new `apps/commerce-api/locale-client.js`; the existing order-status and returns HTML/client/CSS surfaces; their static asset allowlist entries in `apps/commerce-api/server.mts`; new `tests/development/locale-presentation.test.mts` and bounded `tests/browser/locale_workflows.py`; `docs/LOCALE-PRESENTATION.md` and `work/records/M07-G16.md`. Preserve optional-helper fallbacks, all old control IDs, confirmations and API payloads. |
| M07-G17 and M07-G18 preparation | Pilot author: new `packages/pilot/` modules/contracts; `tools/pilot-protocol.mts` and necessary local Python bridge under that package if reusing the existing scorer; new `tests/development/pilot-protocol.test.mts` and minimized synthetic/known-answer fixtures under `tests/fixtures/pilot-protocol/`; `docs/PILOT-PROTOCOL.md`, `work/records/M07-G17.md`, `work/records/M07-G18.md`, and an explicitly empty real-observation register under `work/qualification/`. Reuse the unchanged benchmark, scope, scorer and their validation boundaries. No commerce schema or existing metrics rewrite. |
| M08-G01 | Carrier quote author: new `packages/commerce/carrier-quotes.mts` and its new contract, a separate synthetic carrier quote fixture under `packages/adapters/`, `tools/demo-carrier-quotes.mts`, new `tests/development/carrier-quotes.test.mts`, `docs/CARRIER-QUOTES.md`, and `work/records/M08-G01.md`. Reuse existing scope, approval, source identity, money and policy primitives. If durable documents are needed, use the existing appropriate storage without changing schemas or accepted handling. Existing label purchasing/dispatch behavior is unmodified. |
| M07-G99 and shared integration | Root: existing `docs/M07-QUALIFICATION.md`, `work/qualification/M07.json`, new `work/qualification/M08.json`, `work/records/M07-G99.md`, batch integration record, `PLANS.md`, `README.md`, additive capability/test/source inventory registrations and exact assigned source-hash refreshes. No new acceptance authority or replacement gate. |

## Behavior and preserved controls

Locale formatting is presentation only. Canonical integer minor units/currency
and fixed instants remain authoritative. Unsupported or ambiguous input is
rejected; display strings never become financial inputs. Existing inclusive
elapsed-UTC return cutoffs remain unchanged. The policy IANA zone labels those
instants; this assignment does not change deadlines to calendar-day arithmetic.

Pilot enrollment and benchmark definitions freeze before results. Pending,
failed, unavailable, censored and withdrawn members keep their original
denominators. Adjudication, consent/ownership references, seven-day follow-up,
cost adjustments and exceptions must remain explicit and reproducible. Byte pins
cannot authenticate merchants, source receipts, reviewers or elapsed exposure.
Synthetic and connected-test observations cannot count as completed live outcomes.
No live pilot or future background work is promised or started.

Carrier preparation must retain per-package merchant/account/service eligibility,
source/rate/address identities, expiry and exact currency totals. An invalid
package cannot inherit another package's service or price. Stale quote checks
invalidate affected packages before any future purchase; this batch purchases no
label and creates no carrier charge or provider account.

Root may append proposed capabilities/registrations and inventory paths, refresh
the actual source-file count oracle, and refresh only exact hashes for assigned,
independently reviewed runtime changes in conformance and the proposed privacy
surface contract. The unchanged 170-table schema and existing surface handling
must remain valid. Any genuinely new persistent storage surface requires an
explicit privacy handling review before integration; it cannot be hidden by a
hash refresh. No old assertions, migrations, dependencies, qualification gates,
scope policies or accepted capabilities may be weakened or removed.

## Focused evidence and integration

Keep the owner's reduced defaults: at most **60 actual cases, four whole files
and one 60-second deadline**. Plan three new whole test files (locale, pilot and
carrier quotes) with room for a fourth focused existing check only for a concrete
risk. Write behavioral cases or deliberate faults first. Run the coherent set
once; repeat only affected files to resolve actual failures. A small explicit
locale browser observation may run; no older browser, nested catalog/controller,
full-regression or restoration campaign is implied by this five-goal batch.

Separate nonauthor authority/security and regression sessions review the exact
candidate, protected source and actual evidence. Only bounded local integration
is authorized. Formal M05/M06/M07 acceptance, real pilot/connected carrier work,
PostgreSQL/React qualification, release tags, publication, messages to people,
paid services and production effects remain outside this assignment.
