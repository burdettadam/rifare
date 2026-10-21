# Rifare portfolio presentation handoff

## Scope

This refresh makes the public repository easier to understand and demonstrate:
an original logo and artwork, a target-focused product README, exact local demo
instructions, a concise current-status guide, a simpler repository root, and
an active development plan with landed implementation instructions retired.
It is based on imported development checkpoint
`c299065241b3bdf4928a83f9ff4decf749c6afaa` (M20-G03).

The working branch is `docs/portfolio-branding`. The README now presents six
connected target capabilities, a customer journey, and the architectural choices
that keep the merchant in control. Target scope is clearly distinguished from the
runnable development preview.

The navigation refresh reduces ordinary root entries from 32 to 17, including
seven root files. Detailed guides now live in `docs/`; goal catalogues, generated
cards, frozen references, templates, and project metadata live in `planning/`.
Contributor/security policies live in `.github/`, and development rubrics live in
`.agents/rubrics/`. The [documentation index](README.md#repository-map) explains
the layout and the [planning index](../planning/README.md) provides the new paths.

Path references, generated views, source inventories, and affected helper loaders
and test locators follow the moves. Application behavior, behavioral assertions,
dependencies, licensing obligations, requirement criteria, historical workflow
policy, and acceptance records are preserved.

## Active-plan cleanup

The owner subsequently requested retirement of goals and milestones whose code
has landed. The catalogue now contains **55 active packets**, down from 281,
plus **27 concise integration follow-ups** for missing real adapters. Ten packets
are narrowed to their unfinished portions; 13 milestone/follow-up sheets remain
instead of 26. The cleanup deletes 244 source files and adds three concise
qualification/decision/work records, reducing the source inventory to 1,683.

The [architecture](ARCHITECTURE.md) maps current source through M20-G03. The
[current plan](PLANS.md), [roadmap](ROADMAP.md), and
[qualification guide](QUALIFICATION.md) replace stale bootstrap directions and
the chronological active-plan diary. Completed packet text remains in Git. All
949 behavioral specifications, 216 requirement mappings, 57 target identities,
284 native development test files and 3,292 prior test registrations are retained.
Two focused plan-helper tests are added.

The [cleanup record](../work/records/planning-retirement.md) contains verification
and review status. The focused 60-test selection passed, as did plan generation,
links, workflow, distribution and whitespace checks. Original active criteria,
formal dependencies, release thresholds and acceptance records remain unchanged.

Independent authority/scope and regression reviewers approved cleanup candidate
`006bde5a4d799f745caff34d6bbf17783199f8bc`. Their one continuation finding was
resolved by documenting how a compact integration entry becomes a bounded packet
before the existing evidence workflow uses it. The final documentation commit
records those reviews without changing runtime behavior or planning contracts.

**Delivery state:** the completed changes are committed locally. The GitHub
connection rejected its write request with HTTP 403, `Resource not accessible by
integration`; no remote presentation branch or pull request was created. The
downloadable handoff contains the Git bundle, binary patch, changed files, and
exact import/push commands. Use the bundle from an existing clone containing
the base commit to retain the authored commits.

## Review and apply

Review the presentation branch or its pull request against `development`, the
repository's default and current development line. `main` remains the older
baseline. The source history is retained; an older README is available at the
base commit.

To import the supplied bundle from your existing Rifare clone, replace the path
with the location where you extracted the handoff:

```sh
git status --short
git bundle verify /path/to/Rifare-portfolio-branding.bundle
git fetch /path/to/Rifare-portfolio-branding.bundle refs/heads/docs/portfolio-branding:refs/heads/docs/portfolio-branding
git switch docs/portfolio-branding
git push -u origin docs/portfolio-branding
```

Start with a clean worktree. If the presentation branch already exists locally,
inspect it before updating it; do not force an existing ref. The bundle requires
the base development commit and does not include a second full repository copy.

After the presentation branch is available from `origin`, another worker can use:

```sh
git fetch origin
git switch --track origin/docs/portfolio-branding
git diff origin/development...HEAD --stat
```

If the branch already exists locally, switch to it instead of creating another
tracking branch. If `development` has progressed, review the actual comparison
and preserve its new work before integration. Merge through the normal repository
review path when ready. This handoff does not create a release or deploy a service.

## Verification and integration notes

The target-positioning and layout candidate passed 28 focused repository/planning
tests plus repository links, generated views, planning preservation, workflow,
distribution inventory, and whitespace checks. Two independent reviewers approved
the candidate. The [navigation work record](../work/records/portfolio-navigation.md)
binds these results to the exact commit and preserves the review findings.

Two boundaries remain explicit for the next integration owner:

- The release-benchmark document check has the same support-envelope coverage
  failure on the original development checkout: 44 historical dispositions do
  not cover the expanded 57-target catalogue. This presentation change does not
  waive or repair that separate planning gap.
- The trusted full regression gate compares exact historical source paths. Its
  old pinned baseline needs a reviewed path migration for the 337 renames; the
  external handoff includes `RELOCATIONS.json` and the retirement manifest.
  Retired packet contracts now resolve through the retained behavioral
  specifications. This task preserves the controller and its baseline and does
  not claim a full-gate pass.

## Files to use

| Purpose | File |
| --- | --- |
| Repository landing page | [README](../README.md) |
| Run a local demonstration | [Try Rifare](TRY-RIFARE.md) |
| Interpret available features and open work | [Project status](PROJECT-STATUS.md) |
| Navigate the repository | [Documentation index](README.md) · [Planning index](../planning/README.md) |
| Reuse the identity and artwork | [Brand guide](BRAND.md) |
| Upload the repository social preview | [rifare-social.jpg](assets/rifare-social.jpg) |
| Continue the art direction | [Image prompts](assets/PROMPTS.md) |
| Inspect this change's verification | [Presentation work record](../work/records/portfolio-presentation.md) |
| Review the target-positioning and layout follow-up | [Navigation work record](../work/records/portfolio-navigation.md) |

## Repository profile copy

Suggested **About** description:

> Merchant-owned commerce operations. Returns, exchanges, service, fulfillment, loyalty, and growth—with portable workflows and optional AI. Development preview.

Suggested topics:

`commerce`, `returns-management`, `reverse-logistics`, `customer-support`,
`inventory-management`, `typescript`, `workflow`, `ai-agents`, `merchant-tools`

Use the repository URL for the portfolio link until a separately verified hosted
demo exists. The README provides local commands; this update creates no public
application URL.

## Social preview and pinning

In the repository's **Settings → General → Social preview**, upload
`docs/assets/rifare-social.jpg`. It is an opaque 2:1 image below 1 MB. GitHub's
[social-preview guide](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/customizing-your-repositorys-social-media-preview)
documents the accepted formats and upload location.

From your profile, use **Customize your pins** and select `rifare` after integrating
the presentation change; see GitHub's
[pinning guide](https://docs.github.com/en/account-and-profile/how-tos/profile-customization/pinning-items-to-your-profile).
These profile and repository settings are separate from
the committed source. The suggested description, topics, uploaded social preview,
and profile pin should be checked in GitHub when preparing the portfolio link.

## Next substantive product work

Continue with the recorded M20-G04 consolidation and custody-continuity goal under
its own assignment. For portfolio demonstrations, the next major improvement is
qualifying the intended application stack and a real served product tour.
The presentation work does not change those existing obligations. See
[current status](PROJECT-STATUS.md), [development](DEVELOPMENT.md), and the
[M20 record](../work/records/M20-dropoff-milestone.md).
