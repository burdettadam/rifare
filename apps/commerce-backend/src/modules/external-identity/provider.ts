import { AbstractAuthModuleProvider, MedusaError } from "@medusajs/framework/utils";
import type { AuthenticationInput, AuthenticationResponse, AuthIdentityProviderService, ILockingModule } from "@medusajs/framework/types";
import type { Configuration } from "openid-client" with { "resolution-mode": "import" };
import type { ExternalIdentityConfig } from "../../config/local-commerce";
import { browserBinding, digest, flowKey, flowLifetime, loginPath } from "./browser";

const refused = (): AuthenticationResponse => ({ success: false, error: "External authentication failed" });

/** Protocol validation comes from openid-client. Storage/association come from Medusa. */
export default class ExternalIdentityProvider extends AbstractAuthModuleProvider {
  static identifier = "external-oidc";
  static DISPLAY_NAME = "External identity";
  private client?: Promise<Configuration>;
  private readonly locking: ILockingModule;
  private readonly options: ExternalIdentityConfig;
  private readonly binding: string;

  constructor({ locking }: { locking: ILockingModule }, options: ExternalIdentityConfig) {
    super();
    this.locking = locking;
    this.options = options;
    this.binding = digest(JSON.stringify(["customer", this.identifier, options.issuer,
      options.clientId, options.callbackUrl, options.signingAlgorithm, "client_secret_post"]));
  }

  private async configuration(): Promise<Configuration> {
    if (!this.client) this.client = this.discover().catch((error) => { this.client = undefined; throw error; });
    return this.client;
  }

  private async discover() {
    const oidc = await import("openid-client");
    const issuer = new URL(this.options.issuer);
    const config = await oidc.discovery(issuer, this.options.clientId,
      { id_token_signed_response_alg: this.options.signingAlgorithm },
      oidc.ClientSecretPost(this.options.clientSecret), {
        timeout: 10,
        execute: [oidc.enableNonRepudiationChecks, ...(this.options.synthetic ? [oidc.allowInsecureRequests] : [])],
        [oidc.customFetch]: async (url, options) => {
          const target = new URL(url);
          if (target.origin !== issuer.origin || target.username || target.password || target.hash) {
            throw new Error("External identity endpoint refused");
          }
          return fetch(target, { ...options, body: options.body as BodyInit, redirect: "error" });
        },
      });
    const metadata = config.serverMetadata();
    for (const endpoint of [metadata.authorization_endpoint, metadata.token_endpoint, metadata.jwks_uri]) {
      if (!endpoint || new URL(endpoint).origin !== issuer.origin || new URL(endpoint).username || new URL(endpoint).password) {
        throw new Error("External identity endpoint refused");
      }
    }
    if (!metadata.code_challenge_methods_supported?.includes("S256") ||
        !metadata.id_token_signing_alg_values_supported?.includes(this.options.signingAlgorithm) ||
        !metadata.token_endpoint_auth_methods_supported?.includes("client_secret_post")) {
      throw new Error("External identity capabilities refused");
    }
    return config;
  }

  async authenticate(input: AuthenticationInput, service: AuthIdentityProviderService): Promise<AuthenticationResponse> {
    try {
      const browser = await browserBinding(input.headers?.cookie);
      if (!browser || input.headers?.origin !== this.options.webOrigin ||
          input.url !== loginPath || Object.keys(input.query ?? {}).length || Object.keys(input.body ?? {}).length) return refused();
      const oidc = await import("openid-client");
      const config = await this.configuration();
      const state = oidc.randomState(), nonce = oidc.randomNonce(), verifier = oidc.randomPKCECodeVerifier();
      await service.setState(flowKey(state, browser), {
        state, nonce, verifier, binding: this.binding, expires: Date.now() + flowLifetime * 1000,
      }, flowLifetime);
      const location = oidc.buildAuthorizationUrl(config, {
        redirect_uri: this.options.callbackUrl, scope: "openid email", response_type: "code", state, nonce,
        code_challenge_method: "S256", code_challenge: await oidc.calculatePKCECodeChallenge(verifier),
      });
      return { success: true, location: location.href };
    } catch { return refused(); }
  }

  async validateCallback(input: AuthenticationInput, service: AuthIdentityProviderService): Promise<AuthenticationResponse> {
    try {
      const browser = await browserBinding(input.headers?.cookie);
      // Middleware also checks raw duplicate query parameters and request method.
      if (!browser || input.url?.split("?", 1)[0] !== `${loginPath}/callback`) return refused();
      const parameters = { ...(input.query ?? {}), ...(input.body ?? {}) };
      const { state } = parameters;
      if (typeof state !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(state)) return refused();
      const key = flowKey(state, browser);
      // Native cache get+invalidate is not atomic without the native locking service.
      const flow = await this.locking.execute(key, () => service.getState(key));
      if (!flow || flow.state !== state || flow.binding !== this.binding ||
          typeof flow.expires !== "number" || flow.expires <= Date.now() ||
          typeof flow.nonce !== "string" || typeof flow.verifier !== "string") return refused();
      const callback = new URL(this.options.callbackUrl);
      for (const [name, value] of Object.entries(parameters)) {
        if (typeof value !== "string" || !["code", "state", "iss", "error", "error_description"].includes(name)) return refused();
        callback.searchParams.set(name, value);
      }
      const oidc = await import("openid-client");
      const tokens = await oidc.authorizationCodeGrant(await this.configuration(), callback, {
        expectedState: state, expectedNonce: flow.nonce, pkceCodeVerifier: flow.verifier, idTokenExpected: true,
      });
      const claims = tokens.claims();
      if (!claims || typeof claims.sub !== "string" || !claims.sub || claims.sub.length > 512 ||
          claims.email_verified !== true || typeof claims.email !== "string" ||
          claims.email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(claims.email)) return refused();
      const entity_id = `oidc:${digest(JSON.stringify([this.options.issuer, claims.sub]))}`;
      const data = { provider_metadata: { issuer: this.options.issuer, subject: claims.sub },
        user_metadata: { email: claims.email, email_verified: true } };
      const authIdentity = await this.locking.execute(`rifare-identity:${entity_id}`, async () => {
        try {
          await service.retrieve({ entity_id });
          // Never alter customer association, customer email, roles or app_metadata.
          return await service.update(entity_id, data);
        } catch (error) {
          if (error.type !== MedusaError.Types.NOT_FOUND) throw error;
          return service.create({ entity_id, ...data });
        }
      });
      // Upstream access/refresh/ID tokens deliberately do not enter persistence.
      return { success: true, authIdentity };
    } catch { return refused(); }
  }

  async register(): Promise<AuthenticationResponse> { return refused(); }
  async update(): Promise<AuthenticationResponse> { return refused(); }
}
