# Rifare — Agent access and grounded order assistance

M01-G11 through M01-G15 add a task-bound MCP interface, a no-model status page,
two provider wire adapters behind one interface, and separate Python orchestration.
This remains the SQLite diagnostic implementation. PostgreSQL/React and live model
qualification are open; there is no hosted remote or deployment.

## Local setup

Use the existing Node 22.16 diagnostic host and Python tooling; no npm packages were
added. The complete test suite additionally requires Playwright/Chromium.

```sh
npm ci --offline --ignore-scripts
python3 tools/verify.py --runtime --harness
node --experimental-strip-types tools/dev-commerce.mts
```

The server prints its loopback URL and the path to its private session file. Visit
`/status`, enter one operator token and an order resource ID obtained from the
existing resource list. The token is held in page memory, not browser storage;
the field is cleared after submission. Facts, separate shipment states, source
revisions and timestamps are displayed with an explicit synthetic/unqualified label.
Denied or unavailable reads clear previous results. Sign out revokes the session
and clears the page. Customer proof entry uses the existing private diagnostic
outbox, not real email. No model setting is needed to use the page.

The served-page trial on the current host was blocked by its browser administration
policy. Component tests execute the shipped HTML/JavaScript with synthetic responses
and network denied. They do not replace actual served-browser qualification:

```sh
node --experimental-strip-types --test tests/qualification/manual-served.mts
```

That qualification command must fail rather than skip when the host blocks navigation.

## MCP: narrow reads, independent authorization

Create a portable task with authenticated `POST /v1/read-tasks` and its existing
`order_id`/`profile_id` fields. Request a reduced grant with:

```json
{
  "task_id": "task_FROM_CREATE_RESPONSE",
  "tools": ["read_task", "order_status", "skill_content"]
}
```

Send this JSON to `POST /v1/mcp-grants` with the existing application session. The
response contains a separate token bound to this task and the exact `/mcp` endpoint,
expiring in at most five minutes. Keep it private. Revoking the parent session,
changing the pinned profile, expiration or current access loss prevents subsequent
reads. A grant cannot be used as an ordinary REST bearer, and a REST bearer cannot
be passed directly to MCP. Tokens never enter commerce/provider adapter arguments.

The endpoint implements the explicitly pinned MCP **2025-11-25** JSON-response
Streamable HTTP subset, not the evolving draft. Initialize with that protocol,
then send `MCP-Protocol-Version: 2025-11-25` and
`Accept: application/json, text/event-stream` on POST requests. The server returns
one JSON-RPC response, or 202 for `notifications/initialized`; GET returns 405
because this implementation has no SSE stream. It offers `ping`, `tools/list` and
`tools/call`, not sampling, prompts, subscriptions, resources, remote OAuth discovery,
MCP asynchronous tasks or protocol-session resumption.

Available tool names are `read_task`, `order_status`, `skill_content`,
`knowledge_search`, `knowledge_get`. Exact input schemas, current profile permissions,
parent authority and task-order restrictions are enforced at execution time.
A tool description is never permission. Unknown/write tools and credentials/private
checkpoints are not exposed. Content carries source references and guidance is not
executable policy. Dynamic list notifications are not advertised.

Authorization uses bounded in-process opaque grants for local diagnostics. Grants
are lost on restart; request new ones. This is not an OAuth implementation or a
claim of compatibility with every remote MCP host. See the sources below for the
standard transport/tool definitions; published annotations do not confer authority.

## Built-in runner and bring-your-own providers

`ReadRunner` accepts server-installed configurations and an existing `SecretVault`.
The provider adapter receives the model key through its registered vault reader;
no HTTP endpoint resolves or accepts plaintext model keys. Configuration selection
is tenant/store scoped. Requests cannot replace the endpoint, model or credential.

The maintained wire interfaces are OpenAI Responses and Anthropic Messages. Both
map to the same `ModelRequest`/`ModelStep` types and the same two tools:
`read_order_status` and `finish_status`. The runner reads the pinned skill and
merchant profile, validates every tool argument, and derives the displayed answer
from selected source facts. It does not trust unconstrained model prose. Finishing
requires current source-digest equality and all mandatory facts. Hallucinated values,
invented references, refusals, unsupported capabilities, malformed output, timeouts,
source changes and access loss cause handoff/denial, never new commerce facts.

