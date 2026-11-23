import { defineMiddlewares } from "@medusajs/framework/http";
import type { MiddlewareRoute } from "@medusajs/framework/http";
import { identityMiddlewares } from "./identity-middleware";
import { cartContextMiddlewares } from "./cart-context-middleware";

/** Cart preparation uses Medusa. An order UUID, login or public API key does
 * not replace the pending identity/approval bridge. No caller-controlled bypass.
 */
const held: MiddlewareRoute[] = [
  { matcher: "/store/carts/:id/complete", methods: ["POST"] },
  { matcher: "/store/carts/:id/customer", methods: ["POST"] },
  { matcher: "/store/payment-collections*", methods: ["POST", "PUT", "PATCH", "DELETE"] },
  { matcher: "/store/returns*" },
  { matcher: "/store/orders*" },
  { matcher: "/hooks/payment*" },
];

export default defineMiddlewares({
  routes: [...identityMiddlewares(), ...cartContextMiddlewares(), ...held.map((route) => ({
    ...route,
    middlewares: [(_req, res) => {
      res.status(503).json({
        type: "not_allowed", code: "RIFARE_COMMERCE_IDENTITY_NOT_CONNECTED",
        message: "This operation is unavailable while the identity and approval integration is being completed.",
      });
    }],
  }))],
});
