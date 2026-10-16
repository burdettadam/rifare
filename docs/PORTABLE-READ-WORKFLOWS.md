# Rifare portable read workflows

M01-G06 through M01-G10 extend the integrated commerce foundation. This is a local
SQLite diagnostic implementation, not the unfinished PostgreSQL/React target.
The public read contract and product skill require no agent runtime or model key.

## Implemented surface

| Goal | Implementation | Qualification |
|---|---|---|
| M01-G06 | Version-pinned Shopify read transport, encrypted credential handle, bounded order/fulfillment normalization, refresh/freshness tracking | Synthetic wire fixtures and failure injection; no connected test store was accessed |
| M01-G07 | Current tenant/store policy, catalog and support references with revision, timestamps, visibility and content digest | Local source and access-control tests |
| M01-G08 | A portable order-status skill, declared resources, content digests, filesystem loader and authenticated content interface | One deliberately narrow frontmatter subset; no runtime-specific shell requirement |
| M01-G09 | Typed profiles with tone, locale, permitted reads and scope restrictions | Three synthetic profiles share the same base digest; no model quality claim |
| M01-G10 | Authenticated canonical order reads, task context and OpenAPI document, with a separate Python HTTP client | Actual loopback HTTP; no built-in agent or provider conversation state |

The skill and profile descriptions are guidance and restrictions, not credentials
or authorization. Knowledge text is always reference material. No financial action,
message delivery or policy publication is exposed by these endpoints. A task is
immutable read context, not a scheduling system, assignment lease or agent thread.

## Run the accumulated diagnostic environment

Use the existing documented Node 22.16.0 / Python / Linux host:

```sh
npm ci --offline --ignore-scripts
python3 tools/verify.py --runtime --harness
node --experimental-strip-types tools/dev-commerce.mts
```

The last command prints a loopback URL and private local session-file location.
Two synthetic stores receive the same installed order-status skill and a `default`
profile: apparel uses warm/en-US; fragile uses formal/en-GB. The third fr-CA profile
is a test fixture showing that another customer needs configuration, not a fork.
The command does not provision Shopify or obtain its credentials. Session tokens,
proofs, databases and wrapping keys remain outside the tracked source.

The complete helper suite is filesystem/process-heavy. A timeout is a blocked run,
not a passing result. Record the actual runner and host; do not reduce test counts.

## Public read API

All routes below require the existing bearer session. Store and tenant identity
come from that session, never request headers, profile JSON or a model thread.
A customer session is limited to its verified order. Unknown actions, extra fields,
undeclared resources and duplicate query parameters are rejected.

| Route | Purpose |
|---|---|
| `GET /v1/read-contract` | Authenticated OpenAPI 3.1 document |
| `GET /v1/orders/{order_id}/status` | Typed current/diagnostic facts with source provenance |
| `GET /v1/knowledge/search?query=...` | Permitted, unexpired current source passages |
| `GET /v1/knowledge/{source_id}/revisions/{revision}` | Exact current source revision; old or revoked revisions are unavailable |
| `GET /v1/skill-content?skill_id=...&resource=...&bundle_digest=...` | Pinned declared skill resource; no absolute filesystem path |
| `GET /v1/profiles/{profile_id}` | Validated profile and its digest |
| `POST /v1/read-tasks` | Create `{order_id, profile_id}` context, without external effects |
| `GET /v1/read-tasks/{task_id}` | Portable context with current order facts |
| `POST /v1/read-tasks/{task_id}/actions` | Execute a permitted read with `{action, arguments}` |

The canonical schema is `packages/commerce/contracts/read-api.openapi.json`; it is
served by the runtime, not loaded from a test or developer-only directory.

The permitted action names are `order.status`, `knowledge.search`, `knowledge.get`
and `skill.read`. Their argument keys are respectively `{order_id}`, `{query}`,
`{source_id, revision}`, and `{skill_id, resource, bundle_digest}`. Within a task,
knowledge attached to another order is excluded even for an operator whose ordinary
session can see the entire store. A task cannot be rebound to a different order,
profile revision or skill digest. Changed profile/skill context requires a new task.
Read tasks expire after one hour; at most 1,000 unexpired tasks may exist per store.
Expired rows require a future retention job; this release does not promise cleanup.

An independent standard-library client is included:

```sh
# Supply the existing local bearer through the environment, not argv or Git.
python3 clients/read_task.py --base-url http://127.0.0.1:YOUR_PORT --task-id TASK_ID
```

