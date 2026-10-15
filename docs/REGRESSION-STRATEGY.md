# Regression protection that survives later AI work

## The acceptance contract

Every goal introduces three behavior-specific cases: the useful outcome, a negative/boundary case and a regression fault the tests must catch. Original scenarios are retained under their existing IDs and assigned a primary owner, with later extension owners where new media, platform or physical-effect paths appear.

The 676 entries are specifications. The implementing worker must create runnable tests in the actual project, bind each stable case ID to an actual native runner case and collect evidence. Do not generate hundreds of permanently skipped placeholder tests and claim coverage.

After acceptance, a test and its capability contract enter the protected regression baseline. They stay required for releases that support that capability. Planning dependencies determine work order; **they do not define the entire regression set**. Features accepted on parallel branches and already integrated into the protected base must also be retained.

## Independent oracles

Expected outcomes must come from a predeclared fixture, independently calculated amount, source-system record, approved policy truth table or genuine reviewed observation. Do not compute `expected` with the same function under test, compare two interfaces that share the same faulty calculation as the only oracle, or grade an agent from its own success message.

For money, assert currency, original allocation, fees, prior resolutions, remaining balance and provider-side accepted/settled effects at the actually observed stage. For inventory, assert quantity conservation by item/location/source and duplicate effect counts. For UI, assert rendered choices, accessible controls, confirmation steps and resulting server/native state—not just pixels. For AI, assert authorized action traces, facts, source references, completion/handoff classes and provider boundaries; identical wording is not required.

## Three cumulative layers

**During a worker goal:** run its positive/negative/regression cases, retained seed scenarios, introduced cross-cutting invariants, changed-module unit/database/contract tests and the relevant previously accepted user journeys. Use local services for iteration; do not move every test iteration into CI.

**On an integrated candidate:** run the complete applicable deterministic accepted suite, native runner discovery/count checks, changed contract/schema/fixture checks, browser smoke for critical flows, concurrent/crash tests for affected state and targeted connected adapter qualification. GitHub CI verifies the integration candidate through existing workflows; it does not replace local testing or human review.

**At milestone or release gates:** repeat the current cumulative suite on one exact artifact, execute the milestone journey and required connected/independent observations for the declared support envelope, compare source-system state and obtain independent review. A required provider/merchant proof that could not be obtained remains blocked. Requalify live or partner evidence according to material changes and its approved validity window; do not manufacture a new observation period for every commit.

Use test selection for iteration, not as an escape from release obligations. Empty selection, zero executed cases, required skips/todos, quarantined critical tests and altered denominators are failures. A flaky critical test blocks the associated capability until repaired; it is not silently quarantined into green.

## Concrete failure classes

| What later work might break | Test obligation |
|---|---|
| A worker removes tenant filtering | Cross-store equal-external-ID reads/mutations are denied through API, worker, cache and file paths. |
| An agent invents its own approval or refund number | Current server permission and preview hash/amount/currency/version checks reject it. |
| A provider accepted a refund but the client timed out | Restart/retry reconciles one original operation; independent provider effect count is one. |
| Two workers consume the last replacement | Only one qualified stock commitment succeeds; the other gets an honest fallback. |
| An edit clears every fulfillment hold | Payment/fraud/foreign holds remain; unpaid additions do not ship. |
| A new model/runtime loses business context | Same canonical case/policy/receipts continue; no provider-owned thread is required. |
| A skill/profile claims a missing warehouse feature | Verified adapter capability still blocks the action. |
| Human takeover races an agent reply | Previous fence rejects both business actions and customer-visible messages. |
| Consent is withdrawn after a job is queued | Final authorized send check suppresses it; already provider-accepted messages are not falsely promised recall. |
| Restore starts queued live effects | Environment comes up effect-disabled, then reconciles before any deliberate activation. |
| New support work deletes a return feature | Accepted capability and scenario remain in the trusted baseline and still execute. |
| Tests stay green because assertions were weakened | Protected expectation/source diff triggers independent review; a valid targeted fault must still be detected. |

## Proof that the tests can fail

