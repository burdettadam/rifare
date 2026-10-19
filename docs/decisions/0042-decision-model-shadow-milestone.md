# ADR-0042: Additive roadmap and M13 decision-model shadow development

## Prior authority and protected source

The owner requested “Proceed with next goals until next milestone.” Under the
retained delegation in ADR-0004, the maintainer adopts the separately supplied
M13–M22 planning handoff and assigns **only M13-G01 through G05 and the M13-G99
assessment** for local development. The protected source is
`9228d16b3d4c6ea3274c452c8cd1cddaf0d2ca5a`, tree
`19fd2d9e88582956a9dcbb1c9bc96468dd20a528`. The preceding cumulative archive is
`Rifare-M12-agencies-extensions.zip`, SHA256
`9788496f5c6b1012cccf6e192a8f4772e4abf19a1d42dc691a3f1ac3bfb25e6b`.

The roadmap archive is `Rifare-Milestone-Handoff-2026-10-18.zip`, SHA256
`e031a818673ce8bc9748b9a8e6d83da3b91bd451d64357136e8db0b2ae581e7e`; its
`milestone-additions.json` is
`e93bb4581a8e2930f821ddadc423df81be298f96d7b4ae0a6ef87c96e28513dc`.
Its M08 source reference is historical, not permission to replace current M12.
The archive and research ledger remain outside application source. This commit
records the control decision before changing the planning validator or product.

## Exact additive planning contract

Preserve every original reference file, all 203 goal objects/cards, 13 milestone
objects/cards, 151 source requirements, 676 test specifications and the accepted
goal ledger. Append ten milestones, sixty goals, fifty requirements and 204
specifications, retaining their origin IDs, criteria, faults and dependencies.
Map the handoff assessment type to the canonical `milestone_acceptance` type and
retain its origin type. Retain prior formal milestone gates as prerequisites;
available diagnostic code permits local preparation, not formal acceptance.
Future M14–M22 work remains unassigned. M12-G08/G09 refinements are additive
cross-references, leaving their original objects, human decision and disabled
outcome unchanged.

The separately frozen source is
`reference/additions/m13-m22-requirements.json`, SHA256
`0d4218fabd39eeb1328de5a3d1f79cc620967ef761a6dc4a405ec403a280d7b2`.
The validator must enforce the exact union of the original 151 requirements and
these pinned fifty additions, with unique IDs and unchanged acceptance criteria.
It must reject modified frozen bytes, unknown additions, collisions and omissions;
it must not relax original equality to a subset test. The renderer may update
aggregate counts and distinguish original from adopted requirements, while
retaining original generated goal/milestone bytes. Canonical planning status stays
`not_started`/`not_run`; actual observations belong in work records and evidence.

## Ownership and concrete scope

Native Git worktrees, source commits, bounded verification, two independent
nonauthor reviews, local nonrelease integration and cumulative packaging are
assigned. Root alone runs product imports, tests or demonstrations. Authors and
reviewers execute zero product code. No paid inference, deployment, external
publication, account changes, messaging, release tags or business effects are
assigned. No scheduler, provider registry daemon or mandatory hosted service is
needed. No review exception is adopted.

| Writer | Assigned files and goals |
| --- | --- |
| Decision author | G01/G03: new `packages/agent/{decisions,workers-ai}.mts`, `packages/agent/contracts/decision-model.v1.json`, `tests/development/decision-model.test.mts`, `tests/fixtures/decision-model/`, `docs/DECISION-MODELS.md`, and G01/G03 work records. |
| Root | G02/G04/G05: new `packages/commerce/{decision-resources,decision-shadow}.mts`, `packages/agent/decision-evaluation.mts`, `packages/commerce/contracts/decision-shadow.v1.json`, `packages/commerce/skill-bundles/return-intake-shadow/`, `tests/development/{decision-shadow.test,decision-shadow-helpers}.mts`, `tests/fixtures/decision-shadow/`, documentation and remaining M13 records. Root owns shared planning, additive metadata, integration corrections after handoff and ignored evidence/packaging. |

