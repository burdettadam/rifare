# HTTPS OIDC browser binding

This dependent change prepares the external-customer callback cookie for a future
HTTPS Medusa deployment. The validated `RIFARE_WEB_ORIGIN` determines its `Secure`
attribute. The cookie remains host-only, `HttpOnly`, `SameSite=Lax`, and scoped to
`/auth/customer/external-oidc`. Disposable loopback HTTP keeps its existing
non-`Secure` behavior.

The focused browser-cookie test passed both HTTP and HTTPS cases. `npm run check`
passed TypeScript and 160 development tests with Git's OpenSSL on `PATH`. The
Medusa build passed with an explicit synthetic local profile and no live provider
or database connection. The first broad check used Strawberry OpenSSL and failed
while generating unrelated local TLS fixtures; the documented Git OpenSSL path
resolved that fixture setup failure.

This does not enable a production profile, register an OAuth client, qualify a
public HTTPS proxy, or deliver a storefront session. Those remain separate gates
before the existing commerce holds can change.
