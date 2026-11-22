# Rifare application identity contract

Status: integration design and acceptance requirements; not a connected provider.

ElevenID remains Rifare's primary identity/trust dependency. Identity management
and authentication are compatible responsibilities. Authentication establishes
which person or workload is present; commerce authorization determines the
permitted action on current merchant data.

## What exists

The inspected Marty source uses managed Keycloak by default and can consume an
external OIDC provider. Its Auth service validates login and creates Marty-local
sessions. Keycloak or the external provider handles account credentials, recovery
and related login mechanics. These capabilities already exist; a second password,
passkey or generic OIDC issuer implementation is not required in Rifare.

Source inspected at Marty `3c05227fe0a2da1216c8d4306a9e2ca0f9ea432a`:

- [External OIDC installer and ownership](https://github.com/ElevenID/marty-ui/blob/3c05227fe0a2da1216c8d4306a9e2ca0f9ea432a/docs/installer-external-oidc.md)
- [Provider qualification boundaries](https://github.com/ElevenID/marty-ui/blob/3c05227fe0a2da1216c8d4306a9e2ca0f9ea432a/docs/oidc-provider-qualification.md)
- [Auth HTTP surface](https://github.com/ElevenID/marty-ui/blob/3c05227fe0a2da1216c8d4306a9e2ca0f9ea432a/rust/services/auth/src/http_service.rs)
- [Configured Keycloak clients](https://github.com/ElevenID/marty-ui/blob/3c05227fe0a2da1216c8d4306a9e2ca0f9ea432a/config/keycloak/11id-realm.json)

Those configured clients are `marty-ui` and `marty-api`. The inspected sources do
not establish a qualified Rifare/Medusa client or account/session lifecycle.
Marty acts as an OIDC relying party for its own application login. Credential
issuance discovery at a Gateway URL is not, by itself, a supported generic
application sign-in service. Human OIDC, organization API keys and the managed
delegated-use mTLS profile are separate authentication contracts.

## Selected responsibility boundary

| Owner | Responsibilities |
| --- | --- |
| ElevenID identity service, using maintained authentication infrastructure | Stable human and machine identity, organization associations, credentials, authentication/federation, identity assurance, consent/delegation evidence, revocation/status. |
| Medusa commerce engine | Catalog, prices, carts, tax, promotions, inventory, orders, payment/fulfillment records and ordinary post-purchase workflows. |
| Thin Rifare application integration | Map a verified identity to its merchant/customer/operator context; apply product-specific approvals and commerce policy; preserve original cross-system operation identity, evidence and recovery. |

Identity evidence cannot independently authorize a purchase, refund, stock change
or merchant-admin account. A login establishes identity; current merchant
membership, order ownership, allowed amount, approval and business state still
control the effect. Medusa channels do not replace tenant isolation.

The preferred first path is a separately registered Rifare client of the
ElevenID-operated Keycloak issuer, using a maintained standards implementation.
This keeps ElevenID's authentication implementation upstream. If the selected
installation instead uses an external IdP, explicitly retain ElevenID's supported
identity/trust/delegation integration; sharing the same IdP alone would not make
ElevenID an application dependency.

## Required contract and acceptance evidence

1. **Issuer/client:** pin the actual issuer, discovery and audience, redirect URI,
   authorization-code/PKCE flow, algorithms and keys. Do not guess an issuer from
   a product name or accept a browser-supplied subject/token as verified.
2. **Stable account binding:** persist a verified issuer-plus-subject key, mapped
   explicitly to organization, merchant and actor type. Email/display name alone
   must not link accounts or grant an admin identity. Linking and unlinking require
   proof and a defined migration/recovery flow.
3. **Actor separation:** customer, employee/operator and managed machine identities
   have distinct mappings and permissions. A trusted provider authenticating a
   customer must not automatically create a Medusa administrator.
4. **Lifecycle:** test registration/provisioning, organization removal, disabled
   identities, account recovery, session expiry, reauthentication, local versus
   provider logout, revocation propagation and key rotation. A successful login
   does not prove that a separate Medusa session ends when the provider disables
   the account. Existing partial provisioning/SCIM support is not an end-to-end
   Rifare qualification.
5. **Action boundary:** bind an approved purchase to the exact current Medusa cart,
   customer, merchant, currency, amounts and source revision. Verify equality of
   the approved cart total and the payment-session amount at execution; upstream
   session presence alone does not establish that equality. Identity and consent
   facts must be fresh under the selected profile. Check permission at the actual
   commerce effect; a background worker or direct native route cannot bypass it.
6. **Original outcome recovery:** commit the original application operation before
   remote effects, retain unknown outcomes, and reconcile the original Medusa
   cart/order/provider identity. Upstream workflow compensation is not proof that
   an uncertain external payment did not happen.
7. **Privacy and portability:** retain source identity without copying unnecessary
   credential material. Define suppression/erasure/holds and export across identity
   mappings, commerce records and retained evidence. Business ownership transfer
   must preserve the disclosed ElevenID service dependency and separate assets.

Use existing protocol contracts first. Qualify any missing provider capability
before the consumer claims it: Protocol contract where needed, Marty/provider
implementation next, Rifare integration last. Another worker owns Marty changes;
this branch changes no ElevenID repository.

## Medusa integration choice

Medusa's current built-in OIDC SSO provider is an Enterprise feature requiring
separate terms; this branch does not enable it. Its generic auth-provider
extension remains available. A later implementation should use a maintained OIDC
client or suitably licensed adapter behind that extension, or an explicitly
licensed upstream provider. Keep the adapter small and test the lifecycle above.
Do not create a second authentication engine or copy Enterprise code to avoid
its license controls.

The current local commerce profile permits only development operator login and
guest-cart preparation. Protected public operations remain unavailable until
this contract is implemented and reviewed. This is an explicit integration gap,
not a claim that ElevenID lacks authentication or must own commerce authorization.
