# M14 qualification and local assessment

M14 is assigned by ADR-0043 from protected M13
`655ea8c4a8688f938454c10f777478316c07d7e3`. Canonical planning and the accepted-goal
ledger remain unchanged. Root completed the focused native verification with
60 final selected cases passing. Two independent nonauthor reviews and root's
separate local integration decision bind the final checkpoint in its accompanying
evidence. This development outcome does not grant formal acceptance.

| Goal | Implemented/prepared scope | Qualification boundary |
| --- | --- | --- |
| G01 | Frozen protocol, source/configuration identity, denominator and threshold rules | Local protocol preparation; no model quality result inferred |
| G02 | Canonical observation intake, frozen-cohort scoring, pending report and independent review | Actual approved backend/cohort measurement pending |
| G03 | One published manual-work rule, linked receipts, ownership/source/stop/review fences | Diagnostic routing only in observed local fixtures |
| G04 | SystemOne transport and artifact-attestation completeness checks | Actual second implementation and optional self-hosted runtime pending |
| G05 | Versioned activation, canary, replacement, rollback and separated compatibility claims | Two actually exercised backend comparison pending |
| G99 | Local assessment that rejects unsupported completion claims | Formal acceptance blocked; zero formal G99 cases executed |

## Observed native evidence

| Final selected whole file | Passing cases | Actual execution commit | File seconds |
| --- | ---: | --- | ---: |
| `decision-systemone.test.mts` | 8 | `c961347` | 0.315 |
| `decision-routing.test.mts` | 20 | `4d6b386` | 9.905 |
| `decision-shadow.test.mts` | 23 | `4d6b386` | 9.607 |
| `privacy-coverage.test.mts` | 9 | `4d6b386` | 15.714 |

All three actual invocations are retained under `evidence/development/`:

1. `m14-attempt-01` ran the eight SystemOne cases successfully, then stopped on a
   routing test-file syntax failure before any routing case ran. Its one native
   filename-wrapper failure is not counted as an executed product case. Shadow
   and privacy were not reached. The invocation took 0.567 seconds.
2. `m14-attempt-02` executed all twenty routing cases: two passed and eighteen
   failed because protocol freezing compared canonical object-key order with
   declared label-array order. Shadow and privacy were not reached. The
   invocation took 5.725 seconds. The native XML/TAP, rather than the runner's
   zero fully-passed-file count, records those twenty actual executions.
3. `m14-attempt-03` passed twenty routing, twenty-three retained shadow and nine
   retained privacy cases in one 35.311-second invocation after exact label-set
   comparison was corrected. Frozen reference labels and thresholds were unchanged.

The final selected set is 60 passing cases; all attempts together contain 80
product-case executions plus the separate parse-failure wrapper. Each invocation
stayed within sixty actual cases, four whole files and one total sixty-second
deadline. Root alone executed product code. The G04 author and both independent
reviewers executed zero product tests, imports or demos. No broad or nested
catalog, controller, browser or restore campaign was run.

The final runtime was observed at `4d6b386`; subsequent closeout changes are
documentation only. The standalone SystemOne file and its execution dependencies
are unchanged from its passing run. Exact source deltas and both final review
hashes govern carrying that unaffected result and the documentation-only final
delta; carried results are not reported as new executions.

## Remaining qualification

There are no actual connected model observations, provider cost or latency
measurements, live backend portability results, target-host self-hosted loader
observations, paid service calls or production routing in this assignment. The
local twelve-case reference cohort is deliberately below the frozen 60/60/30
qualification minima. Pure 120-case arithmetic fixtures demonstrate metrics and
persisted capacity; they have no inference provenance and cannot activate scoped
routing. No qualification threshold or old accepted capability is lowered.

Independent review and local integration can close the bounded development
checkpoint. They cannot close the inherited formal product gates or M14's
external measurement obligations. M15-G01 is the next unassigned planning goal.