A new test must fail for a relevant behavioral reason before the fix or against the packet's named deliberately broken behavior. Run the mutation in an isolated temporary worktree and record the candidate/test/fixture digests. Restore the real candidate and demonstrate green results.

The fault must reach the intended assertion. An import error, invalid syntax, failure to start the database or missing credential is not a killed behavioral mutant. Equivalent/inapplicable faults require a documented independent review and an alternate meaningful fault, not an author-declared pass.

For critical money, identity, approvals, holds, consent, tenancy and inventory paths, targeted faults are mandatory. Useful mutants include removing the tenant predicate, using a fresh retry key, accepting stale previews, treating invoices as paid, trusting profile text as capability, dropping a hold reason, incrementing stock on duplicate scans and enabling restored egress. A global code-coverage percentage cannot replace these tests.

## The trusted baseline

Keep accepted stable test IDs, capability contracts and protected expectation/fixture/source digests in a maintainer-controlled baseline from a protected branch or signed/attested build artifact. The baseline source and its expected digest must be supplied by the trusted workflow, not candidate-controlled inputs.

The candidate may propose additions or reviewed changes; it cannot redefine its own previous obligations. A legitimate changed test/oracle may be accepted only through independent regression review, a demonstrated effective replacement and a candidate-bound maintainer rebaseline decision. Removing a capability needs explicit deprecation/migration and revised customer-facing claims. No feature worker can approve that by editing JSON.

Tests may be refactored, split, renamed in native runner syntax or strengthened. Preserve stable contract IDs and a reviewed old-to-new mapping; demonstrate at least equivalent behavior and fault sensitivity. Cosmetic test-code edits do not justify removing the behavioral obligation.

The included `tools/check_regression_inventory.py` is a small fail-closed helper. It checks a protected baseline against normalized actual-runner inventory for missing/reidentified/skipped tests, stale candidate/configuration, changed contract/oracle/test-source digests, disabled capabilities, inconsistent counts and unsuccessful runner exit. It deliberately rejects an empty baseline as a product pass.

It **does not authenticate the native report**, inspect all assertion semantics, verify actual provider effects or supply branch protection. A candidate could forge a self-authored report unless the native-report adapter/provenance and review workflow are protected. M00-G07/G08 require binding these checks to the actual repository, native runner and trusted review infrastructure. The helper is not a new orchestrator or a substitute for that integration.

Example invocation after real implementation and trusted baseline setup:

```sh
python tools/check_regression_inventory.py \
  --baseline /trusted/accepted-regressions.json \
  --baseline-sha256 "$PROTECTED_BASELINE_SHA256" \
  --candidate-registry evidence/candidate-registry.json \
  --report evidence/normalized-native-results.json \
  --candidate-sha "$ACTUAL_CANDIDATE_SHA"
```

The external paths/values are required inputs, not existing files supplied as passing evidence in this pack.

## Independent regression review

Compare the candidate against the current protected base, not just the worker's reported changes. Inspect removed code paths, routes, UI affordances, feature flags, declared capabilities, tests, fixtures, skip/todo annotations, test-discovery patterns and qualification thresholds. Check that no hard case left the denominator and no source-effect assertion became a schema-only check.

Run the old journey and the new journey together. A returned field still existing is not proof that the user can still complete the workflow. Verify manual/no-AI paths, tenant/customer authority, model/runtime/platform/profile compatibility and migration behavior.

Review is candidate-bound. Any consequential source/configuration/oracle change invalidates affected evidence and review. The integration owner retests the combined branch and captures new evidence instead of assembling green reports from incompatible commits.

## Optionality and continuing obligations

An unavailable platform/service remains explicitly unsupported and disabled across UI/REST/MCP/automation. Its negative test is required, but passing that negative test does not prove the missing positive feature exists. Human-approved optional exclusions must appear in release claims and the goal ledger.

When later goals add storage, actions or channels, extend the foundational privacy, tenancy, secrets, no-AI, approval, ownership and idempotency suites to those new paths. Early simulated boundaries are not permanent substitutes for connected or physical evidence.

No finite test suite proves the absence of every possible regression. The purpose is to preserve named capabilities, expose meaningful counterexamples, detect weakened safeguards and block unproven changes from acceptance.
