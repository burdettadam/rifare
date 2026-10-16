# Licensing regression oracles

All fixtures are source-only and synthetic; no private merchant data or credentials
are included. `expected-policy.v1.json` freezes the proposed decision surface and the
exact reviewed examples, not legal acceptance. `retained-obligations.v1.json` preserves
upstream notice digests, component classifications and external-reference boundaries.
`artifact-oracle.v1.json` contains independently declared expectation counts and IDs.

The tests create isolated temporary Git checkouts/stages and inject missing notices,
unknown licenses, omitted files, private profiles and malformed candidate inputs.
They must report behavioral rejection; no network, package install or actual release
is involved. A missing final license decision must remain a public-release blocker.
Changing an oracle requires prior-control review, not only a candidate version bump.
