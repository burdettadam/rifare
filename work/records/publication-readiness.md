# Publication readiness

Scope: `PUBLICATION-READY-01` under [ADR-0066](../../docs/decisions/0066-publication-readiness.md).
Base: `fb6de58fd111ccada5f9870196d139d97209d5d4` (public development, PR #1).
Integration branch: `chore/publication-readiness`.

The owner approved the targeted changes from the live repository readiness audit
and requested a Git handoff for Codex. Work covers license application and current
wording, a recorded synthetic demo, bounded public CI, source readability, and
accurate repository handoff instructions. Product functionality and acceptance
thresholds remain outside this task.

## Verification and review

The implementation adds the selected component license terms and contribution
guidance, a reproducible seven-scene recovery recording, the bounded Development
preview workflow, and optional Prettier tooling. Ten central TypeScript modules
were formatted with unchanged parsed code and comment content. The root demo
installation remains dependency-free.

The recording ran from clean commit
`b7102d3ffc121326a8475062eef9878c9b157893`, exited successfully, and retains the
original terminal events. Its GIF and MP4 hold each completed scene for four
seconds; the 28-second presentation is not a latency measurement. See
[recording provenance](../../docs/demos/manifest.json).

The source inventory contains 1,703 files. The 20 additions are explicit, including
three reproduced legal documents whose provenance is separate from original
project material. Three focused license-intake regressions extend the registry
from 3,294 to 3,297 entries; existing registrations and native test files remain.
M12-G06 now describes the remaining governance and actual-artifact review rather
than repeating the source-license application already completed. Its original
acceptance criteria and formal dependencies are retained.

A deliberate failure in an isolated checkout allowed an `unknown` refund to be
sent again. The new preview check rejected it with a runtime assertion: two send
attempts instead of one. The original source bytes were then restored. This is a
behavioral failure check, not an import or syntax failure.

Final candidate verification and independent authority/scope and regression
reviews are in progress. Their exact candidate and results will be recorded before
handoff. GitHub-hosted execution and profile settings require Codex to import and
push the reviewed branch; local checks cannot establish those remote observations.
