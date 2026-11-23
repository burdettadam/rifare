# Rifare application identity contract

Status: external-provider customer adapter implemented; local verification and
hosted provider qualification are recorded separately in the
[IDENTITY-APP-01 work record](../work/records/IDENTITY-APP-01.md).

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
| External authentication provider, selected as Supabase | Account authentication, credential recovery and provider login/consent. Rifare and ElevenID use separate registered clients. |
| ElevenID identity service | Stable human and machine identity, organization associations, credentials, identity assurance, consent/delegation evidence, revocation/status; consumes external authentication for its own application. |
| Medusa commerce engine | Catalog, prices, carts, tax, promotions, inventory, orders, payment/fulfillment records and ordinary post-purchase workflows. |
| Thin Rifare application integration | Map a verified identity to its merchant/customer/operator context; apply product-specific approvals and commerce policy; preserve original cross-system operation identity, evidence and recovery. |

Identity evidence cannot independently authorize a purchase, refund, stock change
or merchant-admin account. A login establishes identity; current merchant
membership, order ownership, allowed amount, approval and business state still
control the effect. Medusa channels do not replace tenant isolation.

The owner selected a shared external provider in [ADR-0082](decisions/0082-external-customer-identity.md),
superseding the earlier preference for an ElevenID-operated Keycloak issuer.
Use distinct Rifare and ElevenID OAuth clients and application sessions. Explicitly
retain ElevenID's identity/trust/delegation integration: sharing the same provider
alone does not establish an ElevenID identity or make it an application dependency.

The read-only follow-up inspected parallel Marty branch
`d5e383243edb26cd7c01b2ba85ca3d6656bf3f74`: external OIDC, separately configured
managed PostgreSQL and a static login/consent companion now exist. A configured
hosted Supabase project/client/browser journey remains unqualified. The other
workstream owns those Marty changes. The [native cart guide](MEDUSA-CART-CONTEXT.md)
records the inspected Auth/account-link interface gap and exact upstream pins.
Shared provider identity must not be interpreted as an ElevenID account link,
current organization membership or approval authority.

## IDENTITY-APP-02 provider selection

Marty protected main `5d8ea970d7a2537229bcb84a4b80bd1037be9db6` contains the
delegation hosts from PR #1994 and the opt-in machine-use packaging from PR
#2063. These sources support a candidate machine profile. The provider still
needs to supply a qualified endpoint and the exact registered caller.

| Binding | What Rifare needs from the provider | What Rifare must establish |
| --- | --- | --- |
| Human customer or operator | A supported account-link and current-status interface bound to ElevenID's issuer, link revision and the verified parties. The inspected Auth surface provides Marty session login and `/v1/auth/me` without a supported external issuer/subject account-link lookup for Rifare. | Keep the verified Supabase issuer/subject bound to the native Medusa customer. Accept an ElevenID link only after verifying both ends, active status and current revision. Evaluate merchant membership and permissions separately, including after unlinking or removal. |
| Managed machine | The opt-in managed-machine caller profile on the delegated-use listener. It selects mutual TLS, one configured organization, a full managed machine identity, KEY-bound grant and exact operation. | Pin the HTTPS origin, CA, organization and complete machine principal. Keep workload credentials in their authorized custody. Verify that cross-organization identity, stale or revoked proof and human-session substitutions fail. |

The Protocol [account-link schema](https://github.com/ElevenID/marty-protocol/blob/1952c56e11d2ad1346b139da8c0a5e98cd7a2f73/schemas/agent-trust/v1/account-link.json)
defines two proof references, status and revision. It requires
`authority_inherited: false`. Its conformance examples cover shape and
consistency. The provider must still expose and qualify a current-state
operation. A matching email, shared provider session or local customer UUID
cannot stand in for a link or a merchant permission.

The [machine-use transport](https://github.com/ElevenID/marty-ui/blob/5d8ea970d7a2537229bcb84a4b80bd1037be9db6/rust/services/delegated-authority/USE_HTTP.md)
keeps the original command bytes and binds challenge retrieval to the original
response. Rifare's retained internal transport and command handling passed 93
local regression cases at `de0b119`. Those synthetic peers and the SQLite
diagnostic remain useful regression inputs for a native integration. A deployed
machine endpoint and public caller run are still required.

The ElevenID provider owner supplies the qualified interfaces and caller
enrollment evidence. The Rifare consumer owner verifies the selected humans and
machine against Medusa and the original-operation journal. Approval currentness,
payment equality, signed request and receipt verification and protected commerce
effects remain separate qualification gates.

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

## Payment validation and compensation

Medusa 2.23.0 registers payment compensation before the cart-completion
`validate` hook. In the disposable PostgreSQL fixture, a synthetic payment
was captured for the original amount, then the cart changed. Refusing the
mismatch in the hook left the cart open and created no order. Medusa still
recorded a refund of the earlier capture.

COMMERCE-AUTHORITY-01 must refuse mismatched, expired or unverified authority
before entering a workflow that can compensate an existing payment. The
entry must bind the exact original operation, current cart snapshot, selected
payment session, currency and amount under the native currentness controls.
Any compensation for an earlier payment must run through the authorized
original-outcome reconciliation path. The hook can provide an additional
check after those conditions hold. Protected checkout stays held until the
entry and reconciliation controls are qualified.

## Medusa integration choice

Medusa's current built-in OIDC SSO provider is an Enterprise feature requiring
separate terms; this branch does not enable it. Its generic auth-provider
extension is used by the current adapter with pinned `openid-client` 6.9.1.
Medusa owns identity persistence, customer association, cache, locking and application
tokens. The adapter adds exact provider configuration, browser/actor binding,
verified issuer/subject mapping and lifetime restrictions. See
[external customer identity](EXTERNAL-CUSTOMER-IDENTITY.md) for its actual scope.
Do not create a second authentication engine or copy Enterprise code to avoid
its license controls.

The default local profile retains development operator login and guest carts.
The explicit external profile adds customer login; protected commerce operations
remain held until the ElevenID identity/approval-to-Medusa effect contract is
implemented and reviewed. Authentication alone does not complete that bridge.
