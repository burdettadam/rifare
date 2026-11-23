# Codex Handoff — Delegated Agent Commerce Integration

**Prepared:** 2026-11-22  
**Repository:** `burdettadam/rifare`  
**Base branch:** `development`  
**Purpose:** Resume delegated-agent commerce development, reconcile all existing branches, qualify the integration, and complete the next implementation milestones without duplicating merged Marty/ElevenID work.

## 0. First instruction to Codex

Do not start by implementing a new delegated-commerce stack. Recover the existing branch work and merge it coherently.

1. Inspect the actual host checkout, all worktrees, remotes, uncommitted changes, and branch heads. Do not overwrite or discard another worker's work.
2. Read `AGENTS.md`, `docs/GOVERNANCE.md`, `docs/DEVELOPMENT.md`, `docs/ARCHITECTURE.md`, `docs/PLANS.md`, `docs/QUALIFICATION.md`, `planning/README.md`, the applicable goal packets, and `.agents/skills/work-goal/SKILL.md` plus `.agents/skills/worktree-flow/SKILL.md`.
3. Fetch all remotes and compare each candidate branch to current `development`. The GitHub inventory below was observed on 2026-11-22; recheck it before acting.
4. Build a dependency graph from commits and file overlap. Several branches are parallel or stacked; do not merge each branch independently or assume the listed ahead counts are additive.
5. Preserve every original branch/ref until its changes are integrated and verified. Use one writer per branch/worktree.
6. Update this handoff and the canonical planning/work records as the implementation progresses.

## 1. Product and responsibility boundaries — fixed decisions

Rifare is a merchant-owned commerce operations product and a showcase company intended to be transferable/sellable independently. ElevenID is the identity/delegated-authority infrastructure provider that Rifare consumes. The commercial strategy is to bootstrap a real use-case company on ElevenID, then sell the use-case company while retaining the buyer as an ElevenID subscriber.

| Owner | Owns | Must not absorb |
|---|---|---|
| Marty Protocol | Protocol-level trust/delegation primitives, trust profiles, credential and presentation-policy semantics, portable authority/evidence contracts, interoperability | Merchant workflows, cart/order/payment decisions |
| ElevenID | Identity services, credential lifecycle, consent, trust and delegation verification, policy evaluation, managed verification, signed decisions/evidence and issuer/verifier infrastructure | Commerce business rules, budgets, payment execution, order ownership |
| Rifare | Commerce gateway, agent/task orchestration, merchant policies, approvals, budgets, reservations, current-cart checks, provider calls, idempotency, business commits, recovery and reconciliation | Reimplementing identity protocols or becoming the credential authority |
| Supabase | Authentication and OIDC provider for Rifare and ElevenID applications | Delegated commerce authority/trust decisions |
| Medusa 2.23.0 | Commodity commerce engine: catalog, carts, pricing, orders and supported commerce primitives | Agent authorization, delegated authority, merchant-specific orchestration |
| PostgreSQL | Durable application and commerce state | Replacing the separate ownership boundaries above |

Merchant/provider ownership remains explicit: merchants own their catalog, pricing, inventory, orders, payments, refunds, and fraud responsibilities. Rifare coordinates permitted workflows and records provider outcomes; it does not claim to be the payment processor or merchant of record.

**Important separation:** ElevenID is not the authentication provider in this architecture. Supabase handles authentication/OIDC. ElevenID/Marty supplies identity trust, credentials, consent, delegation and verifiable authority evidence.

## 2. Marty / ElevenID delegated-use work already completed

These changes were reported merged before this handoff. Confirm current upstream refs and exact merged PR metadata before relying on them; do not recreate them.

### Marty Protocol

- Draft PR #38, branch `feat/agent-trust-profiles`, commit `6126da7`, merged to `ElevenID/marty-protocol` as `1952c56e`.
- P01–P08 implemented: trust/profile bindings, delegation commands and recovery, OAuth/MCP, AuthZEN, lifecycle signals, evidence portability and conformance pack.
- Reported test result: 561 tests plus 156 subtests passed; 355 SHA-256 entries verified.
- Profiles remain `NOT_ASSESSED`; discovery is disabled. Do not promote profiles or claim qualification without new evidence.
- Earlier PRs #31–#34 were also reported merged; resulting main head recorded as `7890369c2c851184269032121789847da17400fd` before later delegated-use work.

