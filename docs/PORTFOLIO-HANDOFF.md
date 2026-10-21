# Publication-readiness handoff

The earlier identity, product README, root reorganization, and planning retirement
are public in [PR #1](https://github.com/burdettadam/rifare/pull/1), merged at
`fb6de58fd111ccada5f9870196d139d97209d5d4`. That is the base of this follow-up.
The earlier connection failure and local-only delivery statements describe the
prior handoff, not the current public repository.

The owner approved this follow-up in [ADR-0066](decisions/0066-publication-readiness.md).
It applies the selected license terms, records a real synthetic recovery demo,
adds bounded public CI, formats selected central modules, and updates the public
guidance. Its integration branch is **`chore/publication-readiness`**.

## Apply the Git handoff

The handoff ZIP contains a full-history Git bundle, a binary patch against the
base above, a Codex task, a PR description, and checksums. Prefer the bundle to
preserve the authored commits. From a clean existing clone:

```sh
git status --short
git fetch origin
git bundle verify /path/to/Rifare-publication-readiness.bundle
git fetch /path/to/Rifare-publication-readiness.bundle refs/heads/chore/publication-readiness:refs/heads/chore/publication-readiness
git switch chore/publication-readiness
git diff --stat origin/development...HEAD
```

If the branch already exists, inspect it before updating it. Do not force an
existing branch or discard local work. If `origin/development` has advanced,
review and integrate those changes before opening the PR. The bundle also supports
a fresh clone; set its `origin` to the actual GitHub URL before remote operations.

The alternative binary patch includes only this follow-up. It is not needed after
importing the bundle. Use `git apply --check` before applying it to another tree;
never apply both delivery forms to the same branch.

## Verify the candidate and observe GitHub

The handoff records the actual local candidate, results, and independent reviews.
Do not rerun the full suite just to import an unchanged candidate. For a changed
candidate, run the narrow relevant checks documented in [development](DEVELOPMENT.md).

The **Development preview** workflow runs the offline install, checks the two
synthetic demos, and validates repository links, plan contracts, and generated
views. It has read-only permissions and
no model, credential, deployment, or release steps. The older **Rifare starter
verification** workflow remains a separate manual diagnostic. Its inherited
support-envelope and benchmark maintenance gaps remain in
[qualification](QUALIFICATION.md).

Push the reviewed branch and open a pull request against `development`. Observe
the actual hosted **Development preview** result before describing CI as passing.
Committed workflow YAML and a local pass cannot supply that observation. Preserve
any new upstream work and follow the repository's normal integration review.
This handoff does not create a release or deploy an application.

## Repository profile

Use this About description:

> Merchant-owned commerce operations. Returns, exchanges, service, fulfillment, loyalty, and growth, with portable workflows and optional AI. Development preview.

Topics:

`commerce`, `returns-management`, `reverse-logistics`, `customer-support`,
`inventory-management`, `typescript`, `workflow`, `ai-agents`, `merchant-tools`

These are GitHub settings, not files stored by Git. Codex can apply the description
and topics with the authenticated GitHub CLI/API after importing the branch.
Do not add a hosted application URL until there is a verified application to link.

In **Settings → General → Social preview**, upload
[`docs/assets/rifare-social.jpg`](assets/rifare-social.jpg). It is an opaque 2:1
image below 1 MB. The image's presence in source does not prove the setting was
saved. Verify the resulting preview. From the owner's profile, use **Customize
your pins** to select Rifare if it has not already been pinned.

## Evidence to show in the article

Start with [the recorded refund recovery](demos/README.md). It follows the actual
local code as a synthetic source accepts a refund, loses the response, and is
queried by the original operation identity. A repeated dispatch does not issue
another request. Fixture settlement is shown as a separate observation. The
exchange remains an uncommitted quotation.

The article can explain merchant-owned state, shared approvals, current authority
checks, and optional agents through this implemented example. Use the
[current license scope](../LICENSE-STATUS.md) for reuse and contribution claims.
The demonstration is not a real payment, live merchant deployment, measured model
benchmark, or proof that every target integration works.

## Important files

| Purpose | File |
| --- | --- |
| Landing page | [README](../README.md) |
| Actual recorded demonstration | [Recovery recording and transcript](demos/README.md) |
| Current license scope | [License status](../LICENSE-STATUS.md) |
| Reproduce local examples | [Try Rifare](TRY-RIFARE.md) |
| Source readability | [Optional formatter](../tools/formatting/README.md) |
| Current implementation | [Architecture](ARCHITECTURE.md) |
| Remaining product and release work | [Roadmap](ROADMAP.md) · [Qualification](QUALIFICATION.md) |
| Candidate verification and review | [Publication-readiness record](../work/records/publication-readiness.md) |

Continue product development from M20-G04 only under its own assignment. This
presentation work does not accept further product goals or replace the trusted
full-regression baseline migration already recorded in the prior handoff.
