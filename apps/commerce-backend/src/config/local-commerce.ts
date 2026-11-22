type Environment = Readonly<Record<string, string | undefined>>;

const loopback = new Set(["127.0.0.1", "[::1]"]);

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
        // A development operator is not an ElevenID-authenticated customer.
        authMethodsPerActor: { user: ["emailpass"], customer: [] },
        requireActorAssociation: { emailpass: true },
      },
    },
    featureFlags: { rbac: false, rbac_filter_fields: false, analytics: false },
    modules: [{
      resolve: "@medusajs/medusa/auth",
      options: { providers: [{ resolve: "@medusajs/medusa/auth-emailpass", id: "emailpass" }] },
    }],
  };
}