### ElevenID runtime / caller

- Runtime PR #1994 merged as `58acfb97`.
- Delegated caller/wallet routes and `marty-delegated-use-client` were reported merged.
- Public caller remains disabled by default.
- Receipts are evidence-only. They do not authorize commerce execution.
- ElevenID proves identity/delegation/trust and returns evidence/decisions; Rifare remains the owner of orchestration, budgets, business permissions, provider idempotency and commerce commits.

### AWS qualification

- AWS Free-plan qualification reported 210 Rust tests and 14 gates passed.
- The disposable instance was stopped after qualification; cleanup preserved 78 existing containers.
- This was a bounded qualification run, not a production service-role/network or full production deployment qualification.

### Remaining ElevenID/Marty work

1. Production service-role and network isolation qualification.
2. CA/signing-key rotation and recovery qualification.
3. Outage, restart and pending-claim reconciliation.
4. Additional attestation, external-authority and represented-subject profiles.
5. Resolve the separate CodeQL advisory report: 2 critical and 1 high (recheck current advisory state and ownership).
6. Reconcile delegated-use owner-boundary CI failures. A Nov 22 run had a failing Rust Service Tests (selfhost) job; a later owner-boundary run still failed overall with other listed probes passing. Fetch exact current PR/check runs and logs before deciding whether this remains open.
7. Do not infer production readiness from merged code or the AWS test result.

Relevant ElevenID UI PRs reported in the project context: #2039, #2041, #2042, #2043 and #2044 merged; #2038 “Qualify delegated-use owner deployment boundaries” had unresolved qualification/check failures in the latest recovered notes. These are in `ElevenID/marty-ui`, not the Rifare repository. Recheck status before modifying them.

## 3. Rifare GitHub inventory observed 2026-11-22

Repository is public: `https://github.com/burdettadam/rifare`. Default branch is `development`. At inspection, no open pull requests were returned for Rifare. The observed `development` base was `933600561a989150e2a2d3c4273a57ee84cdad52`.

Candidate branches compared to `development`:

| Branch | Ahead | Interpretation |
|---|---:|---|
| `feat/medusa-operation-journal` | 33 | Most advanced Medusa/operation-journal work; reported as active working branch in earlier context |
| `feat/supabase-identity` | 26 | Supabase authentication/OIDC integration |
| `feat/medusa-commerce` | 24 | Medusa commerce foundation |
| `feat/rcg4b-public-caller` | 22 | Public/managed caller continuation |
| `feat/rcg4b-internal-use` | 20 | Internal delegated-use path |
| `feat/rcg4b-command-http` | 17 | Command HTTP transport |
| `feat/rcg4b-native-start` | 14 | Native START path |
| `feat/rcg4b-command-claims` | 11 | Command claim handling |
| `feat/rcg4b-command-consumer` | 6 | Command consumer |
| `feat/rcg5-receipt-review` | 3 | Receipt review |
| `feat/rcg5-checkout-review` | 1 | Checkout review |

All listed branches were ahead of the same base and zero commits behind at the time of comparison. The comparison output showed broad file overlap (103–199 changed files per branch), so treat the branches as a potentially stacked/overlapping work graph, not independent patches. Inspect exact SHAs, merge bases, commit ancestry, patch IDs and file diffs locally.

Other observed branches: `chore/publication-readiness`, `docs/portfolio-branding`, `feat/medusa-cart-context`, `main`, and stale `goal/M20-dropoff-handoff`. The latter was 20 commits behind development; do not merge it as part of this effort.

Prior conversation recorded these specific Rifare commits/branches:
- Native checkout preview and real ES256/Ed25519 receipt verification/binding were implemented locally; evidence-only and `execution_authorized:false`.
- `feat/rcg2-native-checkout` @ `9bf3872`.
- `feat/rcg3-native-receipts` @ `bae37e8f55130328a5e5f4ba2a4a35549bf58388`.
- A handoff `main` was recorded @ `57a98a7474432f11580894a113d6a978409981b2`; `development` remained `9336005`.
- Medusa and Supabase branches were created: `feat/medusa-commerce` @ `62350ad`, `feat/supabase-identity` @ `afd678f`. Later branch history is ahead; use actual current branch heads, not these early SHAs.
- Architecture commits `cf312928`, `1c28a13` were recorded on the operation-journal work.
- The operation-journal branch was recorded as 33 commits ahead / 0 behind development and no PR at that time.

