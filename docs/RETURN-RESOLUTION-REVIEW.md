# Mixed return resolution review

## Authority and fixed scope

ADR-0022 was committed as `edec106` before implementation from `e86beee`.
The owner delegates local implementation, judgment, review and merging. This is
same-assistant maintainer review, not separate reviewer sessions or a production
release. The accepted scope remains synthetic financial records and quote-only
exchanges. Existing goal contracts, original tests, external baseline and benchmark
thresholds remain in force.

## Findings reproduced and corrected

1. Equal source labels did not distinguish separate databases. The source now pins
   a random persisted identity; an identically named replacement is rejected.
2. Independent cumulative rounding could assign a unit more discount than gross.
   Common ordinal remainder allocation preserves nonnegative per-unit values and
   exact totals even for three cents gross/two cents discount across five units.
3. New evidence requests could permit a fresh financial quote. The quote now checks
   current reviewer evidence state, in addition to later preview integrity.
4. A canceled native return could still underpin a quote. Only supported active/
   completed native states are permitted; cancellation blocks resolution.
5. Exchange comparisons omitted allocated return fees. The balance now uses the
   same net entitlement and explicitly reports unsupported collection/refund deltas.
6. An externally resolved unit could receive an exchange quote. Original paid-line
   identity and current resolved-unit state are both rechecked.

7. Unrelated approved reservations unnecessarily invalidated dispatch. Current
   available balance is still rechecked, but its diagnostic display value does not
   change an already-approved obligation. Amount/source/identity terms remain pinned.

8. A later credit lookup could change the account attached to an issued credit.
   Subsequent observations now retain the original account identity; changing its
   balance through redemption is still permitted.

The eight tests first failed at meaningful assertions and passed after correction.
Additional tests cover bounded source calls, no speculative timeout retry,
unconfirmed accounting references, changed exchange fees, HTTP authority and
logical-erasure access boundaries.

## Regression obligations

Keep all original registered tests and source files. Add stable CASE-M03-G06 through
CASE-M03-G10 bindings and negative, concurrency, fault, tenant, monetary and
reconciliation cases. A deliberately broken candidate must fail a behavior assertion,
not merely fail imports or run zero tests. Exact tracked-source count changes are
additive and reviewed; package inputs and prior contract semantics are unchanged.

The externally packaged verification report records the tested commits, actual
commands, full counts, restoration checks and deliberate fault outcomes. Source
integration can be accepted only after those results; this document is not a
candidate-authored substitute for evidence or a claim of independent review.

## Remaining limitations

Original payments/tax and native returns are normalized synthetic facts. The only
money-like effects occur in an isolated synthetic journal; there is no live transport.
This is not bank settlement or a certified stored-value service. Source timeouts
can leave accepted effects unknown, intentionally requiring reconciliation. Atomic
inventory reservation belongs to M03-G11. Full PostgreSQL/React, native provider,
security, privacy and served-browser qualification remain open.
