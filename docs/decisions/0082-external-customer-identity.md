# ADR-0082 — Consume external customer authentication

Status: owner-directed local implementation; hosted provider qualification open.
Protected base: `62350ad824bf05aae1cbea56335150030d752ae2`.
Branch: `feat/supabase-identity`; sole writer and integration owner: root.

## Owner decision

The owner selected a provider like Supabase for Rifare and ElevenID and requested
continued development. Use separate application clients of a shared external OIDC
provider. This supersedes the previous preference for an ElevenID-operated Keycloak
issuer in Rifare's application identity contract. ElevenID retains identity/trust,
credentials and delegation responsibilities; Medusa retains commerce ownership.
Sharing a login provider does not establish an ElevenID identity or merchant binding.

Assign **IDENTITY-APP-01**: a generic maintained OIDC client through Medusa's public
Auth Module provider extension, with an explicit Supabase configuration profile.
Reuse native auth-identity persistence, customer association, tokens, cache and
locking. Do not build a password/credential engine or copy Enterprise OIDC code.

Another workstream owns ElevenID's existing `feat/supabase-managed-services` branch
and external-OIDC/deployment support. Inspect it read-only; change no Marty code or
provider account here. Authentication and PostgreSQL hosting are separate choices.
Medusa keeps its current local PostgreSQL profile in this assignment.

## Bounded implementation

Use a separately configured confidential customer client, exact issuer/client/
callback, authorization code with S256 PKCE, state and nonce, explicit RS256 or
ES256 and actual JWKS signature verification. Require a verified email before
placing it in Medusa's trusted identity metadata. Bind identity by issuer+subject;
do not link by email or trust mutable profile claims as commerce permissions.

Bind each login to its initiating browser and customer actor. Reject arbitrary
callback destinations, duplicate inputs, other actor routes and replay. Serialize
native state consumption with the existing locking service. The local memory
cache/lock profile is single-process: restart invalidates pending login, and no
distributed or durable login-state claim is made.

Limit resulting customer credentials to a short application lifetime. Customer
session exchange and token refresh may not silently extend that lifetime; keep
the existing development operator path available. Do not claim immediate provider
revocation, provider-wide logout, forced fresh login or step-up. These require the
actual hosted provider and application lifecycle qualification.

Preserve all existing public commerce holds, legacy owners, tests/oracles, root
dependency inputs and the acceptance ledger. Customer login is not purchase,
refund, operator access or ElevenID delegation authority.

The assignment permits the exact OIDC client/cookie dependencies and their npm
lock/intake update, native application verification, focused configuration tests,
minimal browser-binding middleware and current architecture/deployment guidance.
Use installation hooks disabled. No account, secret, hosted issuer or real login
may be invented to make the profile appear qualified.

## Evidence and reviews

Use an independent synthetic OIDC peer, real PostgreSQL and actual Medusa HTTP
routes for code exchange, signed claims, browser/actor binding, identity/customer
persistence, email collision, replay, lifetime restrictions and retained commerce
holds. The peer is explicitly synthetic; these observations do not qualify hosted
Supabase. Record the actual source and a targeted browser-binding fault.

Normal focused development limits remain 60 cases, four files and 60 seconds.
The native application/peer/database run has a separate 240-second bound. Obtain
independent authority/security and regression reviews, at most three corrective
rounds. Root authors product and tests; reviewers remain read-only.

Existing feature-branch publication authorization applies, with `[skip ci]`.
No production migration, default-branch merge, deployment, paid service, provider
account change, release tag or hosted CI dispatch is part of this scope.

## Provider prerequisites retained

Supabase requires OAuth Server enabled, an asymmetric signing key, separate
registered clients and an operator-owned login/consent frontend. Existing ElevenID
source supports external OIDC; its tracked evidence does not yet establish a real
Supabase project/client/browser journey. Keep hosted validation and provider lifecycle
as explicit follow-up work rather than relaxing checks to accommodate assumptions.

References:

- [Supabase OAuth Server](https://supabase.com/docs/guides/auth/oauth-server/getting-started)
- [Supabase token security](https://supabase.com/docs/guides/auth/oauth-server/token-security)
- [Maintained OIDC client](https://github.com/panva/openid-client/tree/v6.9.1)
- [ElevenID provider/deployment source](https://github.com/ElevenID/marty-ui/tree/f7f05e76a6c33c4d67d3e303e5e4b832ab4238e0)

## Review correction within the assignment

The independently inspected Supabase Auth source at
`10ef10789d1ee4fb422b448047e67e3e264c0482` does not form-decode Basic credentials
before UUID client parsing. Select explicit maintained `ClientSecretPost` and
register `client_secret_post`, with no silent fallback or hand-written Basic
encoding workaround. Hosted build compatibility remains unqualified. The external
profile also suppresses native HTTP request logging through the supported logger
level, because development logs otherwise retain callback code/state/description.
Verify that behavior in an actual development process, not only NODE_ENV=test.
