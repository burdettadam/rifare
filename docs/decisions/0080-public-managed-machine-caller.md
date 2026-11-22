# ADR-0080 — Public managed-machine command and request handoff

Status: assigned; implementation and qualification not yet performed.

**Target composition update:** [ADR-0081](0081-upstream-commerce-engine.md) and
[ADR-0083](0083-medusa-cart-context.md) supersede the SQLite-specific composition
below. Retain the public transport/request-artifact contracts, but connect them
only after the target-native source, original-operation journal and atomic
admission/currentness boundary are assigned and demonstrated. C6 remains
unimplemented; a cart observation does not satisfy those execution guarantees.
Protected base: `c88799bdd0d3b9211be7f8dbf1d04cb7104de1c0`.
Branch: `feat/rcg4b-public-caller`.

## Assignment

Assign **RCG-4B-C6** to integrate the provider's selected, optional public managed-machine caller profile into Rifare without changing the completed internal mTLS profile.

Pinned provider source is Marty UI draft PR1994 at
`3c05227fe0a2da1216c8d4306a9e2ca0f9ea432a`. The selected routes are:

- `POST /v1/organizations/{organization}/delegated-use-commands`
- `GET /v1/flows/instances/{challenge}/request`

A CHALLENGE response must include exactly one Link to the same configured HTTPS origin and exact challenge request path, with relation
`urn:marty:delegated-use:request`. Request retrieval returns exact compact JWS bytes as `application/oauth-authz-req+jwt`. The selected host requires mandatory mTLS and a managed MACHINE_IDENTITY. The profile is default-off upstream. Source inspection is not deployed endpoint qualification.

## Required behavior

1. Add a separate public-profile transport adapter. Do not change or parameterize the C5 internal route, its fixed path, or its existing tests.
2. Retain C5's strict TLS trust, hostname validation, certificate pin/SPIFFE identity checks, bounded deadlines/headers/body, fresh connection, no proxy/redirect/retry, finite errors and owned close semantics. Reuse/refactor only if exact C5 behavior and tests remain unchanged.
3. POST only the unchanged canonical C1 START_USE or exact RECOVER_RESULT bytes to the public command path. Bind the result to the complete retained original with the unchanged C1 codec.
4. Require exactly one Link header. Parse a single closed syntax; require the exact configured origin, challenge UUID from the bound CHALLENGE, exact `/v1/flows/instances/{challenge}/request` path, no query/fragment/userinfo/alternate encoding, and exact relation. Reject duplicates, multiple links and extra parameters.
5. Expose an explicit request retrieval method only for a challenge returned by this adapter. GET the retained URI with the same configured mTLS trust. Require HTTP 200, exactly one expected media type, no content encoding, no-store/no-cache/nosniff, bounded streaming body, strict compact-JWS syntax and finite error mapping.
6. Return a distinctly named **unverified request artifact** containing exact bytes. Transport authentication and compact-JWS shape are not signature verification, issuer trust, audience/nonce/DCQL validation, proof authority or permission to submit a VP.
7. Compose the public transport with the existing native journal/sender using concrete owner identity and captured dispatch. Existing-original recovery and one-admission semantics remain unchanged. Never permit public transport configuration from customer input.
8. Do not implement proof submission, FINALIZE, receipt verification, or business execution in this assignment. Those require a later independent request-signature verification and native receipt-context design.
9. Do not enable the upstream feature, deploy services, provision production certificates, access real accounts, merge default branches or dispatch paid CI.

## Tests and evidence

Add independent tests for exact public command path/body, response Link binding, same-origin/path/challenge restrictions, duplicate/multiple/extra Link rejection, exact request bytes and media type, malformed compact JWS, wrong host trust/hostname/client identity, response loss and explicit recovery, changed native purchase during TLS, access withdrawal, close, size/deadline bounds and no proof/FINALIZE methods. Use ephemeral local certificates and actual local TLS peers. Assert actual HTTP peer bytes and native journal state, not diagnostic flags.

Retain every existing C5 source/test/control input and rerun the unchanged C5 selected regression files. Use normal whole-file limits (60 cases, four files, 60 seconds). Add a real mutation that removes Link challenge/origin binding and another that accepts duplicate Link headers; the unchanged tests must detect the actual invalid request destination. Do not count setup/import failures as behavioral faults.

Root owns this ADR, work record, independent tests, catalog/control updates and integration. A separate implementation writer owns the public transport implementation and its wire helper/tests. Independent authority/security and regression reviewers must not author product or expected test behavior. Record actual clean candidate, reports, runtime, source equivalence, fault parents, reviewer identities and publication hashes. No green claim before real local execution.

## Explicit exclusions and next boundary

No signed authorization-request verification is implemented here. The returned artifact remains unverified. Before any proof submission, a later assignment must independently verify the request's signature, signing identity/algorithm, audience/client, nonce, lifetime, response mode, securing profile, state and complete frozen DCQL query. Only then may the proof be submitted through the provider's exact two-field direct_post contract. Provider proof association still does not verify the presentation or authorize Rifare business execution.

RCG-5 cross-service journey, RCG-6 connected qualification, public deployment, production CA/revocation/pin lifecycle, wallet interoperability, PostgreSQL/React target migration and formal acceptance remain separate.
