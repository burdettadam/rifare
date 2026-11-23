import { createHash } from "node:crypto";
import { MedusaError } from "@medusajs/framework/utils";
import { configure } from "safe-stable-stringify";

const stringify = configure({ strict: true, deterministic: true, bigint: false });
const uuid = /^(?!00000000-0000-0000-0000-000000000000$)[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const invalid = () => new MedusaError(MedusaError.Types.INVALID_DATA, "Invalid authority START descriptor");

/** Builds the public C1 wire representation from native ownership and a closed,
 * unverified grant/machine descriptor. It establishes no provider authority. */
export function nativeAuthorityStart(input: Uint8Array, original: {
  original_command_uuid: string; command_digest: string; cart_id: string; store_id: string;
}) {
  if (!(input instanceof Uint8Array) || !input.byteLength || input.byteLength > 4096) throw invalid();
  const bytes = Buffer.from(input);
  let parsed: unknown;
  try { parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
  catch { throw invalid(); }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw invalid();
  const { correlation, grant } = parsed as Record<string, any>;
  if (!correlation || typeof correlation !== "object" || Array.isArray(correlation) ||
      !grant || typeof grant !== "object" || Array.isArray(grant)) throw invalid();
  const actor = correlation.actor;
  if (Object.keys(parsed).sort().join(",") !== "correlation,grant" ||
      Object.keys(correlation).sort().join(",") !== "actor,organization_id,provider_ref" ||
      !actor || typeof actor !== "object" || Array.isArray(actor) ||
      Object.keys(actor).sort().join(",") !== "id,type" || actor.type !== "MACHINE_IDENTITY" ||
      typeof actor.id !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/.test(actor.id) ||
      typeof correlation.provider_ref !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/.test(correlation.provider_ref) ||
      typeof correlation.organization_id !== "string" || !uuid.test(correlation.organization_id) ||
      Object.keys(grant).sort().join(",") !== "id,revision,terms_digest" ||
      typeof grant.id !== "string" || !uuid.test(grant.id) ||
      !Number.isSafeInteger(grant.revision) || grant.revision < 1 ||
      typeof grant.terms_digest !== "string" || !/^sha256:[0-9a-f]{64}$/.test(grant.terms_digest) ||
      stringify(parsed) !== bytes.toString("utf8")) throw invalid();
  const commandBytes = stringify({
    profile: "urn:marty:delegation-command:v1",
    command: "START_USE",
    command_id: original.original_command_uuid,
    grant,
    operation: {
      action: "urn:rifare:action:purchase:v1",
      audience: "urn:rifare:store:" + original.store_id,
      resource_id: "urn:rifare:cart:" + original.cart_id,
      request_profile: "urn:rifare:medusa-original-operation:v1",
      request_digest: original.command_digest,
    },
  })!;
  return {
    command_bytes: commandBytes,
    command_digest: "sha256:" + createHash("sha256").update(commandBytes).digest("hex"),
    correlation: stringify(correlation)!,
  };
}
