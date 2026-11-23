import { createHash, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { discoveryPath } from "@medusajs/medusa/payment";
import { AbstractPaymentProvider, MedusaError } from "@medusajs/framework/utils";
import type { ModulesSdkUtils } from "@medusajs/framework/utils";
import type { AuthorizePaymentInput, AuthorizePaymentOutput, DAL, InitiatePaymentInput, InitiatePaymentOutput } from "@medusajs/framework/types";

type Postgres = ReturnType<typeof ModulesSdkUtils.createPgConnection>;
type Correlation = { profile: string; session_id: string; handle: string; original_command_id?: string };
const profile = "urn:rifare:local-fenced-system-correlation:v1";
const uuid = /^(?!00000000-0000-0000-0000-000000000000$)[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const unavailable = (): never => { throw new MedusaError(MedusaError.Types.NOT_ALLOWED, "Native execution payment is unavailable"); };
const unsupported = (): never => { throw new MedusaError(MedusaError.Types.NOT_ALLOWED, "Native execution payment action is unsupported"); };
function activeProfile() {
  if (process.env.NODE_ENV !== "test" || process.env.RIFARE_COMMERCE_VERIFY !== "disposable" ||
      process.env.RIFARE_COMMERCE_PROFILE !== "local-medusa" || process.env.RIFARE_TEST_NATIVE_EXECUTION !== "fenced-system") unavailable();
}
function correlation(data: unknown): Correlation {
  if (!data || typeof data !== "object" || Array.isArray(data)) unavailable();
  const value = (data as Record<string, unknown>).rifare_native_execution;
  if (!value || typeof value !== "object" || Array.isArray(value)) unavailable();
  const row = value as Record<string, unknown>, keys = Object.keys(row).sort();
  if (JSON.stringify(keys) !== JSON.stringify(["handle", "profile", "session_id"]) &&
      JSON.stringify(keys) !== JSON.stringify(["handle", "original_command_id", "profile", "session_id"])) unavailable();
  if (row.profile !== profile || typeof row.session_id !== "string" || !/^payses_[A-Za-z0-9]{1,100}$/.test(row.session_id) ||
      typeof row.handle !== "string" || !/^[a-f0-9]{64}$/.test(row.handle) ||
      row.original_command_id !== undefined && (typeof row.original_command_id !== "string" || !uuid.test(row.original_command_id))) unavailable();
  return { profile, session_id: row.session_id as string, handle: row.handle as string,
    ...(row.original_command_id ? { original_command_id: row.original_command_id as string } : {}) };
}

/** Supported provider extension, distinct from pp_system_default. This local-only
 * adapter is incomplete until the journal/write/visibility fences are qualified.
 * Its correlation handle is never authority; the database authenticates workers.
 */
export default class FencedSystemPaymentProvider extends AbstractPaymentProvider {
  static identifier = "rifare_fenced_system";
  private readonly postgres: Postgres;
  private readonly delegate: {
    initiatePayment(input: InitiatePaymentInput): Promise<InitiatePaymentOutput>;
    authorizePayment(input: AuthorizePaymentInput): Promise<AuthorizePaymentOutput>;
  };

  constructor(cradle: Record<string, unknown>, options: Record<string, unknown> = {}) {
    super(cradle, options); activeProfile();
    if (Object.keys(options).length) unavailable();
    const base = cradle.baseRepository as DAL.RepositoryService | undefined;
    if (!base || typeof base.getFreshManager !== "function") unavailable();
    const manager = base!.getFreshManager<{ getKnex(): Postgres }>();
    if (typeof manager.getKnex !== "function") unavailable();
    this.postgres = manager.getKnex();
    // Pinned internal delegation is explicit, not a claim of a stable package
    // subpath API. Keep upstream System mechanics and fail on any incompatibility.
    const file = resolve(dirname(discoveryPath), "providers/system.js");
    const require = createRequire(discoveryPath);
    const version = JSON.parse(readFileSync(resolve(dirname(discoveryPath), "../package.json"), "utf8")).version;
    if (version !== "2.23.0" || createHash("sha256").update(readFileSync(file)).digest("hex") !==
        "d9689317d1d3ff82be30d6049f07d37fbef111b59441c2fb3adcc8eab44d0fdd") unavailable();
    const native = require(file);
    if (native.default !== native.SystemPaymentProvider || native.SystemPaymentProvider?.identifier !== "system") unavailable();
    this.delegate = new native.SystemPaymentProvider(cradle, {});
  }

  async initiatePayment(input: InitiatePaymentInput): Promise<InitiatePaymentOutput> {
    activeProfile();
    // The native module overwrites input.data.session_id with the newly created
    // native session ID before calling initiatePayment. Do not use caller context.
    const sessionId = input.data?.session_id;
    if (typeof sessionId !== "string" || !/^payses_[A-Za-z0-9]{1,100}$/.test(sessionId)) unavailable();
    const result = await this.delegate.initiatePayment(input); activeProfile();
    return { ...result, data: { ...result.data, rifare_native_execution: {
      profile, session_id: sessionId, handle: randomBytes(32).toString("hex"),
    } } };
  }

  async authorizePayment(input: AuthorizePaymentInput): Promise<AuthorizePaymentOutput> {
    activeProfile(); const selected = correlation(input.data);
    try {
      return await this.postgres.transaction(async tx => {
        // This required gate is not a boolean supplied by the caller. Until its
        // journal implementation exists, absence fails closed before delegation.
        const result = await tx.raw("select public.rifare_require_native_execution_payment(?, ?, ?) as original_id",
          [selected.session_id, selected.handle, "authorize"]);
        const original = result.rows[0]?.original_id;
        if (typeof original !== "string" || !uuid.test(original) ||
            selected.original_command_id && selected.original_command_id !== original) unavailable();
        activeProfile();
        // The exact pinned System implementation performs no HTTP. The short
        // transaction is solely for local ownership ordering, never a real gateway.
        const native = await this.delegate.authorizePayment({ data: {}, context: {} });
        activeProfile();
        return { ...native, data: { ...native.data, rifare_native_execution: { ...selected, original_command_id: original } } };
      });
    } catch { return unavailable(); }
  }

  // No permissive status/webhook or unapproved financial compensation path.
  async capturePayment(_input: unknown): Promise<never> { return unsupported(); }
  async refundPayment(_input: unknown): Promise<never> { return unsupported(); }
  async cancelPayment(_input: unknown): Promise<never> { return unsupported(); }
  async deletePayment(_input: unknown): Promise<never> { return unsupported(); }
  async retrievePayment(_input: unknown): Promise<never> { return unsupported(); }
  async updatePayment(_input: unknown): Promise<never> { return unsupported(); }
  async getPaymentStatus(_input: unknown): Promise<never> { return unsupported(); }
  async getWebhookActionAndData(_input: unknown): Promise<never> { return unsupported(); }
}
