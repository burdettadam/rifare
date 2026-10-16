# Contributing to Rifare

External contribution intake is not open while the owner license decision remains
pending. [The M00-G03 proposal](docs/LICENSING.md) describes component-scoped inbound
terms and a possible DCO 1.1 process; neither is adopted by this document. No
copyright assignment, commercial relicensing authority or retroactive signoff is
assumed. Do not sign another person's or an assistant's work on their behalf.

For authorized development, read `AGENTS.md`, use one assigned goal and an isolated
worktree, and preserve existing regression contracts. Run `python3 tools/verify.py`.
Submit exact-candidate evidence, meaningful failure proof and independent reviews.

New source files must be assigned explicitly in `planning/component-inventory.json`.
Declare actual origins, licenses, attributions, dependencies and modified upstream
material. Do not classify copied code as original or infer that generated output is
unencumbered. Existing required notices and synthetic examples are protected.

Never commit private merchant settings, credentials or raw review evidence. Read
[the merchant data boundary](docs/MERCHANT-DATA-BOUNDARY.md). Change canonical planning
inputs and regenerate views rather than editing only a generated goal card. No author
self-acceptance or unapproved publication.
