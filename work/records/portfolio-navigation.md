# Portfolio product positioning and repository navigation

## Assignment

The owner explicitly requested that the README advertise targeted functionality
more strongly and that the GitHub root contain fewer files, reducing scrolling
and complexity for new visitors. This extends the earlier authorized presentation
work; it does not assign new commerce behavior or change product acceptance.

Base: `a23c7ea5d26462e978522d79c98989f68b662a0e`.
Integration branch: `docs/portfolio-branding`.
Root writer: `/root`, isolated `rifare-branding` worktree.
README writer: `/root/target_readme`, separate `docs/target-product-readme` branch.
Independent reviewers: `/root/scope_review` for authority and claims;
`/root/layout_audit` for regression and relocation preservation.

## Decisions

- Lead the README with six connected target product areas and merchant ownership.
  Keep availability explicit through one target-scope label, a runnable preview,
  and the existing current-status guide.
- Keep seven ordinary root files: README, AGENTS, license status, third-party
  notices, Makefile, package.json, and package-lock.json.
- Consolidate root goal catalogues, goal and milestone cards, reference inputs,
  templates, and project metadata under `planning/`.
- Move architecture, roadmap, development, governance, and progress prose into
  `docs/`; move contributor/security policies into `.github/`; move development
  rubrics into `.agents/rubrics/`.
- Add documentation and planning indexes. Keep application paths, commands,
  canonical planning JSON, historical acceptance records, and agent entry-skill
  discovery paths stable.

## Preservation

Relocations use native Git. Frozen reference inputs, licensing obligations,
third-party notice bytes, the historical workflow policy and acceptance ledger
remain unchanged. Historical decision prose retains its original path names;
clickable links point to the current locations.

Current path fields in the component and regression inventories, generated
views, helper loaders, and helper-test locators follow the moves. Existing test
assertions and source requirement criteria remain intact. The two workflow skill
digests are refreshed for their path-only instruction changes; the pilot protocol
refreshes only the digest of its benchmark loader after the reference-path move.

No application logic, product-test behavior, dependencies, accepted goal states,
license grants, review rules, or release thresholds are changed. This is a local
presentation and navigation checkpoint, not product acceptance or publication.

## Verification and review

The layout is committed as `0cfc48e`; the independently authored README
`407ba01` is integrated as `08e5ef2`. Its link-only merge conflict was resolved
by retaining the exact target-focused README. The documentation-index link
and current-status pointer are a subsequent navigation refinement.

Exploratory repository, generated-view, plan, workflow, and distribution checks
passed. The distribution inventory contains 1,924 source files. The count
fixture is refreshed through its existing additive count fields; component IDs,
release blockers, case bindings, and all other protected values stay unchanged.

The release-benchmark document check still reports
`capability_disposition: target coverage must retain every original target`.
The same command produces the same failure on the unchanged imported
`c299065` development checkout: its earlier support-envelope target coverage
does not include the expanded capability catalogue. This pre-existing product
planning inconsistency is recorded, not hidden or waived by the layout work.

### Exact-candidate results

Reviewed candidate: `acedc26a49ae74f55b8145361d48799c929714bc`.
Tree: `d6aca57c64626283ad5c463f2a4b1ede7066c817`.

Repository/link, generated-view, planning, workflow, distribution, and whitespace
checks all passed. One bounded invocation ran `test_repository` and
`test_browser_plan_adoption`: **28 tests passed in 9.383 seconds**, with no skips
or failures. No product suite or full regression gate was run. The planning check
retains all 216 requirements, 949 specifications, 281 goals, and 67 original
scenarios. Raw output and the candidate binding are in ignored
`evidence/portfolio-navigation/verification.json` and neighboring logs.

Both independent nonauthor reviewers approved this exact candidate with no
material blocker for the presentation/navigation scope:

- `/root/scope_review` verified target/current claims, authority boundaries,
  license and notice preservation, all frozen reference bytes, component metadata,
  relocated registry paths, and the refreshed instruction/control digests.
- `/root/layout_audit` verified all 337 Git renames, exact inventory membership,
  unchanged behavioral specifications and 3,292 test registration objects, all
  284 unchanged development-test files, frozen inputs, controls, and the actual
  focused-check report. It independently confirmed the earlier benchmark gap.

### Full-gate path migration boundary

The trusted regression controller intentionally compares exact historical paths
and capability contract locations. An older pinned baseline will flag these
authorized renames. A future integration owner must review the supplied relocation
map when migrating that baseline; this task neither rewrites the independently
retained baseline nor weakens the controller. Independent preservation review
and focused helper checks here are not a claim that the full gate passed.

The final closure updates documentation only. Application code, tests, generated
views, inventories, policies, and reviewed digest pins remain those of the exact
candidate above. Remote retention is still blocked by the previously recorded
GitHub integration write restriction; the updated bundle is the handoff path.
