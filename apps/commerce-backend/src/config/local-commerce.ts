type Environment = Readonly<Record<string, string | undefined>>;

const loopback = new Set(["127.0.0.1", "[::1]"]);

export type ExternalIdentityConfig = {
  issuer: string; clientId: string; clientSecret: string; callbackUrl: string;
  webOrigin: string; signingAlgorithm: "RS256" | "ES256"; synthetic: boolean;
};

/** The hosted provider is explicit; loopback HTTP is confined to disposable tests. */
export function externalIdentityConfig(env: Environment, webOrigin: string): ExternalIdentityConfig | undefined {
  const profile = env.RIFARE_IDENTITY_PROVIDER;
  if (!profile) {
    if (Object.keys(env).some((key) => key.startsWith("RIFARE_OIDC_") && env[key])) {
      throw new Error("RIFARE_IDENTITY_PROFILE_REQUIRED");
    }
    return undefined;
  }
  const synthetic = profile === "synthetic-oidc" && env.NODE_ENV === "test" &&
    env.RIFARE_COMMERCE_VERIFY === "disposable";
  if (profile !== "supabase" && !synthetic) throw new Error("RIFARE_IDENTITY_PROFILE_UNQUALIFIED");
  let issuer: URL;
  try { issuer = new URL(env.RIFARE_OIDC_ISSUER ?? ""); }
  catch { throw new Error("RIFARE_IDENTITY_ISSUER_REQUIRED"); }
  if (issuer.username || issuer.password || issuer.search || issuer.hash ||
      issuer.pathname !== "/auth/v1" || issuer.href !== env.RIFARE_OIDC_ISSUER ||
      (synthetic ? issuer.protocol !== "http:" || !loopback.has(issuer.hostname) :
        issuer.protocol !== "https:" || loopback.has(issuer.hostname))) {
    throw new Error("RIFARE_IDENTITY_ISSUER_UNQUALIFIED");
  }
  const clientId = env.RIFARE_OIDC_CLIENT_ID;
  const clientSecret = env.RIFARE_OIDC_CLIENT_SECRET;
  const callbackUrl = `${webOrigin}/auth/customer/external-oidc/callback`;
  if (!clientId || clientId.length > 256 || /\s/.test(clientId) ||
      !clientSecret || clientSecret.length < 32 || clientSecret.length > 4096 ||
      env.RIFARE_OIDC_CALLBACK_URL !== callbackUrl) {
    throw new Error("RIFARE_IDENTITY_CONFIDENTIAL_CLIENT_AND_EXACT_CALLBACK_REQUIRED");
  }
  const signingAlgorithm = env.RIFARE_OIDC_SIGNING_ALG;
  if (signingAlgorithm !== "RS256" && signingAlgorithm !== "ES256") {
    throw new Error("RIFARE_IDENTITY_ASYMMETRIC_ALGORITHM_REQUIRED");
  }
  return { issuer: issuer.href, clientId, clientSecret, callbackUrl, webOrigin, signingAlgorithm, synthetic };
}

/** Explicit development profile. This is not a production configuration. */
export function localCommerceConfig(env: Environment) {
  if (env.RIFARE_COMMERCE_PROFILE !== "local-medusa" ||
      ![undefined, "development", "test"].includes(env.NODE_ENV)) {
    throw new Error("RIFARE_COMMERCE_PROFILE_UNQUALIFIED");
  }
  if (env.EXECUTION_CONTEXT || Object.keys(env).some((key) => key.startsWith("MEDUSA_CLOUD_") && env[key])) {
    throw new Error("RIFARE_COMMERCE_CLOUD_CONFIGURATION_UNSUPPORTED");
  }
  let database: URL;
  let web: URL;
  try {
    database = new URL(env.DATABASE_URL ?? "");
    web = new URL(env.RIFARE_WEB_ORIGIN ?? "http://127.0.0.1:9000");
  } catch {
    throw new Error("RIFARE_COMMERCE_CONFIGURATION_REQUIRED");
  }
  if (!["postgres:", "postgresql:"].includes(database.protocol) ||
      !loopback.has(database.hostname) || !database.username || !database.password ||
      database.pathname.length < 2 || database.hash || database.search) {
    throw new Error("RIFARE_COMMERCE_LOCAL_DATABASE_REQUIRED");
  }
  if (web.protocol !== "http:" || !loopback.has(web.hostname) ||
      web.username || web.password || web.pathname !== "/" || web.search || web.hash) {
    throw new Error("RIFARE_COMMERCE_LOCAL_ORIGIN_REQUIRED");
  }
  const jwtSecret = env.JWT_SECRET;
  const cookieSecret = env.COOKIE_SECRET;
  if (!jwtSecret || !cookieSecret || jwtSecret.length < 32 ||
      cookieSecret.length < 32 || jwtSecret === cookieSecret) {
    throw new Error("RIFARE_COMMERCE_SEPARATE_SESSION_SECRETS_REQUIRED");
  }
  const identity = externalIdentityConfig(env, web.origin);
  return {
    admin: { disable: env.DISABLE_MEDUSA_ADMIN === "true", backendUrl: "/" },
    plugins: [{ resolve: "@medusajs/cloud", options: { disabled: true } }],
    projectConfig: {
      databaseUrl: database.href,
      databaseDriverOptions: { connection: { ssl: false } },
      http: {
        storeCors: web.origin,
        adminCors: web.origin,
        authCors: web.origin,
        jwtSecret,
        cookieSecret,
        ...(identity ? { jwtExpiresIn: "5m" } : {}),
        // A development operator is not an ElevenID-authenticated customer.
        authMethodsPerActor: { user: ["emailpass"], customer: identity ? ["external-oidc"] : [] },
        requireActorAssociation: { emailpass: true },
      },
    },
    featureFlags: { rbac: false, rbac_filter_fields: false, analytics: false },
    modules: [{
      resolve: "@medusajs/medusa/auth",
      options: { providers: [
        { resolve: "@medusajs/medusa/auth-emailpass", id: "emailpass" },
        ...(identity ? [{ resolve: "./src/modules/external-identity", id: "external-oidc", options: identity }] : []),
      ] },
    }],
  };
}
