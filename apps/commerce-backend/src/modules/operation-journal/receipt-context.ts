import { createHash } from "node:crypto";
import { configure } from "safe-stable-stringify";
import { authorityAdapters } from "./authority-assets";
import { nativeAuthorityStart } from "./authority-start";
import { parseOriginalCommand } from "./command";
import { factsDigest } from "../../cart-context/observation";

const stringify = configure({ strict: true, deterministic: true, bigint: false });
const hash = (value: string) => "sha256:" + createHash("sha256").update(value).digest("hex");
const fail = (): never => { throw new Error("NATIVE_RECEIPT_RETAINED_CONTEXT_INVALID"); };

/** Read only the trusted C7 owner's immutable authenticated observation. The
 * decoded claims below cross-check that retained tuple; they do not authenticate
 * a new artifact, revive an expired request or supply current provider status. */
export async function retainedNativeReceiptContext(row: Record<string, any>) {
  if (!row.command_bytes || !row.start_command_bytes || !row.start_correlation || !row.start_response_bytes ||
      !row.request_bytes || !row.request_nonce || !/^sha256:[0-9a-f]{64}$/.test(row.request_context_digest) ||
      !(row.request_observed_at instanceof Date) || !(row.request_expires_at instanceof Date) ||
      row.request_expires_at.getTime() <= row.request_observed_at.getTime()) fail();
  const { codec, request_json } = await authorityAdapters();
  const original = parseOriginalCommand(Buffer.from(row.command_bytes));
  if (original.commandDigest !== row.command_digest || original.command.command_id !== row.original_command_uuid ||
      original.command.cart_id !== row.cart_id) fail();
  const start = codec.encodeDelegatedCommand(Buffer.from(row.start_command_bytes));
  if (start.request.command !== "START_USE" || start.original_command_id !== row.original_command_uuid ||
      start.canonical_json !== row.start_command_bytes || start.command_digest !== row.start_command_digest ||
      hash(row.start_response_bytes) !== row.start_response_digest || hash(row.request_bytes) !== row.request_digest) fail();
  const correlation = request_json.strictReceiptJson(Buffer.from(row.start_correlation), 4096);
  const expectedStart = nativeAuthorityStart(Buffer.from(stringify({ correlation, grant: start.request.grant })!), {
    original_command_uuid: row.original_command_uuid, command_digest: original.commandDigest,
    cart_id: row.cart_id, store_id: row.store_id,
  });
  if (expectedStart.command_bytes !== row.start_command_bytes || expectedStart.correlation !== row.start_correlation) fail();
  const bound = codec.bindDelegatedResponse(start.request, Buffer.from(row.start_response_bytes));
  if (bound.response.result.kind !== "CHALLENGE") fail();
  const challenge = bound.response.result.challenge_id;
  if (factsDigest({ profile: "urn:rifare:medusa-authority-challenge:v1", correlation, challenge_id: challenge }) !== row.challenge_fingerprint) fail();
  const parts = row.request_bytes.split(".");
  if (parts.length !== 3 || !parts.every(part => /^[A-Za-z0-9_-]+$/.test(part))) fail();
  const payload = request_json.strictReceiptJson(Buffer.from(parts[1], "base64url"), 65536);
  if (payload.state !== challenge || payload.nonce !== row.request_nonce ||
      !Number.isSafeInteger(payload.exp) || payload.exp * 1000 !== row.request_expires_at.getTime()) fail();
  return { original, bytes: Buffer.from(stringify({ ...correlation, original_command_id: row.original_command_uuid,
    grant: start.request.grant, operation: start.request.operation, cart_id: row.cart_id, store_id: row.store_id,
    challenge_id: challenge, challenge_created_at: bound.response.result.created_at, challenge_expires_at: bound.response.result.expires_at,
    nonce: row.request_nonce, authorization_request_digest: row.request_digest,
    authorization_context_digest: row.request_context_digest, currency: original.command.currency,
    currency_exponent: original.command.currency_exponent, payable_minor_units: original.command.payable_minor_units })!) };
}
