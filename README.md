# Rifare

Rifare uses **Medusa 2.23.0 and PostgreSQL** for products, pricing, carts,
inventory, orders and ordinary post-purchase workflows. Medusa Admin supplies
merchant administration. ElevenID supplies identity, trust and delegation;
Rifare enforces commerce permission at the native action boundary.

The replaced SQLite application, custom commerce engine, synthetic storefront,
legacy clients and bespoke development harness have been removed. Git retains
that history at `recovery/pre-medusa-simplification-9b2fbec`.

## Develop

Use Node 24 (or supported Node 22 >=22.22), npm and a dedicated local PostgreSQL database.

```sh
npm run install:dependencies
# Copy apps/commerce-backend/config.example.env to apps/commerce-backend/.env.
# Set your own local database URL and two independent session secrets.
npm run db:migrate
npm run dev
```

The backend binds to loopback; Admin is at `/app`. Real providers and production
startup remain gated. See [development](docs/DEVELOPMENT.md) for prerequisites.

```sh
npm run check       # TypeScript plus retained authority/configuration tests
npm run build       # Medusa/Admin and compiled shared authority adapters
npm run test:commerce # Explicit real local PostgreSQL workflow verification
```

OpenSSL must be on PATH for local mTLS test certificates. The separate `npm run test:provider-vectors` checks use a separately obtained private fixture; it is never
redistributed in this repository. See [development](docs/DEVELOPMENT.md).

[Architecture](docs/ARCHITECTURE.md) ? [Remaining work](docs/ROADMAP.md) ?
[Simplification decision](docs/decisions/0093-medusa-only-development.md) ?
[Licenses](LICENSE-STATUS.md)
