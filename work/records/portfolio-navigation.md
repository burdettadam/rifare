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

Pending the exact integrated candidate. Record focused results and independent
review decisions here before handoff. Raw output belongs in ignored
`evidence/portfolio-navigation/`.
