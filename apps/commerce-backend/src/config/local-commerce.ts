import { createHash } from "node:crypto";

// ADR-0089: two narrowly pinned native UI corrections, not a replacement
// dashboard. Remove when fixed upstream releases are selected and requalified.
const productModule = "/@medusajs/dashboard/dist/product-list-SC2CY4XX.mjs";
const productModuleDigest = "3aba92f16ae523ec7ccbdaa44dc1787f066cf1771439420da9e7599816fd3e5c";
const marker = 'widgetsZonePrefix: "product.list",';
const loginModule = "/@medusajs/dashboard/dist/login-NQL3NNCN.mjs";
const loginModuleDigest = "b86850b96199e64c8efa01027800be32413f97802722106a7b202dc7e4428d47";
const loginStart = "  const handleSubmit = form.handleSubmit(async ({ email, password }) => {\n    await mutateAsync(";
const loginEnd = "    );\n  });\n  const serverError = form.formState.errors?.root?.serverError?.message;";

export function adminBuildConfig() {
  let correctedProduct = false, correctedLogin = false;
  return { plugins: [{
    name: "rifare-static-admin-react",
    // Keep React and Vite8 OXC JSX in agreement for a static build even when
    // the backend uses its permitted local test profile. Serving/HMR is unchanged.
    config: (_config: unknown, { command }: { command: string }) => command === "build" ? {
      define: { "process.env.NODE_ENV": JSON.stringify("production") },
      oxc: { jsx: { development: false } },
    } : undefined,
  }, {
    name: "rifare-medusa-admin-compatibility",
    apply: "build" as const,
    enforce: "pre" as const,
    transform(source: string, id: string) {
      const path = id.split("?")[0].replaceAll("\\", "/");
      if (path.endsWith(productModule)) {
        if (createHash("sha256").update(source).digest("hex") !== productModuleDigest || source.split(marker).length !== 2) {
          throw new Error("RIFARE_ADMIN_PRODUCT_MODULE_UNQUALIFIED");
        }
        correctedProduct = true;
        // Each unchanged native table already owns the route Outlet. Suppress only
        // the outer composer's second Outlet; preserve both table/permission branches.
        return { code: source.replace(marker, `${marker}\n      hasOutlet: false,`), map: null };
      }
      if (!path.endsWith(loginModule)) return null;
      if (createHash("sha256").update(source).digest("hex") !== loginModuleDigest || source.split(loginStart).length !== 2 || source.split(loginEnd).length !== 2) {
        throw new Error("RIFARE_ADMIN_LOGIN_MODULE_UNQUALIFIED");
      }
      correctedLogin = true;
      // Native onError already renders reported HTTP failures. Keep that whole
      // mutation and its success/MFA callbacks intact; only consume its FetchError
      // rejection, preserving unexpected exceptions for the normal error boundary.
      return { code: source.replace(loginStart, loginStart.replace("    await", "    try {\n      await"))
        .replace(loginEnd, "    );\n    } catch (error) {\n      if (!isFetchError(error)) throw error;\n    }\n  });\n  const serverError = form.formState.errors?.root?.serverError?.message;"), map: null };
    },
    buildEnd(error?: Error) {
      if (!error && (!correctedProduct || !correctedLogin)) throw new Error("RIFARE_ADMIN_REQUIRED_MODULE_NOT_OBSERVED");
    },
  }] };
}

type Environment = Readonly<Record<string, string | undefined>>;

const loopback = new Set(["127.0.0.1", "[::1]"]);

export function cartContextConfig(env: Environment) {
  const merchant = env.RIFARE_MERCHANT_NAMESPACE;
  const store = env.RIFARE_NATIVE_STORE_ID;
  if (!merchant && !store) return undefined;
  if (!merchant || !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(merchant) ||
      !store || !/^store_[A-Za-z0-9]{1,100}$/.test(store)) {
    throw new Error("RIFARE_CART_CONTEXT_CONFIGURATION_REQUIRED");
  }
  return { merchant_namespace: merchant, store_id: store };
}

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
  cartContextConfig(env);
  if (env.RIFARE_COMMERCE_PROFILE !== "local-medusa" ||
      ![undefined, "development", "test"].includes(env.NODE_ENV)) {
    throw new Error("RIFARE_COMMERCE_PROFILE_UNQUALIFIED");
  }
  const testCheckoutLock = env.RIFARE_TEST_CHECKOUT_LOCK;
  const testNativeExecution = env.RIFARE_TEST_NATIVE_EXECUTION;
  if (testNativeExecution !== undefined && (testNativeExecution !== "worker-identity" ||
      env.NODE_ENV !== "test" || env.RIFARE_COMMERCE_VERIFY !== "disposable")) {
    throw new Error("RIFARE_DISPOSABLE_NATIVE_EXECUTION_REQUIRED");
  }
  if (testCheckoutLock !== undefined && (!["postgres", "redis"].includes(testCheckoutLock) ||
      env.NODE_ENV !== "test" || env.RIFARE_COMMERCE_VERIFY !== "disposable")) {
    throw new Error("RIFARE_DISPOSABLE_CHECKOUT_LOCK_REQUIRED");
  }
  let redisLockUrl: URL | undefined;
  if (testCheckoutLock === "redis") {
    try { redisLockUrl = new URL(env.RIFARE_TEST_LOCK_REDIS_URL ?? ""); }
    catch { throw new Error("RIFARE_DISPOSABLE_LOCK_REDIS_URL_REQUIRED"); }
    if (redisLockUrl.protocol !== "redis:" || !loopback.has(redisLockUrl.hostname) || !redisLockUrl.port ||
        redisLockUrl.username || !redisLockUrl.password || !["", "/0"].includes(redisLockUrl.pathname) ||
        redisLockUrl.search || redisLockUrl.hash) {
      throw new Error("RIFARE_DISPOSABLE_LOCK_REDIS_URL_REQUIRED");
    }
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
    admin: { disable: env.DISABLE_MEDUSA_ADMIN === "true", backendUrl: "/", vite: adminBuildConfig },
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
    }, { resolve: "./src/modules/operation-journal" },
    ...(testNativeExecution ? [{ resolve: "./src/modules/native-execution-payment" }] : []), ...(testCheckoutLock ? [{
      resolve: "@medusajs/medusa/locking",
      options: { providers: [{
        resolve: `@medusajs/medusa/locking-${testCheckoutLock}`,
        id: `locking-${testCheckoutLock}`,
        is_default: true,
        ...(redisLockUrl ? { options: { redisUrl: redisLockUrl.href, namespace: "rifare_checkout_fixture:" } } : {}),
      }] },
    }] : [])],
  };
}
