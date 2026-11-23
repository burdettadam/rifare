import { createHash } from "node:crypto";
import { defaultCurrencies, MedusaError } from "@medusajs/framework/utils";
import type { readLockedCartFacts } from "./cart-facts";

const profile = "urn:rifare:medusa-original-operation:v1";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const digest = /^sha256:[0-9a-f]{64}$/;
const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
const invalid = () => new MedusaError(MedusaError.Types.INVALID_DATA, "Invalid original commerce command");

export function parseOriginalCommand(input: Uint8Array) {
  if (!(input instanceof Uint8Array) || !input.byteLength || input.byteLength > 1024) throw invalid();
  const bytes = Buffer.from(input);
  let parsed: unknown;
  try {
    parsed = JSON.parse(decoder.decode(bytes));
  } catch {
    throw invalid();
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw invalid();
  const command = parsed as Record<string, unknown>;
  const { cart_facts_digest, cart_id, command_id, currency, currency_exponent, payable_minor_units } = command;
  if (command.profile !== profile || command.kind !== "prepare_purchase" ||
      typeof cart_facts_digest !== "string" || !digest.test(cart_facts_digest) ||
      typeof cart_id !== "string" || !/^cart_[A-Za-z0-9]{1,100}$/.test(cart_id) ||
      typeof command_id !== "string" || !uuid.test(command_id) || command_id === "00000000-0000-0000-0000-000000000000" ||
      typeof currency !== "string" || !/^[a-z]{3}$/.test(currency) ||
      typeof currency_exponent !== "number" || !Number.isInteger(currency_exponent) ||
      currency_exponent < 0 || currency_exponent > 4 ||
      currency_exponent !== defaultCurrencies[currency.toUpperCase()]?.decimal_digits ||
      typeof payable_minor_units !== "string" || !/^(0|[1-9][0-9]{0,18})$/.test(payable_minor_units) ||
      BigInt(payable_minor_units) > 9223372036854775807n) throw invalid();

  // The closed, sorted ASCII fields have one JSON representation. Comparing
  // the bytes also refuses duplicate keys, whitespace, and alternate escapes.
  const canonical = {
    cart_facts_digest, cart_id, command_id, currency, currency_exponent,
    kind: "prepare_purchase", payable_minor_units, profile,
  };
  const commandBytes = JSON.stringify(canonical);
  if (!bytes.equals(Buffer.from(commandBytes))) throw invalid();
  return {
    command: canonical,
    commandBytes,
    commandDigest: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
  };
}

export function requireCommandCartMatch(
  original: ReturnType<typeof parseOriginalCommand>,
  locked: Awaited<ReturnType<typeof readLockedCartFacts>>,
) {
  const { command } = original;
  if (command.cart_id !== locked.facts.cart_id || command.cart_facts_digest !== locked.factsDigest ||
      command.payable_minor_units !== locked.facts.payable_total_minor ||
      command.currency !== locked.facts.currency_code || command.currency_exponent !== locked.facts.currency_exponent) {
    throw new MedusaError(MedusaError.Types.CONFLICT, "Original command does not match current cart facts");
  }
}
