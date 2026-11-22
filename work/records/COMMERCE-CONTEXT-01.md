# COMMERCE-CONTEXT-01 — Medusa cart context

State: implemented candidate; native verification and independent review pending.

Protected base: `afd678f44f25396c2159f0532f48fc46a3c4f129`.
Branch: `feat/medusa-cart-context`; sole writer/integration owner: root.
Assignment commit: `48ca8a3`.
Assignment: [ADR-0083](../../docs/decisions/0083-medusa-cart-context.md).

Independent reviewers: `/root/c4_authority_review` (authority/security) and
`/root/medusa_auth_review` (native integration/regression), read-only.
Current upstream contract audit: `/root/elevenid_supabase_alignment`, read-only.

This goal establishes native cart policy and persisted-fact observations only.
ElevenID human account linking, original-operation persistence/currentness, C6
dispatch, approval-to-effect enforcement and hosted qualification remain open.

Exploratory verification found and corrected the native `NOT_ALLOWED` HTTP mapping
(400 rather than the selected 403), the ordered order/cart link fixture, and an
overly narrow all-minor-unit representation. Native tax/discount/credit components
can legitimately retain fractional minor units. The selected projection preserves
exact major-unit decimals and converts only an exactly representable payable total;
it never rounds or substitutes a pricing rule. Type checks and 29 focused retained
configuration/preview cases passed during exploration. Fixed-candidate native
results, the targeted fault and independent reviews are still required.
