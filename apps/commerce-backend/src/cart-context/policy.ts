import type { AuthenticatedMedusaRequest, MedusaRequest } from "@medusajs/framework/http";
import { MedusaError, Modules } from "@medusajs/framework/utils";

export const unavailable = () => new MedusaError(MedusaError.Types.FORBIDDEN, "Cart context unavailable");

/** Verify the current native association, not only the association in an old JWT. */
export async function currentCustomer(req: MedusaRequest): Promise<string | undefined> {
  const context = (req as AuthenticatedMedusaRequest).auth_context;
  if (!context) return undefined;
  if (context.actor_type !== "customer" || !context.actor_id || !context.auth_identity_id) throw unavailable();
  try {
    const identity = await req.scope.resolve(Modules.AUTH).retrieveAuthIdentity(context.auth_identity_id);
    const customer = await req.scope.resolve(Modules.CUSTOMER).retrieveCustomer(context.actor_id);
    if (identity.app_metadata?.customer_id !== context.actor_id || customer.has_account !== true) throw unavailable();
  } catch {
    throw new MedusaError(MedusaError.Types.UNAUTHORIZED, "Customer reauthentication required");
  }
  return context.actor_id;
}

export function cartId(value: unknown): string {
  if (typeof value !== "string" || !/^cart_[A-Za-z0-9]{1,100}$/.test(value)) throw unavailable();
  return value;
}

/** Guest capability access is retained only for known guest state. Missing
 * customer records cannot turn an account cart into an anonymous cart.
 */
export async function checkCartAccess(req: MedusaRequest, id: string, requireOwner = false) {
  const cart = await req.scope.resolve(Modules.CART).retrieveCart(cartId(id), {
    select: ["id", "customer_id", "sales_channel_id"],
  });
  const actor = await currentCustomer(req);
  if (!cart.customer_id) {
    if (requireOwner) throw unavailable();
    return cart;
  }
  let customer;
  try { customer = await req.scope.resolve(Modules.CUSTOMER).retrieveCustomer(cart.customer_id); }
  catch { throw unavailable(); }
  if (customer.has_account === true || requireOwner) {
    // The cross-customer native HTTP fault removes this exact ownership refusal.
    if (customer.has_account !== true || !actor || cart.customer_id !== actor) throw unavailable();
    const channels = (req as AuthenticatedMedusaRequest).publishable_key_context?.sales_channel_ids;
    if (!cart.sales_channel_id || !channels?.includes(cart.sales_channel_id)) throw unavailable();
  } else if (customer.has_account !== false) throw unavailable();
  return cart;
}
