import { authenticate } from "@medusajs/framework/http";
import type { MiddlewareRoute, MedusaRequestHandler, AuthenticatedMedusaRequest } from "@medusajs/framework/http";
import { externalIdentityConfig } from "../config/local-commerce";
import { browserBinding, loginPath, newBrowserBinding } from "../modules/external-identity/browser";

export function identityMiddlewares(): MiddlewareRoute[] {
  const config = externalIdentityConfig(process.env, new URL(process.env.RIFARE_WEB_ORIGIN ?? "http://127.0.0.1:9000").origin);
  if (!config) return [];
  const flowGuard: MedusaRequestHandler = async (req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Referrer-Policy", "no-referrer");
    const deny = () => { res.status(403).json({ type: "not_allowed", message: "External authentication request refused" }); };
    const url = new URL(req.originalUrl, config.webOrigin);
    const callback = url.pathname === `${loginPath}/callback`;
    if (url.pathname !== loginPath && !callback) return deny();
    if (req.method !== "POST" && !(callback && req.method === "GET")) return deny();
    if (req.method === "POST" && req.headers.origin !== config.webOrigin) return deny();
    const body = req.body ?? {};
    if (!body || typeof body !== "object" || Array.isArray(body)) return deny();
    const names = [...url.searchParams.keys()];
    if (new Set(names).size !== names.length ||
        Object.keys(body).some((name) => names.includes(name))) return deny();
    if (!callback) {
      if (names.length || Object.keys(body).length) return deny();
      if (!await browserBinding(req.headers.cookie)) {
        const binding = await newBrowserBinding(new URL(config.webOrigin).protocol === "https:");
        res.appendHeader("Set-Cookie", binding.responseCookie);
        // The new server-generated binding is visible to the provider in this request.
        req.headers.cookie = binding.requestCookie;
      }
    } else {
      if (!await browserBinding(req.headers.cookie) ||
          [...names, ...Object.keys(body)].some((name) => !["code", "state", "iss", "error", "error_description"].includes(name)) ||
          Object.values(body).some((value) => typeof value !== "string")) return deny();
    }
    next();
  };
  const operatorOnly: MedusaRequestHandler = (req, res, next) => {
    const context = (req as AuthenticatedMedusaRequest).auth_context;
    if (context?.actor_type !== "user" || !context.actor_id) {
      res.status(403).json({ type: "not_allowed", code: "RIFARE_CUSTOMER_REAUTHENTICATION_REQUIRED",
        message: "Customer credentials require a new provider sign-in." });
      return;
    }
    next();
  };
  return [
    { matcher: "/auth/:actor_type/external-oidc*", middlewares: [flowGuard] },
    // Native MFA challenge verification can mint a fresh JWT. External customers
    // authenticate/MFA at their provider; operator MFA keeps its native flow.
    { matcher: "/auth/mfa/*", middlewares: [
      authenticate("user", ["session", "bearer"], { allowUnregistered: true, requireMfa: false }),
    ] },
    ...["/auth/session", "/auth/token/refresh"].map((matcher): MiddlewareRoute => ({
      matcher, methods: ["POST"], middlewares: [
        authenticate("*", ["session", "bearer"], { allowUnregistered: true, requireMfa: false }), operatorOnly,
      ],
    })),
  ];
}
