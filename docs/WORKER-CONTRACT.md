# Contract for an AI-worker goal

## One bounded result per assignment

A worker receives one goal packet, its referenced context and the current accepted baseline. The packet is the scope of work, not permission to finish every related milestone. The outcome, positive/negative/regression assertions and original source acceptance criteria govern completion.

A goal can use several commits or branches under the installed workflow. There must be only one writing worker per branch/worktree. Before editing, the worker records actual allowed paths, the relevant contracts and the native project commands. Symbolic paths in this package are planning hints, not evidence that those files already exist.

Where an implementation goal still covers more than one independently reviewable behavior, split it into child goals such as `M03-G08.a` and `M03-G08.b` in the existing tracker. Preserve the parent ID and every acceptance/test/evidence obligation. The parent remains open until all children and the parent-level end-to-end proof pass. Do not split a difficult failure test away and then declare the feature done.

## Definition of ready

The direct prerequisites are **accepted**, their interfaces and relevant evidence are available, and the current branch includes them. The support envelope, independent oracle, expected customer-visible result and concrete write scope are understood. Required accounts, permissions, approved endpoints and cost limits are present for connected work. An authorized maintainer is available for decisions the worker cannot make.

Absent credentials do not prevent writing isolated code and deterministic tests, but they do prevent accepting a goal whose outcome requires real connected qualification. Report partial implementation and the blocked qualification separately.

Use the current work record and acceptance ledger rather than the original bootstrap state. A historical dependency may no longer have an active packet because its local implementation has landed; that does not supply formal acceptance. The retained behavioral contracts and Git preserve its original obligations. No financial, production, publication, contact or contractual authority is implied by task readiness.

## Required implementation sequence

1. Inspect `AGENTS.md`, the installed git-agent/work-goal skills and actual repository. Read the assigned goal, relevant original requirement text, dependency receipts and the regression/evidence contract. Do not load the entire research dossier merely because it exists.
2. Select an isolated worktree and bind the goal to existing commands. Identify accepted features affected by the change, including parallel work already on the protected base.
3. Write explicit tests and independently specified fixtures before the implementation. Obtain a meaningful behavioral red result or reproduce the bug on an existing version. If behavior already exists, inject the named temporary fault and prove the test detects it. Syntax/import failures and zero discovered tests do not establish feature sensitivity.
4. Implement the minimum bounded outcome. Keep merchant customization in validated profiles/platform packs and business authority in server contracts. Do not introduce a new orchestrator, provider-owned business state or merchant-ID branches.
5. Run the goal's new tests, retained source cases, introduced invariants and relevant accepted regressions locally. Use real database integration for concurrency/transactions and real browser behavior for customer flows. Obtain explicitly authorized connected proof where the packet requires it.
6. Capture exact source/build/configuration identity, commands, native reports, behavior demonstration, independent source-state comparison and rollback notes. Collect only synthetic or authorized minimized data.
7. Submit separate regression and security/adversarial review using the existing configurable reviewer process. An author cannot approve their own critical change. Review count/rounds remain controlled by the installed framework, not a new hard-coded scheduler here.
8. Fix findings and recapture evidence after changes. A trusted integration owner or maintainer accepts the goal. Human approval is required before tagged/public releases.

## Definition of done versus accepted

**Implemented** means code or documents exist. **Verified** means the required tests/observations actually ran on the candidate. **Ready for review** means the worker has supplied complete evidence. **Accepted** means independent reviews and the authorized acceptance decision are recorded for that candidate.

The worker must not use “done” to collapse these states. A screenshot is not proof of a refund. An HTTP acknowledgment is not a warehouse hold. A Shopify/WooCommerce record alone is not proof of cash settlement. A mock provider run is not a commercial partnership. A reported test pass is not evidence that the native runner executed the required cases.

A requirement mapped to several goals is conjunctive: all necessary contributions, the original criterion and the milestone integration gate must pass. Foundational requirements such as tenancy, no-AI operation, privacy, money and authority remain obligations when later modules add storage or actions.

## States and blocked work

Recommended state progression: `not_started → ready → in_progress → implemented → verified → ready_for_review → accepted`. Use `blocked_external`, `needs_changes` and `deferred_by_approved_scope` when appropriate. A deferred feature is not accepted and cannot retain a “supported” claim.

A blocked handoff names the exact missing account, observation, contract, owner decision, test result or elapsed observation window. It includes completed code/tests, remaining obligations and safe next steps. It never substitutes simulator data for the missing evidence or promises later background delivery.

When a milestone requires a human/merchant/partner decision, the worker prepares material and records the genuine decision. It must not impersonate or fabricate that person. A required M07 live-pilot deficit means beta/RC or a blocked v1 gate; the worker cannot silently reduce the predeclared gate.

## Scope and change control

Changing a baseline fixture, expected outcome, skip list, test selector, capability declaration, policy threshold, migration behavior or release claim is protected work. An ordinary feature assignment is not authority to weaken those controls. Record the reason and impacted goal/test/capability IDs; obtain independent review and a trusted change decision.

A new customer exception should first be represented in allowed profile data or a platform adapter. Core behavior changes require a shared business need and regression tests. A provider/runtime change does not authorize changing canonical business records to match a vendor-specific format.

## Handoff and retention

Report the exact goal and candidate/base SHA, real implementation/test paths, commands/counts/results, the caught deliberate fault, observed source effects, configuration pins, blocked obligations, reviewer references and rollback. Identify the next dependency-ready goal without claiming it is authorized or already assigned.

After terminal acceptance/cancellation, preserve durable decisions, source/test contracts, fixture provenance and the minimized evidence required by the retention policy. Only then remove obsolete worktrees and bulky generated evidence according to the installed workflow. Never delete permanent regression tests, still-required audit/source records or evidence needed to explain unresolved external operations.