Set `RIFARE_BEARER` in that process's environment. The client fetches the published
contract and task over HTTP; it imports no Rifare server code, does not need a shell
inside an agent, refuses redirects/proxies and non-loopback hosts, and does not
print its credential. Its output contains authorized synthetic task data.
The client is independent code, not an independent security reviewer or AI runtime.

## Skill and profile handling

`packages/commerce/skill-bundles/order-status/SKILL.md` is one reusable base. Its sibling
`commerce-manifest.json` is a Rifare extension listing supported resource paths.
The loader supports the required `name` and single-line `description` frontmatter
in that order with LF line endings. Other YAML forms, optional fields and scripts
are explicitly unsupported in this minimal slice; this is not a general YAML parser.
File/resource names, size, metadata, bundle hashes and no-symlink boundaries are
checked. Server-side installation stores approved content, not a path clients need.
The tool response and filesystem bundle have identical resource hashes.

Operator-only profile provisioning accepts explicit tenant/store identity matching
the current session, monotonically increasing revision, pinned base digest, tone,
locale and the fixed read scope. Unsupported actions and unknown properties fail.
A profile can narrow available reads but never expand platform/session permissions.
Changing the language guidance is not a demonstrated translation or model result.

Knowledge is deliberately lexical retrieval with case-insensitive terms, not a
vector database or an LLM. Source references carry URI, current revision, observed
and updated timestamps, expiry, visibility and SHA-256. No remote URLs are fetched.
Private sources remain restricted to their owner; staff sources exclude customers;
order-bound sources are scoped to verified/customer or explicit task context.
This implementation reads permitted rows in memory and is not scale-qualified.

## Shopify read adapter

The fixed GraphQL query targets Admin API `2026-10`, using `read_orders` and
optionally `read_all_orders`. Money remains exact decimal strings with currencies;
no floating conversion or assumed two-decimal currency exponent is used. Separate
fulfillment groups retain their own line quantities, status and tracking facts.
A successful fulfillment operation is not interpreted as delivery of every parcel.

Only an exact lowercase `*.myshopify.com` store hostname is accepted. The registered
credential reader owns the fixed endpoint, POST query and redirect rejection.
The same store identity cannot be rebound to another hostname. Credentials are
resolved only inside the server-installed read callback and are not an API method.
Live transport is disabled by default and requires explicit operator provisioning
and `allowLiveTest: true`; the test fixture transport is labeled as such. No live
request was made in this implementation. Existing cached capabilities do not imply
production qualification; customer Shopify ownership verification is still absent.

The current narrow envelope is at most 50 order lines, 10 fulfillments and 50 lines
per fulfillment. Truncation, non-exact fulfillment counts, malformed source IDs,
unsafe tracking URLs, schema/version mismatches and future source timestamps fail
closed. Pagination beyond this envelope is not implemented. Null orders are labeled
missing-or-inaccessible, not claimed deleted. The adapter reports throttling with
an advisory five-second retry interval; it does not automatically retry or assert a
provider-specified retry time. Throttle/access/transport errors never return old
facts as current. Cached snapshots expire after five minutes.

A refresh rechecks connection/session/secret validity after its await. Concurrent
requests compare the observation revision so a late response cannot invalidate or
supersede a newer one. Cache reads verify the canonical payload against observation
metadata; a crash/torn write cannot silently present mismatched facts as fresh.

## Remaining qualification

No live store, native-record comparison, OAuth installation, production delivery,
PostgreSQL repository, React application, hostile-plugin sandbox, durable hosted
secret store, or independent reviewer was exercised. The localhost diagnostic is
not an internet-facing production service. The existing no-production and release
gates remain. Review and local integration are delegated; full goal acceptance
still requires the unchanged prerequisites and actual external evidence.

## Primary references checked on 2026-10-16

- [Shopify order query](https://shopify.dev/docs/api/admin-graphql/2026-10/queries/order)
- [Shopify order fields and fulfillment count](https://shopify.dev/docs/api/admin-graphql/2026-10/objects/Order)
- [Shopify fulfillment fields](https://shopify.dev/docs/api/admin-graphql/2026-10/objects/Fulfillment)
- [Shopify GraphQL error handling](https://shopify.dev/docs/api/usage/response-codes)
- [Agent Skills specification](https://agentskills.io/specification)
- [Agent Skills integration guidance](https://agentskills.io/integrate-skills)

Versioned Shopify documentation redirected to the latest page labeled 2026-10
when inspected. These are documentation observations, not a successful query on a
real store. The source adapter remains explicitly pinned and rejects a different
API-version response header.
