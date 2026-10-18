# ADR-0033: M07 portability and operations development

## Prior authority and bounded assignment

The owner requested "Proceed with next 5 goals" after adopting the focused
development workflow in ADR-0032. The delegated maintainer assigns M07-G06
through M07-G10 from clean main `45599f6ae4e23a342facae0a53798dec5986d725`.
This is local development and integration under the existing delegation.
Formal M05/M06/M07 acceptance, connected qualification, an independent machine,
tagging and release remain separate requirements; no such completion is inferred.

## Writer scope

Each writer uses a separate native Git worktree. The integration owner controls
shared metadata, registrations, component inventory and the final main update.

| Goal | Bounded implementation | Writer |
| --- | --- | --- |
| M07-G06 | Evidence-bound compatibility and quality matrix; current pin checks; explicit unsupported tiers | Compatibility worktree |
| M07-G07 | Versioned single-merchant export/import, exact source relationships and digests, opaque credential references, paused imported work | Integration owner |
| M07-G08 | Shared migration ownership fence, source/receipt reconciliation, cutover and rollback rehearsal | Operations worktree |
| M07-G09 | Executable operator drills and documented commands for existing recovery permissions | Operations worktree |
| M07-G10 | Offline clean-install and upgrade/rollback preparation using actual current migrations and documented host prerequisites | Installation worktree |

New implementation belongs in existing commerce/conformance/operations packages,
small existing-command CLI entrypoints, focused native tests, documentation and
the five work records. The operations writer may add a migration fence to the
existing data-guard entrypoint; all unbound behavior and previous assertions stay
intact. The integration owner may refresh only exact source hashes that become
stale in the conformance declaration as a result of that reviewed change. No
operation semantics, proof counts, expectations or acceptance thresholds change.
Source inventory and registration additions are additive. Original tests,
fixtures, prior control bytes and historical source remain recoverable.

## Development feedback and completion

Use the default 60-case/four-file/60-second development budget. Run each focused
selection only when it resolves a concrete implementation risk; use a bounded
combined run after integration. Browser suites, nested catalog/controller runs,
full regression and multi-level restoration audits are not automatic batch steps.
Actual demonstrations use disposable synthetic data and installed local tools.
Source review is focused on tenant boundaries, credentials, paused operations,
ownership fencing, recovery and compatibility claims. Records distinguish these
observations from formal goal or milestone acceptance. Public publication, real
payments, customer notifications, production access and paid services are outside
this assignment.