The initial answer mode is **validated fact selection**, not an unrestricted
conversation agent. Optional fact selection is model-controlled; the final wording
is deterministic and tone/locale-aware in the limited supported templates. Read
source values may still contain merchant-authored text, so render answers as text.

Per-run limits are four model rounds and 512 output tokens per request in the
fixtures (configuration maximum: four rounds and 2048 tokens). There is no silent
provider fallback or automatic retry. This is not a complete account spending
budget. Usage values are provider-reported and may be unknown; never treat them
as an invoice. Credentials, raw prompts/responses and provider conversation IDs
are not persisted in business records. Receipts retain source/skill/profile/config
pins, action-result digests and observed usage. Read tasks survive provider changes.

Run the entirely local demonstrations:

```sh
node --experimental-strip-types tools/demo-assistance.mts openai
node --experimental-strip-types tools/demo-assistance.mts anthropic
```

These use two distinct **synthetic wire response formats**, not live models. They
print `external_calls: 0`. Neither a paid API account nor a model key is needed.
For an actual authorized test, server code must install the desired reader with
`allowLiveTest: true` and an exact `approvedModels` list, provide its own vault key,
provision a model-secret reference, and install a `ReadRunner` configuration. No
live configuration is created by `dev-commerce.mts`. Default reader construction
refuses external requests. Only fixed official HTTPS endpoints are used; redirects
are rejected. Responses are bounded and no provider SDK is required.

An optionally installed runner can be invoked by an operator/worker using
`POST /v1/read-tasks/{task_id}/assist` with `configuration_id`. Its sanitized receipt
is readable at `GET /v1/read-tasks/{task_id}/receipts/{receipt_id}`. With no runner
installed, assistance is unavailable while manual/REST/MCP reads continue. Customer
sessions do not acquire an operator's model budget or model secret.

Non-streaming tool output is the supported subset. Image/audio, hosted provider
tools, provider-managed threads, reasoning-state continuation and arbitrary
OpenAI-compatible endpoints are not qualified. No live model is yet qualified;
model/version/settings must be tested before advertising support.

## Separate external implementation

`clients/status_agent.py` is standard-library Python orchestration. It runs in its
own directory, imports no Rifare server/runner code, and consumes/verifies every
pinned skill resource through the content interface. It fetches current facts,
rechecks the task and returns source-backed status claims. It is deliberately
deterministic: no LLM is hidden in the example.

```sh
# Set the private scoped token in this process environment, never on the command line.
python3 clients/status_agent.py --base-url http://127.0.0.1:PORT --task-id TASK_ID
# With RIFARE_MCP_TOKEN instead of RIFARE_BEARER:
python3 clients/status_agent.py --base-url http://127.0.0.1:PORT --task-id TASK_ID --transport mcp
```

Proxy variables and redirects are disabled in this local client. Remote endpoints
are refused. The same claims are obtained through REST and MCP. A test copies the
server into a separate directory, physically removes the built-in runner/provider
modules, and completes using this client. That is orchestration separation, not
independent reviewer provenance or live-model evaluation.

## Protocol and wire sources checked October 16, 2026

Primary specifications used for the implemented subsets:

- MCP pinned transport: https://modelcontextprotocol.io/specification/2025-11-25/basic/transports
- MCP tool messages: https://modelcontextprotocol.io/specification/2025-11-25/server/tools
- MCP authorization requirements: https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization
- OpenAI function calling: https://developers.openai.com/api/docs/guides/function-calling
- OpenAI Responses fields: https://developers.openai.com/api/reference/resources/responses/methods/create
- Anthropic Messages: https://platform.claude.com/docs/en/api/messages/create
- Anthropic client-tool round trips: https://platform.claude.com/docs/en/agents-and-tools/tool-use/handle-tool-calls

Source verification does not establish live interoperability. Schemas and fixture
contracts remain distinct from authenticated external test evidence.
