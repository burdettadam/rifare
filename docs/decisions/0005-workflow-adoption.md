# ADR-0005 — Adopt native, model-neutral goal development

Decision: adopt the checked-in v0.2.1 instruction adaptations and native Git/Python
workflow under ADR-0004. Governing base: `39aa37cb38df3aec27131baa8e1a4263b187d067`. This decision does not install
a global initializer or require a named agent client/provider.

Use one writer per native worktree. Assign two independent review roles, with
three maximum corrective rounds. Preserve source/base/configuration binding and
require explicit candidate-specific human approval for versioned public releases.
Use the documented bootstrap exception only for local development integration.
Record actual reviews as missing when unavailable, not as an author-created pass.

The read-only workflow checker is an explicit completion check inside the existing
work-goal loop. It adds no scheduler, worktree wrapper, model adapter or task service.
Its trust boundary is the independently supplied base and attestation inputs.
Candidate-owned JSON, checksums or reviewer names are not authentication.

M00-G04 validates instructions, native worktree behavior, evidence binding and
synthetic fixture isolation. Product runtime isolation remains M00-G05. Host/client
discovery is reported only for actually executed configurations; no installed
client is present here. Native commands remain usable without one.

The source inventory grows by named code/doc/fixture paths, with old obligations
and synthetic merchant bytes unchanged. Existing goal/specification/benchmark
oracles remain untouched. Any later source/control change must retain this
behavioral coverage or supply an authorized replacement without weakening it.
