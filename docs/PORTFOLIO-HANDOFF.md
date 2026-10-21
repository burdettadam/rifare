# Rifare portfolio presentation handoff

## Scope

This refresh makes the public repository easier to understand and demonstrate:
an original logo and artwork, a product-first README, exact local demo instructions,
and a concise current-status guide. It is based on imported development checkpoint
`c299065241b3bdf4928a83f9ff4decf749c6afaa` (M20-G03).

The working branch is `docs/portfolio-branding`. The change is limited to
documentation, image assets, the source-file inventory, and its work record.
Runtime behavior, tests, dependencies, licensing policy, milestones, and acceptance
records are preserved.

## Review and apply

Review the presentation branch or its pull request against `development`, the
repository's default and current development line. `main` remains the older
baseline. The source history is retained; an older README is available at the
base commit.

After the presentation branch is available from `origin`:

```sh
git fetch origin
git switch --track origin/docs/portfolio-branding
git diff origin/development...HEAD --stat
```

If the branch already exists locally, switch to it instead of creating another
tracking branch. If `development` has progressed, review the actual comparison
and preserve its new work before integration. Merge through the normal repository
review path when ready. This handoff does not create a release or deploy a service.

## Files to use

| Purpose | File |
| --- | --- |
| Repository landing page | [README](../README.md) |
| Run a local demonstration | [Try Rifare](TRY-RIFARE.md) |
| Interpret available features and open work | [Project status](PROJECT-STATUS.md) |
| Reuse the identity and artwork | [Brand guide](BRAND.md) |
| Upload the repository social preview | [rifare-social.jpg](assets/rifare-social.jpg) |
| Continue the art direction | [Image prompts](assets/PROMPTS.md) |
| Inspect this change's verification | [Presentation work record](../work/records/portfolio-presentation.md) |

## Repository profile copy

Suggested **About** description:

> Merchant-owned commerce after checkout. Returns, exchanges, support, and reverse logistics with optional agents. Development preview.

Suggested topics:

`commerce`, `returns-management`, `reverse-logistics`, `typescript`, `nodejs`,
`workflow`, `ai-agents`, `merchant-tools`

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
[current status](PROJECT-STATUS.md), [development](../DEVELOPMENT.md), and the
[M20 record](../work/records/M20-dropoff-milestone.md).
