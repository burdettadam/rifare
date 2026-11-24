# Development

Use the Medusa application in `apps/commerce-backend`. Node 24, npm, a dedicated
local PostgreSQL database and OpenSSL on PATH are the development prerequisites.
The existing supported Node 22 minimum is 22.22.0.

```sh
npm run install:dependencies
cp apps/commerce-backend/config.example.env apps/commerce-backend/.env
```

Configure the explicit `local-medusa` profile, a loopback database URL and two
independently generated session secrets. Keep `.env` private. The application
rejects remote databases, ambient Cloud settings and production/staging profiles.

```sh
npm run db:migrate
npm run dev
npm run check
npm run build
```

`npm run check` runs TypeScript checking and the retained unit/integration tests
for native configuration, Admin packaging, checkout value binding, JOSE, command
encoding, real local mTLS and compiled adapter relocation. It neither launches a
real provider nor accepts a release. Tests generate private disposable certificate
files and retire them. It does not run the removed SQLite suite.

On Windows, an existing Git installation may supply OpenSSL under its `usr/bin`
directory; add the actual executable directory to PATH for the test invocation.
Do not download a second toolchain just for this.

The separate `npm run test:provider-vectors` qualification retains the three original upstream signature/tampering cases and requires the authorized Protocol receipt vector. The default `npm run check` uses local synthetic signing and needs no private input.
`tests/fixtures/delegated-receipts/provider-source.v1.json` pins its expected
source and ignored local custody path. Preserve that private file if already
present. A fresh clone must obtain it from its authorized source before the
complete JOSE qualification file passes. No fixture is silently skipped or
redistributed. Other whole test files can run independently while that input is
unavailable.

For an affected test, run Node against that whole file, for example:

```sh
node --experimental-strip-types --test tests/development/commerce-backend-config.test.mts
```

For native changes, use the applicable existing backend verifier against an owned
disposable database. `npm run test:commerce`, `npm run test:identity` and
`npm run test:cart-context` expose the common ones. Native test scripts under
`apps/commerce-backend/src/scripts` retain their assertions and explicit opt-ins.
Do not run every privacy/fault/restore campaign for unrelated edits.

The former 254-file SQLite runtime gate, helper verifier, frozen catalog and
bespoke release-tooling gate are retired with that implementation/framework.
Their old failures remain historical failures, not passing results. There is no
new claim of equivalent coverage. Release/dependency/license and live-provider
qualification still require their own evidence.

GitHub Actions remain unavailable due to cost restrictions. Run checks locally;
do not dispatch CI. Protected merge/review requirements still apply.