The above branch SHA references are historical anchors, not guaranteed current tips. Revalidate all refs from Git before checkout, cherry-pick, merge or reset.

## 4. Delegated commerce behavior and non-negotiable safety model

The showcase scenario is an agent buying a $68 desk lamp under an $80 delegated spending limit. The agent must demonstrate permitted purchase intent and independently reject:
- An over-limit purchase.
- Changed cart/item/merchant/terms after approval.
- Revoked or expired authority.
- Missing, stale, wrong-subject or wrong-audience evidence.
- Duplicate/replayed command or provider dispatch.
- Lost provider response and uncertain outcome.
- Any path that attempts to turn an evidence-only receipt into execution authorization.

The demo should make successful and refusal paths observable and reproducible. The intended showcase also includes a synthetic refund-recovery demonstration: one provider send attempt, lost provider response, retained pending/unknown operation, and recovered original outcome without duplicate money movement.

### Execution invariants

- Default-deny. No provider effect merely because an agent asked, a model proposed, a wallet supplied a claim, or ElevenID returned evidence.
- Recheck the current merchant, customer, cart, item, amount, currency, merchant/store, provider, terms, purpose, audience, subject and authority binding immediately before any protected effect.
- Bind approvals and delegation to the exact immutable operation/cart digest and merchant/customer/store context.
- Enforce amount ceilings and purpose/action constraints in Rifare. A protocol trust result is not a merchant budget.
- Preserve idempotency across retries, timeouts, worker restarts, duplicate messages and provider uncertainty.
- Keep durable operation journal/history immutable; corrections append new events rather than rewriting history.
- Unknown provider outcomes must hold the original operation identity and reservations until reconciliation establishes the outcome. Never retry a non-idempotent effect under a new key to “see if it works.”
- Recover safely after crash/restart. Reconcile pending claims, commands, challenges and provider outcomes from durable evidence.
- Do not treat a local preview, synthetic provider, fixture settlement, signed receipt or test result as a real payment or production qualification.
- Maintain privacy lifecycle: export, correction, retention, erasure, legal holds and invalidation of copied authority.
- Human approval and merchant controls remain available; model output and skill text never confer authority.

## 5. RCG4B / RCG5 checkpoint recovery

The earlier project checkpoint recorded RCG2/RCG3 native checkout and receipt work, then RCG4B C1–C5 as complete:

- Native START and journal.
- Command HTTP/client.
- Internal mTLS sending and recovery.
- Published checkpoint commits: `e8a0152`, `9c61f30`, `c88799b`.
- The `development` branch was unchanged at `9336005`; no deployment/provider qualification had been claimed.

C6 was assigned but not implemented in that checkpoint. Treat it as still pending until current branch source and tests prove otherwise:

1. Public managed-machine START/recovery.
2. Validate the challenge Link.
3. Retrieve the signed request over mTLS.
4. Retain exact unverified request bytes.
5. Verify signature, issuer, audience, nonce, lifetime and DCQL.
6. Verify proof and current authority.
7. FINALIZE and bind the receipt to exact request/operation context.
8. Ensure no commerce effect can occur before all currentness and merchant authorization checks pass.

The branch names now present on GitHub include the RCG4B native-start, claims, consumer, HTTP, internal-use and public-caller branches. Map their commits to C1–C6 and do not assume the old checkpoint is the current state.

RCG5 checkout-review and receipt-review branches also exist. Inspect their acceptance criteria and exact source/test deltas; keep receipt evidence separate from checkout authorization.

## 6. Medusa + Supabase integration

The intended architecture replaces commodity commerce code with Medusa where it reduces custom code and liability, while preserving Rifare as the delegated commerce gateway/orchestrator.

- Medusa 2.23.0 owns catalog, cart, pricing and order primitives.
- Supabase provides authentication/OIDC.
- PostgreSQL is the durable state foundation.
- Rifare retains merchant identity mapping, approval workflows, delegated-agent orchestration, budgets, operation journal, current cart/payment authority checks, provider idempotency, recovery and reconciliation.
- ElevenID is consumed as a trust/delegation/verification service; do not make it the OIDC/auth provider.
- Preserve merchant/cart/customer/store binding between Medusa objects and Rifare journal/approval records.
- Do not fork or duplicate Medusa business logic without a documented necessity.
- Do not let Medusa's ordinary cart/order authorization stand in for agent delegation checks.

