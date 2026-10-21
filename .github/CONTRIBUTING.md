# Contributing to Rifare

Contributions are welcome under the [applied component licenses](../LICENSE-STATUS.md).
Use the license of the affected file and certify your submission under
[DCO 1.1](DCO.txt). Contributors retain their rights; this is not a copyright
assignment or a grant of commercial relicensing authority.

Discuss a proposed change in an issue before taking on a substantial feature.
Keep a pull request focused, explain its user-visible effect and verification,
and preserve the development-preview and production-qualification boundaries.

If you can make the DCO certification, sign off your own commits with `git commit -s`
using your configured name and email. Check employer, third-party, and AI-assisted
source provenance before certifying it. Do not sign another person's or an
assistant's work on their behalf, and do not add retroactive signoffs to earlier
project commits. A maintainer may request provenance details before accepting a PR.

For authorized development, read `AGENTS.md`, use one assigned goal and an isolated
worktree, and preserve existing regression contracts. For routine feedback run
`python3 tools/dev_tests.py` (or `make test`), following the bounded profile in
`docs/DEVELOPMENT.md`. Use focused review and additional checks only for a concrete
remaining risk. Full regression and formal acceptance reviews belong to an
explicit integration, milestone or release checkpoint; retain their original
exact-candidate, failure-proof and independent-review requirements.

New source files must be assigned explicitly in `planning/component-inventory.json`.
Declare actual origins, licenses, attributions, dependencies and modified upstream
material. Do not classify copied code as original or infer that generated output is
unencumbered. Existing required notices and synthetic examples are protected.

Never commit private merchant settings, credentials or raw review evidence. Read
[the merchant data boundary](../docs/MERCHANT-DATA-BOUNDARY.md). Change canonical planning
inputs and regenerate views rather than editing only a generated goal card. No author
self-acceptance or unapproved publication.
