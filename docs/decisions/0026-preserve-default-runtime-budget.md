# ADR-0026 — Preserve the standalone bound; explicitly opt in for cumulative runs

The first complete candidate run preserved all original test sources and exposed
an additional control regression: an existing assertion requires `run()` to retain
its 240-second standalone process limit. That failed assertion remains unchanged.
The previous direct replacement of that default in ADR-0025 is superseded.

Under the same delegated local authority, keep `run()` and standalone CLI default
at 240 seconds. Add an explicit `--budget-seconds 480` opt-in, with only 240 and 480
accepted. The cumulative `verify.py --runtime` command explicitly requests 480;
the exported cumulative controller also uses 480. The 600-second parent limit is
retained. Every native test still executes sequentially, and the same zero-skip,
exact-inventory, failure and timeout rules apply. No test-dependent behavior,
automatic retry, test selection, or product performance-threshold change exists.

New independent helper tests cover both budgets, complete file selection, invalid
budgets, skips, failures, empty runs and timeout propagation. The prior standalone
contract is tested without alteration. The failed adoption attempt is retained in
the separate evidence. Formal product qualification remains unchanged.