### Hard gate: COMMERCE-OPERATION-01

Do not enable payment, checkout, other protected commerce effects, or ElevenID authority integration until **COMMERCE-OPERATION-01 passes**.

This is an explicit owner constraint from 2026-11-22. Codex must locate the canonical goal/packet and frozen criteria in the current branch, then execute them exactly. Do not redefine, weaken, or infer acceptance.

At minimum, the operation gate must prove:
- Merchant/cart/customer/store binding.
- Durable immutable journal/history.
- Correct idempotency and duplicate suppression.
- Crash recovery and pending/unknown outcome reconciliation.
- Privacy lifecycle behavior.
- Final currentness/authority rechecks immediately before effects.
- Correct failure/refusal behavior under stale, revoked, expired, changed and replayed authority.

Until it passes, keep checkout/payment and protected provider effects disabled, and keep ElevenID authority integration in a non-effecting/evidence-only mode. Do not use a demo or a passing subset as a substitute for the full gate.

## 7. Qualification and CI constraints

### Free-tier AWS

Use the existing disposable AWS Free-plan development environment only when necessary and only after checking its current state and cost/stop safeguards. Preserve existing workloads and state. No paid resources, overages, or unbounded instances. Stop only the disposable test resources created for this task; do not delete shared resources. Never place credentials, customer data, private keys or database dumps in Git, logs, command history or the handoff.

Earlier delegated-use AWS qualification passed 210 Rust tests and 14 gates; it does not qualify the current Rifare integration, production database roles, live provider, or real commerce effects.

### CI and spend

- ElevenID GitHub Actions monthly quota was reported exhausted on Nov 20. User budget preference is $0; do not enable paid minutes or overages.
- Prefer local tests and free-tier bounded qualification. Do not alter billing/budget settings to make CI green.
- Some Marty/ElevenID CodeQL and policy checks have failed historically. Recheck current exact candidate status and logs.
- Open-source policy, Helm chart-contract, Rust self-hosted service tests, and CodeQL findings were among previously reported failures. Do not waive, suppress or mislabel them without a documented security/owner decision.
- Use normal PR review and merge safeguards where possible. If hosted checks are blocked by quota, record that fact and the exact local evidence; do not claim hosted CI passed.

## 8. Rifare repository instructions and known status mismatch

The current `development` branch contains `AGENTS.md` and strict project governance. Follow them.

Important rules from `AGENTS.md`:
- One writer per assigned branch/worktree.
- Discover actual Git/worktree paths; do not assume `.git` is a directory.
- Do not introduce a worker scheduler, registry daemon, custom Git wrapper or mandatory model provider.
- Scope changes, paid/production operations, remote publication, account administration and release tags need separate authorization.
- No secrets, customer data, model keys, database dumps or generated evidence in Git.
- Behavioral tests first or targeted fault demonstrations; do not weaken tests or hide skips.
- Development check passes are not full regression, goal acceptance or product qualification.
- Only the delegated maintainer may record formal acceptance under the actual owner instruction.
- Canonical active planning is in `planning/goals.json` and `planning/milestones.json`; generated views must be rendered and checked. Work records belong in `work/records/` and acceptance ledger in `work/accepted-goals.json`.

Current architecture/status documents on `development` still describe a previous state in which M15 remote trust-profile work is missing and the target PostgreSQL/React application remains open. Later delegated-commerce feature branches may add new implementation beyond that documented snapshot. Reconcile code, tests, docs and planning. Do not silently treat old architecture prose as proof that the later branches do not exist; equally, do not treat branch existence as proof of acceptance.

The root README states the local synthetic preview is runnable, production qualification is open, and the recorded local commerce checkpoint is M20-G03. Existing demos are synthetic and do not move money. The current next local commerce increment is M20-G04, but that is separate from the delegated-commerce integration and must not distract from the assigned work.

## 9. Recommended Codex execution sequence

### Phase A — recover and protect

