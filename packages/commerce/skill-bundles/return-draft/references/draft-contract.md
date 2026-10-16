# Return-draft contract v1

POST /v1/return-drafts/prepare accepts exactly case_id, request_key, resolution.
resolution is refund or exchange. Prices, tenant IDs, policy bodies and approval
claims are not accepted inputs. Preparation returns a pinned gateway preview and
requires approval. One case has one draft; retries return the same preview.
POST /v1/return-drafts/resume accepts exactly case_id and returns that draft.

Use /v1/execution/approve with a separately authorized approver and exact digest;
/v1/execution/execute revalidates the original facts, configuration and approval.
This diagnostic action is a reversible local plan, not a return authorization or
settled refund. Reversal through the gateway needs a new preview and approval.
Profiles and platform rules are authoritative server records, not prompt flags.
