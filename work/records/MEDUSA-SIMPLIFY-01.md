# MEDUSA-SIMPLIFY-01

Owner/writer: root. Direct owner assignment: simplify and remove replaced code.
Branch: `feat/medusa-native-execution-fence`; existing integration PR: #13.
Start: `9b2fbec0e2d831e0b5e26254d01df5c844327b69`.
Recovery ref: `recovery/pre-medusa-simplification-9b2fbec`.

ADR-0093 authorizes retiring the parallel SQLite application and bespoke
development/release machinery before full replacement equivalence. Medusa code,
native guards and focused authority/configuration tests remain. Historical gates
are retired, not passed; the earlier handoff goal remains paused.

Both independent roles reviewed the exact 1,161-file retirement list and shared
extraction. That review preserved three live Medusa test files and the separate
release-assurance boundary. Raw path/hash evidence remains ignored locally.

Validation and implementation review accompany the source checkpoint. No full
commerce, connected-provider, distribution or production acceptance follows.
Provider deployments remain owned by other workers. Preserve protected effects.

Checkout: one active primary, root-owned, zero linked checkouts. Next: complete
focused checks/review and continue product improvements directly in Medusa.

## Local validation

- TypeScript checking passes for the retained Medusa application.
- Current development suite: 167/167 pass, zero fail/cancel/skip/todo; Node
  duration 4.674 seconds on the local Node24.14.1/Git OpenSSL profile.
- Three unchanged upstream receipt-vector cases pass through the separate
  `npm run test:provider-vectors` command; private input remains ignored.
- Compiled adapter relocation performs actual codec/mTLS checks and verifies
  exactly nine shared modules with no SQLite kernel. Five owned-filesystem cases
  cover generated-output links, hardlinks, unexpected files and path escapes.
- The first attempt used the host's incompatible Strawberry OpenSSL and failed
  during TLS fixture setup; that log is preserved separately. Only the command's
  PATH was changed for the passing profile, with no system configuration change.

Scope: 1,161 old tracked files retired; 125,000+ lines removed. License terms,
notices and historical specifications remain. Default checks use no private
provider input. Existing CI triggers, job IDs and read-only permissions remain;
commands now exercise current source, and no Actions were dispatched.
