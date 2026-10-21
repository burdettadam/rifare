# ADR-0066 — Publication-readiness work and Codex handoff

Status: authorized before implementation.
Base: public development commit `fb6de58fd111ccada5f9870196d139d97209d5d4`.

## Owner instruction

After a live repository review identified licensing inconsistencies, missing
runtime demonstration media, no public CI execution, dense source formatting,
and stale repository guidance, the owner instructed:

> I approve the needed changes. make them and give me the git passoff to hand to codex

This authorizes the bounded publication-readiness work described below. The
prior license direction remains AGPL-3.0-only for application code, Apache-2.0
for separable interfaces/skills and original developer material, and retained
MIT terms and notices for the identified upstream adaptations.

## Assigned work

- Apply the selected terms to the covered project material with explicit scope,
  authentic license texts, retained third-party notices, and current contribution
  guidance. Preserve the original proposal as historical evidence; do not
  represent historical null fields as the current decision. Do not invent rights
  over third-party material, legal clearance, or anyone's DCO signoff.
- Record an actual synthetic runtime demonstration, keep its source and result
  traceable, and show it near the top of the README. Preserve the existing demo
  output and its clear fixture, quotation, settlement, and provider boundaries.
- Add a bounded, read-only GitHub verification workflow for documented demos and
  focused checks on pushes/pull requests. Keep the broader manual diagnostic
  available and retain existing regression and release obligations.
- Format selected central modules without changing behavior, and provide a
  reproducible formatting command isolated from the offline demo installation.
- Update stale delivery/status wording and prepare exact repository-profile
  settings and a verified Git bundle/patch for Codex to import.

The work is assigned as `PUBLICATION-READY-01`. The primary maintainer owns
integration and the handoff; each worker has an isolated native Git worktree.
Independent authority/scope and regression review remain required. Routine tests
stay bounded; a demo, formatter, or helper pass does not accept a product goal.

## Boundaries

This approval does not assert production readiness, qualified connected services,
real merchant outcomes, a completed React/PostgreSQL application, or browser
inference. It does not authorize publishing the LinkedIn article, creating a
release/tag, incurring paid effects, or changing accepted product thresholds.
The requested deliverable is a local Git handoff. Codex will apply the reviewed
branch and observe remote checks/settings using its authorized GitHub access.
