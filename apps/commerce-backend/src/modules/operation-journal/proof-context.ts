import { configure } from "safe-stable-stringify";
import { authorityAdapters } from "./authority-assets";
import { retainedNativeReceiptContext } from "./receipt-context";

const stringify = configure({ strict: true, deterministic: true, bigint: false });
const fail = (): never => { throw new Error("NATIVE_PROOF_CONTEXT_UNAVAILABLE"); };

/** Derive historical proof routing solely from C7's retained authenticated tuple.
 * This is no new signature/currentness check. First dispatch additionally requires
 * the concrete native verifier and a fresh native transaction after TLS. */
export async function retainedNativeProofContext(row: Record<string, any>) {
  const retained = await retainedNativeReceiptContext(row);
  const { codec, request_json } = await authorityAdapters();
  const start = codec.encodeDelegatedCommand(Buffer.from(row.start_command_bytes));
  const bound = codec.bindDelegatedResponse(start.request, Buffer.from(row.start_response_bytes));
  if (bound.response.result.kind !== "CHALLENGE") fail();
  const challenge = bound.response.result;
  const claims = request_json.strictReceiptJson(Buffer.from(row.request_bytes.split(".")[1], "base64url"), 65536);
  const queries = claims.dcql_query?.credentials;
  if (!Array.isArray(queries) || queries.length !== 1 || typeof queries[0]?.id !== "string" ||
      !/^[A-Za-z0-9_-]{1,128}$/.test(queries[0].id) || typeof claims.response_uri !== "string") fail();
  const uri = new URL(claims.response_uri);
  if (uri.protocol !== "https:" || uri.username || uri.password ||
      claims.response_uri !== uri.origin + "/v1/flows/instances/" + challenge.challenge_id + "/submit") fail();
  const bytes = Buffer.from(stringify({ profile: "urn:rifare:native-proof-context:v1", origin: uri.origin,
    original_command_id: row.original_command_uuid, challenge_id: challenge.challenge_id,
    created_at: challenge.created_at, expires_at: challenge.expires_at, query_id: queries[0].id,
    nonce: row.request_nonce, request_digest: row.request_digest, request_context_digest: row.request_context_digest })!);
  return { original: retained.original, start, bound, bytes, query_id: queries[0].id as string };
}
