import { authenticate } from "@medusajs/framework/http";
import type { AuthenticatedMedusaRequest, MedusaRequestHandler, MiddlewareRoute } from "@medusajs/framework/http";
import { Modules } from "@medusajs/framework/utils";
import { cartId, checkCartAccess, currentCustomer, unavailable } from "../cart-context/policy";

const bearerOnly: MedusaRequestHandler = (req, _res, next) => {
  // The native global Store middleware also accepts sessions. This customer
  // profile deliberately consumes only short-lived bearer credentials.
  delete (req as Partial<AuthenticatedMedusaRequest>).auth_context;
  next();
};

const cartInputs: MedusaRequestHandler = async (req, _res, next) => {
  await currentCustomer(req);
  const ids = [req.query?.cart_id, (req.body as Record<string, unknown>)?.cart_id].filter((id) => id !== undefined);
  if (ids.length > 1 && ids[0] !== ids[1]) throw unavailable();
  for (const id of ids) await checkCartAccess(req, cartId(id));
  next();
};

const inlineAddresses: MedusaRequestHandler = (req, _res, next) => {
  for (const key of ["shipping_address", "billing_address"]) {
    const address = req.body?.[key];
    if (address !== undefined && address !== null &&
        (typeof address !== "object" || Array.isArray(address) || "id" in address || "customer_id" in address)) {
      throw unavailable();
    }
  }
  next();
};

export function cartContextMiddlewares(): MiddlewareRoute[] {
  return [
    { matcher: "/store/*", middlewares: [bearerOnly,
      authenticate("customer", ["bearer"], { allowUnauthenticated: true, requireMfa: true })] },
    // Native products, variants and shipping routes also consume cart_id. Read
    // the original parsed inputs before native validators remove context fields.
    ...["/store/products*", "/store/product-variants*", "/store/shipping-options*", "/store/carts"].map(
      (matcher): MiddlewareRoute => ({ matcher, middlewares: [cartInputs] })),
    { matcher: "/store/carts", methods: ["POST"], middlewares: [inlineAddresses] },
    { matcher: "/store/carts/:id", middlewares: [async (req, _res, next) => {
      // These nested operations have their own unconditional holds. Preserve
      // their refusal even for a missing cart or an anonymous caller.
      if (!/^\/(complete|customer)(\/|$)/i.test(req.path)) await checkCartAccess(req, req.params.id);
      next();
    }] },
    { matcher: "/store/carts/:id", methods: ["POST"], middlewares: [inlineAddresses] },
    { matcher: "/store/carts/:id/line-items/:line_id", middlewares: [async (req, _res, next) => {
      const items = await req.scope.resolve(Modules.CART).listLineItems({ id: req.params.line_id, cart_id: req.params.id });
      if (items.length !== 1) throw unavailable();
      next();
    }] },
    { matcher: "/store/rifare/cart-observations/:id", middlewares: [authenticate("customer", ["bearer"])] },
  ];
}
