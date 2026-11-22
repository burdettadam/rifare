# External customer identity

Rifare consumes a shared external authentication provider through its own
confidential OIDC client. ElevenID uses a separate client and remains the identity,
trust and delegation service. This implements [ADR-0082](decisions/0082-external-customer-identity.md)
inside the existing local Medusa application. The [work record](../work/records/IDENTITY-APP-01.md)
records actual verification; no hosted Supabase account or browser journey is implied.

## Ownership and protocol

`openid-client` 6.9.1 performs discovery, authorization-code exchange and ID-token
validation. `enableNonRepudiationChecks` requires verification against the issuer's
JWKS, in addition to TLS and claims checks. The configured signing algorithm must
be RS256 or ES256. The adapter uses explicit client-secret POST authentication, S256 PKCE,
state and nonce. Discovery starts from the exact issuer, with same-origin provider
endpoints, no HTTP redirects and a ten-second request timeout. Register the client
with `token_endpoint_auth_method=client_secret_post`; no method fallback is used.
The inspected [Supabase parser](https://github.com/supabase/auth/blob/10ef10789d1ee4fb422b448047e67e3e264c0482/internal/api/oauthserver/auth.go)
does not form-decode Basic credentials before parsing a UUID client ID; the
maintained client's standards-compliant encoding is therefore incompatible with
that source. POST is supported through form parsing. A hosted project's actual
build and registered method still require qualification.

Medusa's public Auth provider extension owns database identities and customer
association. Rifare keys the provider identity by a hash of verified issuer and
subject, preserving both originals in provider metadata. Only a usable email and
literal `email_verified: true` enter trusted user metadata. No upstream token,
profile role, merchant ID, customer ID or arbitrary metadata is retained. Email
alone never links accounts; a changed provider email does not rewrite an existing
customer or transfer its association. Customer profile/contact data is not identity
or merchant authority.

The native customer workflow checks the requested email against the provider
identity and rejects an existing account's email. Initial login produces an
unassociated customer credential. Create the account through `POST /store/customers`
and sign in again to obtain the native customer association. Automatic linking,
unlinking and legacy identity migration are outside this profile.

## Local configuration

Keep the existing explicit `local-medusa` profile and private database/session
secrets. Add these values to private configuration only after registering an actual
Rifare client. The examples below are placeholders, not a configured project:

```dotenv
RIFARE_IDENTITY_PROVIDER=supabase
RIFARE_OIDC_ISSUER=https://YOUR-PROJECT.supabase.co/auth/v1
RIFARE_OIDC_CLIENT_ID=YOUR-RIFARE-CLIENT-ID
RIFARE_OIDC_CLIENT_SECRET=YOUR-PRIVATE-CONFIDENTIAL-CLIENT-SECRET
RIFARE_OIDC_SIGNING_ALG=RS256
RIFARE_OIDC_CALLBACK_URL=http://127.0.0.1:9000/auth/customer/external-oidc/callback
```

Select the actual asymmetric algorithm for the project's signing key. Callback
must exactly equal `RIFARE_WEB_ORIGIN` plus `/auth/customer/external-oidc/callback`.
The current application supports only loopback HTTP development, including its
host-only HttpOnly SameSite=Lax binding cookie. HTTPS hosting, secure cookies,
multi-instance cache/locking, proxy trust and production operation need a separately
qualified profile; none is enabled by setting these variables.

`POST /auth/customer/external-oidc` requires the exact configured Origin and an
empty body. It returns the authorization location and a browser binding cookie.
The provider callback is the native API route; it returns a Medusa JWT as JSON.
No storefront login page or token-delivery frontend is claimed. Callback requests
must carry the initiating browser's cookie. POST callbacks also require the exact
Origin. Duplicate/ambiguous parameters, arbitrary redirects, other actor routes
and unsupported register/reset/update operations are refused. The external profile
forces the supported Medusa logger to `info`, suppressing HTTP request logging
that otherwise retains callback queries and referrers. Errors remain generic;
provider descriptions and tokens are not logged. This does not configure an
external reverse proxy's logs.

Each pending flow has a 300-second expiry, nonce, PKCE verifier and configuration
binding. Native cache consumption is serialized through Medusa's Locking module.
The state key includes the browser digest, so a different browser cannot consume
the real browser's state. This memory-cache/lock profile supports one process;
restart invalidates pending logins. PostgreSQL retains completed identity/customer
associations. No durable or distributed pending-login claim is made.

## Credential lifetime and permissions

With this profile enabled, Medusa application JWTs expire after five minutes.
Customers cannot exchange them for native sessions, refresh them, or use native
MFA endpoints to obtain another JWT. Customers reauthenticate through the provider;
Supabase may reuse its own existing login. Local operator email/password login,
refresh and sessions remain native. Operator MFA routing is preserved, but this
local profile has no native MFA encryption key configured; enrollment and an
operator MFA browser journey remain unqualified. The five-minute bearer setting applies
to operators too, while their native session/refresh workflow remains available.

Provider logout or grant revocation does not immediately revoke a previously
issued Medusa JWT. Client-side token removal is local logout; upstream session
termination is a separate action. Forced fresh authentication, step-up and instant
revocation propagation are not established. The inspected Supabase implementation
does not honor `prompt`/`max_age` as a forced-login contract and does not advertise
standard end-session/revocation/introspection endpoints.

Customer login never grants operator or merchant membership. Public checkout
completion, payment mutation/hooks, returns and order access retain the original
503 commerce hold, including for authenticated customers. The separate ElevenID
identity/delegation-to-current-Medusa-operation binding is still required.

## Hosted provider prerequisites

Supabase's [OAuth Server setup](https://supabase.com/docs/guides/auth/oauth-server/getting-started)
currently labels the server beta. A real integration needs OAuth Server enabled,
asymmetric signing, separate clients for Rifare and ElevenID/environments, and an
operator-owned login/consent frontend handling `authorization_id`. Register the
exact callback; do not substitute a Supabase API access-token audience for this
client's ID-token audience. The [OAuth flow](https://supabase.com/docs/guides/auth/oauth-server/oauth-flows)
defines the `openid email` claim contract.

Verify the project's email assurance policy. Supabase's
[general configuration](https://supabase.com/docs/guides/auth/general-configuration)
explains that disabling Confirm Email implicitly confirms email addresses in the
database; a provider-attested `email_verified` claim alone does not prove a separate
email challenge. Qualification must include real consent, callback delivery,
disabled-account/recovery behavior, key rotation, application expiry and logout.
Machine authentication remains the existing separate API-key/mTLS contract;
Supabase OAuth does not currently supply a client-credentials grant.

## Verification and dependencies

`npm run test:identity` uses an independent Node-crypto OIDC peer, native PostgreSQL
identity/customer storage and a child Medusa HTTP server. It requires `NODE_ENV=test`
and `RIFARE_COMMERCE_VERIFY=disposable`. It owns ports 19036, 19037 and 19038 (the last verifies development logging) and creates
synthetic records in the explicitly selected local database. Allow 240 seconds
for the assigned migration/native verification invocation. Never select a database
containing real or valuable data. The `synthetic-oidc` HTTP-issuer exception is
available only in that explicit disposable test profile.

Direct additions are MIT-licensed `openid-client` 6.9.1 and `cookie` 2.0.2; the exact
lock pins `jose` 6.2.18 and `oauth4webapi` 3.8.9 already present upstream. Native
Express/session dependencies retain their compatible cookie 0.7.2 instances.
Installation hooks remain disabled. No Enterprise OIDC code is enabled or copied.
The complete development graph has 1,015 dependency entries plus its root record;
source intake does not qualify a binary distribution. Root dependency inputs and
legacy tests/oracles remain unchanged.
