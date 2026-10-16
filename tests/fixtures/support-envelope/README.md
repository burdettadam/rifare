# M00-G01 independent expected fixtures

These fixtures are synthetic and do not assert project acceptance or connected qualification.
`scenarios.json` declares expected labels and stable capability IDs independently of the
resolver. `baseline.SYNTHETIC.json` models a previously retained contract only to test
regression comparison. It is not the protected project baseline and must never be promoted
by a worker as evidence that a human accepted the charter.

The primary test bindings are in `tests/test_support_envelope.py`. Changes to these
oracles need independent review. An updated fixture cannot approve its own regression.

`expected-proposal.v1.json` retains the complete 38-row proposed contract as a
regression oracle. It is not an accepted baseline. Do not regenerate it with the
normal plan renderer or update it merely to make a changed scope pass. The owner
and independent reviewer must review any proposed change to this fixture. Its
comparison is defense in depth, not a substitute for an externally trusted baseline.