1. Inspect host repo/worktrees/remotes/status and record exact SHAs.
2. Fetch every listed branch; fetch Marty/ElevenID refs only if needed to inspect interfaces/contracts.
3. Produce a branch graph: parent/stack relationships, shared commits, patch equivalence, overlapping paths, and branch-specific commits.
4. Identify all local-only/unpushed commits and changes from the other worker. Preserve them.
5. Identify the exact current COMMERCE-OPERATION-01 packet and acceptance authority.

### Phase B — integrate in dependency order

1. Integrate and qualify Medusa commerce primitives and cart context.
2. Integrate Supabase authentication/OIDC without conflating it with delegated authority.
3. Integrate the operation journal and currentness/idempotency/recovery model.
4. Integrate RCG4B native START, command claim/consumer/HTTP, internal mTLS and public managed caller in their actual dependency order.
5. Integrate RCG5 checkout and receipt review after their prerequisites.
6. Reconcile any separate native checkout/receipt branches and earlier commits without duplicating features.
7. Keep all protected effects disabled until COMMERCE-OPERATION-01 passes.

Do not blindly merge by branch age or commit count. Prefer a coherent integration branch with small, reviewable merge steps, preserving all source refs until the result is proven.

### Phase C — prove behavior

1. Run the exact targeted test sets for each integrated subsystem.
2. Run the canonical development test command described in `docs/DEVELOPMENT.md`; inspect the plan and selected files.
3. Add/execute fault cases for stale/revoked/expired authority, changed cart terms, wrong merchant/store/customer, invalid issuer/audience/nonce/lifetime, replay, mTLS failure, provider timeout, worker crash/restart, lost response and reconciliation.
4. Verify exact candidate SHA and config for every report.
5. Run the full COMMERCE-OPERATION-01 acceptance suite; retain failures and skipped cases.
6. Only after acceptance, enable the smallest authorized non-production integration path. Never enable live money movement or production provider effects without explicit separate authorization.

### Phase D — documentation and handoff

1. Update `docs/ARCHITECTURE.md`, `docs/PROJECT-STATUS.md`, `docs/QUALIFICATION.md`, and relevant integration guides to match actual landed source.
2. Update canonical planning inputs and generated views only when the owner-authorized work scope is accepted.
3. Add a concise work record with source SHAs, tests, failures, independent reviews and outstanding risks.
4. Publish branches/PRs only within the existing authorization and CI budget.
5. Leave the next Codex handoff with exact current branch, commit, remaining blockers and reproducible commands.

## 10. Commercial showcase acceptance targets

The goal is a credible, usable, transferable merchant SaaS—not a repository-only demonstration.

Priority product proof:
1. Returns/exchanges and refund recovery: demonstrate “Own what happens after checkout.”
2. Delegated commerce: agent purchases the $68 desk lamp under an $80 authority ceiling.
3. Refusal demonstrations: over-limit, changed terms, revoked/expired authority, invalid/stale evidence and lost-response/replay.
4. Merchant control: visible approvals, budgets, operation journal, provider status and reconciliation.
5. Deployment and transfer: public usable deployment, account creation, merchant onboarding, connector setup, cost/usage evidence and documented handover.
6. Capability labels must distinguish **synthetic**, **implemented**, **verified**, **planned**, and **production-qualified**. Never advertise fixture behavior as live capability.

Sale strategy recorded in project context: Acquire.com primary marketplace, Flippa fallback. Rifare must remain independently transferable; ElevenID protocol IP and recurring subscription remain with ElevenID.

## 11. Completion report required from Codex

When handing back, report:

- Exact current `development` SHA and integration branch/PR.
- Every source branch integrated, deferred or rejected, with reason and source SHA.
- Local-only/unpushed changes preserved and where.
- COMMERCE-OPERATION-01 result with exact candidate, complete case denominator, failures and skips.
- Test/qualification results separated into local synthetic, real-provider, AWS and hosted CI.
- Confirmation that checkout/payment/protected effects remain disabled unless the gate passed and separate authorization exists.
- Current ElevenID/Marty dependency contract and any API gaps.
- Remaining security/CodeQL/service-role/network/key-rotation/recovery blockers.
- Updated architecture/status/qualification docs and next bounded milestone.

**Do not report “complete” merely because branches merge or unit tests pass.**