Root may update `README.md`, `PLANS.md`, `tools/{validate_plan,render_plan}.py`,
`tests/test_plan_tools.py`, canonical planning JSON and generated aggregate views,
and append new goal/milestone cards. Root may maintain exact current hashes and
additive coverage in `planning/{component-inventory,regression-registry}.json`,
`packages/commerce/contracts/privacy-storage-surfaces.v1.json` and
`tests/fixtures/licensing/artifact-oracle.v1.json`. If a declared conformance
entry is needed, additive entries in `tests/fixtures/conformance/` and exact
count/hash maintenance in the retained privacy, portability, installation,
adapter-catalog and compatibility-matrix files are permitted without changing
old case identities, assertions or thresholds. Any other old runtime change needs
a concrete prior maintainer scope amendment.

## Runtime boundary

Add a provider-neutral decision sibling beside `ModelStep`; retain the existing
generative runner, provider semantics and local model behavior. Logical requests
contain task/question IDs, bounded text, finite questions and an opaque serving
configuration reference. Account IDs, model allowlists and credential references
belong to trusted server configuration. Exact question/option/type membership,
finite distributions and documented rounding tolerances determine usability.
Unknown business-action fields are rejected. Confidence is provider-reported
metadata, never permission, calibrated certainty or a routing decision.

Use a new versioned resource in the existing checked skill archive and typed
profile composition. Two profiles may select declared vocabulary variants using
existing presentation fields; canonical answer IDs and required evidence remain
fixed. No merchant-ID branch, new global profile default or reinterpretation of
existing profile/case hashes is permitted. Disallowed rubric overrides fail.

Build snapshots from current `CaseConfigurations`, `ReadContext` task/source and
resource authorization, preserving customer claims separately from source facts
and explicit gaps. The task must resolve to the same case resource/profile/skill.
Hash the complete submitted evidence and preprocessing/question/configuration
versions. Required text is never silently truncated. Attachments, signed media
URLs and evidence marked `model_access:false` remain excluded. A conservative
encoded-byte limit is a safety bound, not live tokenizer qualification.

Use the existing `SecretVault` reader and `ModelBudgets` reservation path. The
optional text-only transport has a fixed approved account/model destination,
redirect rejection, finite deadline and response bounds. Live calls remain denied
by default; synthetic wire transports carry immutable fixture provenance. Recheck
current permissions, stop generation, case/task/source/configuration pins and
credential validity around asynchronous dispatch; late revoked or changed work
cannot produce a usable receipt. Missing usage retains the reserved maximum.
No automatic retries or unapproved fallback occur.

Store minimized observations in the existing `commerce_assistance_receipts`
linked to the actual `commerce_context_tasks` resource. Existing privacy export,
erasure, restore suppression and uninstall therefore retain ownership. Store
hashes, normalized answers, provenance, gaps and failure status, not raw submitted
customer text, keys, headers or provider errors. Replaying an observation is a
current-authorized read; fresh inference uses a distinct observation identity.
Shadow results never change case assignment, published policy, approvals, money,
inventory or settlement. The existing manual return workflow remains available.

## Frozen evaluation, verification and claims

Commit the evaluation protocol/reference cohort before implementation outputs are
examined. Include clear, mixed, unknown, corrected, hostile and profile-specific
strata, reference labels, manual baseline, metrics, exclusions and development vs
held-out roles. Reports separate fixture classification, actual model inference,
correct review, wrong classification and business effects with exact denominators.
Reject fixture-to-live relabeling. Routing thresholds and activation belong to M14.

Tests and independent fixtures precede implementation. The planned native
selection is the two new whole test files plus retained privacy coverage and
support-provider routing, at most **60 actual cases, four whole files and one
total 60-second deadline**. If shared skill validation becomes necessary, replace
the routing file with the affected skill-contract file and reduce the new-case
budget accordingly. Root runs the coherent candidate once and repeats only an
affected or not-yet-run file for a concrete failure or consequential correction.
Retain every actual invocation/failure; helper checks never stand in for product
tests. No broad regression, browser, controller, catalog or restore campaign is
triggered by local milestone assessment.

Two fresh nonauthor authority/security and regression reviews bind exact source
and actual evidence. Protect 1,589 paths, 2,968 test-registration objects, 194
capabilities, 482 protected-file objects, 262 tables, 46 migrations, eleven storage
contracts, fifteen privacy surfaces and 289 runtime source pins. Preserve all
previous claims, tests, fixtures, history and archive bytes. No schema migration
is needed for this assignment.

M13-G99 may correctly remain blocked. Local shadow behavior, hosted compatibility,
live quality/latency/usage/cost and inherited PostgreSQL/React/security/formal
product gates are separate observations. An honest local integration decision
does not mark original worker acceptance or formal M13 acceptance complete.
