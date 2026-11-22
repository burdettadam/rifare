# IDENTITY-APP-01 — External customer identity

State: assigned; implementation and verification in progress.
Protected base: `62350ad824bf05aae1cbea56335150030d752ae2`.
Branch: `feat/supabase-identity`; sole writer and integration owner: root.
Assignment: [ADR-0082](../../docs/decisions/0082-external-customer-identity.md).

The owner selected a Supabase-style external authentication provider for Rifare
and ElevenID. Rifare will consume its own registered client using maintained OIDC
code and Medusa's generic authentication extension. ElevenID remains a separate
identity/trust/delegation dependency. Protected commerce stays held.

Independent review roles: `supabase_provider_research` (authority/security) and
`medusa_auth_review` (regression). Both inspect source/evidence read-only and author
no product code or tests. `elevenid_supabase_alignment` performs read-only upstream
alignment; the other ElevenID workstream retains ownership of Marty changes.

Actual candidate, observations, failures/corrections, evidence, reviews and remote
retention will be recorded after execution. No hosted account, successful Supabase
login, end-to-end ElevenID binding, production or formal acceptance is claimed.
